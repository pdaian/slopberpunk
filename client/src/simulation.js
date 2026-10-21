// Sloperberpunk local simulation. Server characters are never imported from this state.
// GPL-3.0-or-later. See LICENSE.
import { clamp, distance } from './math.js';
import { DATA_VERSION } from './persistence.js';
import { GhostTrail, ghostContact } from './ghostline.js';
import { founderXpReward } from './founders.js';
import { LocalDungeon } from './dungeons.js';

export function experienceFor(level, rules) { return rules.xp.base + level * rules.xp.perLevel; }
export function stats(character, data) {
  const r=data.rules.player;
  const s={health:r.health+character.level*r.healthPerLevel,energy:r.energy,speed:1,crit:data.rules.combat.crit,damage:1,shield:0,healing:0,regen:0};
  const race=data.races.find(r=>r.id===character.race);
  if(race?.passive) s[race.passive.stat]+=race.passive.value;
  for(const talent of data.talents) s[talent.stat]+=(character.talents[talent.id]||0)*talent.amount;
  return s;
}
export function createCharacter(name,race,faction,data) {
  if(!/^[\p{L}\p{N} _-]{2,24}$/u.test(name)) throw new Error('Use 2–24 letters, numbers, spaces, underscores, or hyphens.');
  if(!data.races.some(r=>r.id===race)||!data.factions.some(f=>f.id===faction)) throw new Error('Choose a lineage and a faction.');
  const c={version:DATA_VERSION,revision:0,id:crypto.randomUUID(),name,race,faction,level:0,xp:0,credits:data.rules.startingCredits,position:[...data.world.spawn],yaw:0,health:120,energy:100,medkits:data.rules.startingMedkits,weaponRank:0,talents:{},activeQuests:{},completed:[],introSeen:false};
  const s=stats(c,data);c.health=s.health;c.energy=s.energy;return c;
}
export function availableQuest(q,c) {
  return (!q.faction||q.faction===c.faction)&&(!q.race||q.race===c.race)&&q.level<=c.level&&q.requires.every(id=>c.completed.includes(id))&&!c.completed.includes(q.id)&&c.activeQuests[q.id]===undefined;
}
export function rollAttack(random,level,targetLevel,power,crit,rules) {
  const roll=Math.floor(random()*rules.combat.die)+1;
  const miss=clamp(rules.combat.miss+Math.max(0,targetLevel-level)*2,0,65);
  if(roll<=miss) return {roll,damage:0,critical:false};
  const critical=roll>rules.combat.die-crit;
  const damage=Math.max(1,Math.round(power*(critical?rules.combat.critMultiplier:1)*(1-rules.combat.armorReduction)));
  return {roll,damage,critical};
}

export class Simulation {
  constructor(data,world,character,emit=()=>{},random=Math.random) {
    this.data=data;this.world=world;this.character=character;this.emit=emit;this.random=random;this.time=0;
    this.expedition=null;this.dungeonState=null;this.nextDungeon=1;
    if(character.dungeonReturn){character.position=[...character.dungeonReturn];delete character.dungeonReturn;character.health=stats(character,data).health;}
    this.ghostTrail=new GhostTrail(data.rules.ghostline,data.rules.movement.dashSpeed*stats(character,data).speed+data.rules.movement.jump);this.ghostlines=[];
    this.velocity=[0,0,0];this.grounded=true;this.coyote=0;this.jumpBuffer=0;this.dash=0;this.dashReady=0;this.cooldowns={};this.globalReady=0;this.shield=0;this.shieldUntil=0;this.lastCombat=-100;this.lastInteract=-100;this.deadAt=0;
    this.enemies=data.world.enemySpawns.map((s,i)=>{
      const template=data.enemies.find(e=>e.id===s.type), maxHealth=template.health+s.level*12;
      return {...template,id:`enemy-${i}`,type:s.type,position:[...s.position],home:[...s.position],level:s.level,maxHealth,health:maxHealth,attackAt:0,stunUntil:0,respawnAt:0,yaw:0};
    });
  }
  get playerStats(){return stats(this.character,this.data);}
  get dungeon(){return this.expedition?{run:this.expedition.snapshot()}:this.dungeonState;}
  get inDungeon(){return this.expedition?.active??Boolean(this.dungeonState?.run&&this.dungeonState.run.phase!=='ready');}
  event(type,detail={}){this.emit({type,...detail});}
  tick(dt,input={},predictOnly=false) {
    dt=Math.min(dt,.05);this.time+=dt;
    if(!predictOnly)this.expedition?.tick();
    const c=this.character,r=this.data.rules,m=r.movement,s=this.playerStats;
    if(c.health<=0){if(!this.deadAt)this.deadAt=this.time;if(!predictOnly){this.ghostTrail.clear();this.ghostlines=[];}return;}
    const previous=[...c.position];
    if(input.yaw!==undefined&&Number.isFinite(input.yaw))c.yaw=input.yaw;
    if(input.jump)this.jumpBuffer=m.jumpBuffer;else this.jumpBuffer=Math.max(0,this.jumpBuffer-dt);
    this.coyote=this.grounded?m.coyoteTime:Math.max(0,this.coyote-dt);
    if(this.jumpBuffer>0&&this.coyote>0){this.velocity[1]=m.jump;this.grounded=false;this.coyote=0;this.jumpBuffer=0;this.event('sound',{name:'jump'});}
    if(input.dash&&this.time>=this.dashReady){this.dash=m.dashDuration;this.dashReady=this.time+m.dashCooldown;this.event('sound',{name:'surge'});}
    this.dash=Math.max(0,this.dash-dt);
    let f=clamp(input.forward||0,-1,1),side=clamp(input.strafe||0,-1,1),len=Math.hypot(f,side);
    if(len>1){f/=len;side/=len;}
    if(this.dash>0&&!f&&!side)f=1;
    const speed=(this.dash>0?m.dashSpeed:input.sprint?m.sprint:m.speed)*s.speed;
    const tx=(-Math.sin(c.yaw)*f+Math.cos(c.yaw)*side)*speed,tz=(-Math.cos(c.yaw)*f-Math.sin(c.yaw)*side)*speed;
    const accel=(this.grounded?1:m.airControl)*m.acceleration*dt;
    for(const [axis,target]of[[0,tx],[2,tz]])this.velocity[axis]+=clamp(target-this.velocity[axis],-accel,accel);
    if(!len&&this.dash===0&&this.grounded){this.velocity[0]*=Math.exp(-m.friction*dt);this.velocity[2]*=Math.exp(-m.friction*dt);}
    const p=c.position;
    // Substeps prevent a dash crossing a narrow wall at a low frame rate.
    const steps=Math.max(1,Math.ceil(Math.hypot(this.velocity[0],this.velocity[2])*dt/.35));
    for(let i=0;i<steps;i++){
      let nx=p[0]+this.velocity[0]*dt/steps,nz=p[2]+this.velocity[2]*dt/steps;
      const arena=this.inDungeon?this.data.dungeons.rules:null;
      if(!this.world.collides(nx,p[1],p[2],m.radius)&&(!arena||Math.abs(nx-arena.arena[0])<=arena.arenaRadius))p[0]=nx;else this.velocity[0]=0;
      if(!this.world.collides(p[0],p[1],nz,m.radius)&&(!arena||Math.abs(nz-arena.arena[2])<=arena.arenaRadius))p[2]=nz;else this.velocity[2]=0;
    }
    this.velocity[1]-=m.gravity*dt;const nextY=p[1]+this.velocity[1]*dt,floor=this.world.floorAt(p[0],p[2],p[1],nextY);
    if(nextY<=floor){p[1]=floor;this.velocity[1]=0;this.grounded=true;}else{p[1]=nextY;this.grounded=false;}
    if(predictOnly)return;
    c.energy=Math.min(s.energy,c.energy+(r.player.energyRegen+s.regen)*dt);
    if(this.time-this.lastCombat>r.combat.outOfCombatSeconds)c.health=Math.min(s.health,c.health+r.player.healthRegen*dt);
    if(this.time>this.shieldUntil)this.shield=0;
    for(const enemy of this.enemies)this.tickEnemy(enemy,dt);
    this.tickGhostlines(dt,previous);
    for(const q of this.data.quests)if(!this.inDungeon&&c.activeQuests[q.id]!==undefined&&q.objective.type==='explore'){
      const l=this.data.world.landmarks.find(l=>l.id===q.objective.target);
      if(l&&distance(p,l.position)<r.interactionRadius)this.progress('explore',l.id);
    }
  }
  tickGhostlines(dt,previous){
    const c=this.character,d=this.data,a=d.abilities.find(a=>a.id==='ghostline');
    if(c.health<=0){this.ghostTrail.clear();this.ghostlines=[];return;}
    this.ghostTrail.record(this.time,c.position);
    this.ghostlines=this.ghostlines.filter(g=>this.time-dt<=g.started+g.path.at(-1).time+1e-8);
    for(const ghost of [...this.ghostlines]){
      const contact=ghostContact(ghost,this.time,dt,[{...c,previous}],this.world,d.rules.ghostline);
      if(this.time>ghost.started+ghost.path.at(-1).time+1e-8)this.ghostlines=this.ghostlines.filter(g=>g!==ghost);
      if(!contact)continue;
      // Consume before applying rewards: a braid can fire only once.
      this.ghostlines=this.ghostlines.filter(g=>g!==ghost);
      c.energy=Math.min(this.playerStats.energy,c.energy+d.rules.ghostline.energyReturn);this.dashReady=this.time;
      this.event('braid',{owner:c.id,partner:c.id,cooperative:false,position:contact.position,radius:a.radius,color:a.color});
      for(const e of this.enemies)if(e.health>0&&distance(e.position,contact.position)<=a.radius&&this.world.lineOfSight(contact.position,e.position))this.damageEnemy(e,a,contact.position);
    }
  }
  damageEnemy(target,ability,from,multiplier=1){
    const c=this.character,d=this.data,s=this.playerStats,a=ability;
    const result=rollAttack(this.random,c.level,target.level,(a.power+c.level*3+c.weaponRank*d.rules.inventory.weaponUpgradeDamage)*s.damage*multiplier,s.crit,d.rules);
    target.health=Math.max(0,target.health-result.damage);this.lastCombat=this.time;
    if(a.kind==='stun'&&result.damage>0)target.stunUntil=this.time+a.duration;
    this.event('hit',{...result,target:target.id,position:[...target.position],color:a.color,ability:a.name});
    this.event('effect',{kind:'beam',from:[...from],position:[...target.position],color:a.color});
    if(target.health===0&&!target.instance){target.respawnAt=this.time+d.rules.combat.enemyRespawnSeconds;this.progress('kill',target.type);const xp=this.gainXp(Math.max(3,d.rules.xp.killBase+target.level*d.rules.xp.killPerLevel-Math.max(0,c.level-target.level)*4));c.credits+=5+target.level;this.event('reward',{xp,credits:5+target.level});}
  }
  tickEnemy(e,dt){
    const c=this.character,r=this.data.rules.combat;
    if(e.health<=0){if(!e.instance&&this.time>=e.respawnAt){e.health=e.maxHealth;e.position=[...e.home];}return;}
    if(e.stunUntil>this.time)return;
    const d=distance(c.position,e.position),fromHome=distance(e.position,e.home);
    if(fromHome>r.leash||c.health<=0){e.position=[...e.home];e.health=e.maxHealth;return;}
    if((e.instance||d<r.aggroRadius)&&Math.abs(e.position[1]-c.position[1])<4&&this.world.lineOfSight(e.position,c.position)){
      e.yaw=Math.atan2(c.position[0]-e.position[0],c.position[2]-e.position[2]);
      if(d>r.meleeRange){
        const dx=(c.position[0]-e.position[0])/d*e.speed*dt,dz=(c.position[2]-e.position[2])/d*e.speed*dt;
        if(!this.world.collides(e.position[0]+dx,e.position[1],e.position[2]))e.position[0]+=dx;
        if(!this.world.collides(e.position[0],e.position[1],e.position[2]+dz))e.position[2]+=dz;
      }else if(this.time>=e.attackAt){
        e.attackAt=this.time+r.enemyAttackSeconds;this.lastCombat=this.time;
        let damage=Math.round(e.instance?this.playerStats.health*this.data.dungeons.rules.enemyDamageFraction:e.damage+e.level*2);const absorbed=Math.min(this.shield,damage);this.shield-=absorbed;damage-=absorbed;c.health=Math.max(0,c.health-damage);
        this.event('hurt',{amount:damage});if(c.health<=0){this.deadAt=this.time;this.event('death');}
      }
    }else if(distance(e.position,e.home)>1){
      const homeDistance=distance(e.position,e.home);
      e.position=e.position.map((v,i)=>v+(e.home[i]-v)/homeDistance*Math.min(e.speed*dt,homeDistance));
    }
  }
  progress(type,target){
    const c=this.character;
    for(const q of this.data.quests)if(c.activeQuests[q.id]!==undefined&&q.objective.type===type&&q.objective.target===target&&c.activeQuests[q.id]<q.objective.count){
      c.activeQuests[q.id]=Math.min(q.objective.count,c.activeQuests[q.id]+1);
      this.event('questProgress',{quest:q,progress:c.activeQuests[q.id]});
    }
  }
  gainXp(amount){
    const c=this.character,r=this.data.rules,reward=founderXpReward(c,amount,r);c.founderXpRemainder=reward.remainder;c.xp+=reward.xp;
    while(c.level<r.levelCap&&c.xp>=experienceFor(c.level,r)){
      c.xp-=experienceFor(c.level,r);c.level++;const s=this.playerStats;c.health=s.health;c.energy=s.energy;this.event('level',{level:c.level});
    }
    if(c.level===r.levelCap)c.xp=0;
    return reward.xp;
  }
  action(action){
    const c=this.character,d=this.data,s=this.playerStats;
    if(action.type==='dungeon'){
      if(action.operation==='queue'&&!this.expedition){
        const definition=d.dungeons?.entries.find(d=>d.id===action.dungeon);
        if(!definition||definition.players!==1)return this.fail('Group expeditions require an online character.');
        if(c.health<=0||c.level<definition.level||this.time-this.lastCombat<d.rules.combat.outOfCombatSeconds)return this.fail('Meet the level requirement and leave combat before queueing.');
        this.expedition=new LocalDungeon(this,definition,this.nextDungeon++);return true;
      }
      return this.expedition?.act(action)||false;
    }
    if(this.inDungeon&&['quest','interact','lift','buy','respawn'].includes(action.type))return this.fail('Use the expedition casebook and recovery station. A fallen crew resets together.');
    if(c.health<=0&&action.type!=='respawn')return this.fail('Your signal is offline. Reconstitute at the Commons.');
    if(action.type==='ability'){
      const a=d.abilities.find(a=>a.id===action.id);if(!a)return false;
      if(c.level<a.level)return this.fail(`Unlocks at level ${a.level}.`);
      if(this.time<(this.cooldowns[a.id]||0)||this.time<this.globalReady)return false;
      if(c.energy<a.cost)return this.fail('Not enough energy.');
      const e=this.enemies.find(e=>e.id===action.target&&e.health>0);
      if(['damage','stun','area'].includes(a.kind)&&(!e||distance(c.position,e.position)>a.range||!this.world.lineOfSight(c.position,e.position)))return this.fail('Choose a visible target within range.');
      let ghost;
      if(a.kind==='ghostline'){
        this.ghostTrail.record(this.time,c.position);ghost=this.ghostTrail.release(c,this.time);
        if(!ghost)return this.fail('Ghostline needs a fresh route: move at least 12 m over 2 seconds.');
      }
      c.energy-=a.cost;this.cooldowns[a.id]=this.time+a.cooldown;this.globalReady=this.time+d.rules.combat.globalCooldown;
      if(ghost){this.ghostlines=[ghost];this.event('notice',{text:'Ghostline released. Cross the cyan runner to braid.'});this.event('sound',{name:'surge'});}
      else if(a.kind==='heal'){c.health=Math.min(s.health,c.health+a.power+c.level*3+s.healing);this.event('effect',{kind:'heal',position:[...c.position],color:a.color});this.event('sound',{name:'heal'});}
      else if(a.kind==='shield'){this.shield=a.power+c.level*4+s.shield;this.shieldUntil=this.time+a.duration;this.event('effect',{kind:'shield',position:[...c.position],color:a.color});}
      else{
        const targets=a.kind==='area'?this.enemies.filter(t=>t.health>0&&distance(t.position,e.position)<=a.radius&&this.world.lineOfSight(c.position,t.position)):[e];
        for(const target of targets)this.damageEnemy(target,a,c.position);
        this.event('sound',{name:a.id==='arc'?'shot':'surge'});
      }
      return true;
    }
    if(action.type==='interact'){
      if(this.time-this.lastInteract<1)return false;
      const l=d.world.landmarks.find(l=>l.id===action.id);
      if(!l||distance(c.position,l.position)>d.rules.interactionRadius)return this.fail('Move closer to the terminal.');
      this.lastInteract=this.time;this.progress('interact',l.id);this.progress('explore',l.id);this.event('notice',{text:`${l.name} · connection established`});return true;
    }
    if(action.type==='lift'){
      const lift=d.world.lifts.find(l=>l.id===action.id);
      if(!lift||Math.hypot(c.position[0]-lift.position[0],c.position[2]-lift.position[2])>5||!lift.stops.some(y=>Math.abs(c.position[1]-y)<3))return false;
      const i=lift.stops.findIndex(y=>Math.abs(c.position[1]-y)<3);c.position[1]=lift.stops[(i+1)%lift.stops.length];this.velocity=[0,0,0];this.ghostTrail.clear();this.ghostlines=[];this.event('notice',{text:`Lift · elevation ${c.position[1]} m`});return true;
    }
    if(action.type==='quest'){
      const q=d.quests.find(q=>q.id===action.id);if(!q)return false;
      const npc=d.npcs.find(n=>n.id===q.giver);
      if(!npc||distance(c.position,npc.position)>d.rules.interactionRadius)return this.fail('Return to the quest giver marked on your map.');
      if(action.operation==='accept'&&availableQuest(q,c)){
        c.activeQuests[q.id]=0;this.event('questAccepted',{quest:q});return true;
      }
      if(action.operation==='complete'&&c.activeQuests[q.id]>=q.objective.count&&!c.completed.includes(q.id)){
        delete c.activeQuests[q.id];c.completed.push(q.id);c.credits+=q.reward.credits;const xp=this.gainXp(q.reward.xp);this.event('questComplete',{quest:q,xp});return true;
      }
      return this.fail('This contract is not ready.');
    }
    if(action.type==='talent'){
      const t=d.talents.find(t=>t.id===action.id),spent=Object.values(c.talents).reduce((a,b)=>a+b,0),points=Math.floor(c.level/d.rules.talents.levelsPerPoint);
      if(!t||c.level<t.level||spent>=points||(c.talents[t.id]||0)>=t.maxRank)return this.fail('No talent point available for this node.');
      c.talents[t.id]=(c.talents[t.id]||0)+1;this.event('notice',{text:`${t.name} improved`});return true;
    }
    if(action.type==='medkit'){
      if(c.medkits<=0)return this.fail('No medkits. Visit Patch at the Commons.');
      if(this.time<(this.cooldowns.medkit||0))return false;
      c.medkits--;c.health=Math.min(s.health,c.health+d.rules.inventory.medkitHeal);this.cooldowns.medkit=this.time+d.rules.inventory.medkitCooldown;this.event('sound',{name:'heal'});return true;
    }
    if(action.type==='buy'){
      const npc=d.npcs.find(n=>n.id==='merchant');if(distance(c.position,npc.position)>d.rules.interactionRadius)return this.fail('Visit Patch to trade.');
      const inv=d.rules.inventory,price=action.item==='medkit'?inv.medkitPrice:inv.weaponUpgradePrice*(c.weaponRank+1);
      if(!['medkit','upgrade'].includes(action.item)||c.credits<price)return this.fail('Not enough credits.');
      if(action.item==='medkit'){if(c.medkits>=inv.slots)return this.fail('Medkit pack is full.');c.medkits++;}
      else{if(c.weaponRank>=inv.maxWeaponRank)return this.fail('Carbine is fully upgraded.');c.weaponRank++;}
      c.credits-=price;this.event('sound',{name:'confirm'});return true;
    }
    if(action.type==='respawn'&&c.health<=0){
      if(this.time-this.deadAt<d.rules.player.respawnSeconds)return this.fail('Reconstitution takes five seconds.');
      c.position=[...d.world.spawn];c.health=s.health;c.energy=s.energy;this.deadAt=0;this.velocity=[0,0,0];this.ghostTrail.clear();this.ghostlines=[];this.event('notice',{text:'Signal recovered. Welcome back.'});return true;
    }
    return false;
  }
  fail(text){this.event('notice',{text});return false;}
}
