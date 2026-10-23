// Client movement prediction and display helpers. All gameplay is server-authoritative.
// GPL-3.0-or-later. See LICENSE.
import { clamp } from './math.js';
import { isSpirit } from './death.js';
import { economyBonuses } from './economy.js';
import { statCaps, statNames } from './item-catalog.js';
import { moralBonuses } from './morality.js';
import { ridePosition } from './elevators.js';
export { experienceFor } from './progression.js';

export function stats(character, data) {
  const r=data.rules.player;
  const s={...Object.fromEntries(Object.keys(statNames).map(k=>[k,0])),health:r.health+character.level*r.healthPerLevel,energy:r.energy,speed:1,crit:data.rules.combat.crit,damage:1};
  const race=data.races.find(r=>r.id===character.race);
  if(race?.passive) s[race.passive.stat]+=race.passive.value;
  for(const talent of data.talents) s[talent.stat]+=Math.min(character.talents?.[talent.id]||0,talent.maxRank)*talent.amount;
  for(const bonuses of economyBonuses(character,data))for(const [stat,value] of Object.entries(bonuses))s[stat]+=value;
  for(const [stat,value] of Object.entries(moralBonuses(character,data)))s[stat]+=value;
  for(const [stat,cap] of Object.entries(statCaps))s[stat]=Math.min(s[stat],cap);
  if(character.resurrectionSickness>0){s.damage*=data.rules.death.sicknessDamageMultiplier;s.speed*=data.rules.death.sicknessSpeedMultiplier;}
  return s;
}
export function availableQuest(q,c) {
  return (!q.faction||q.faction===c.faction)&&(!q.race||q.race===c.race)&&q.level<=c.level&&q.requires.every(id=>c.completed.includes(id))&&!c.completed.includes(q.id)&&c.activeQuests[q.id]===undefined;
}

export class Prediction {
  constructor(data,world,character,emit=()=>{}) {
    this.data=data;this.world=world;this.character=character;this.emit=emit;this.time=0;
    this.dungeonState=null;this.enemies=[];this.worldEvents=[];
    this.elevator=null;
    this.velocity=[0,0,0];this.grounded=true;this.coyote=0;this.jumpBuffer=0;this.dash=0;this.dashReady=0;this.cooldowns={};this.shield=0;
  }
  get playerStats(){return stats(this.character,this.data);}
  get dungeon(){return this.dungeonState;}
  get inDungeon(){return Boolean(this.dungeonState?.run&&this.dungeonState.run.phase!=='ready');}
  event(type,detail={}){this.emit({type,...detail});}
  tick(dt,input={}) {
    dt=Math.min(dt,.05);this.time+=dt;
    const c=this.character,m=this.data.rules.movement,s=this.playerStats;
    const spirit=isSpirit(c);
    if(c.health<=0&&!spirit)return;
    if(input.yaw!==undefined&&Number.isFinite(input.yaw))c.yaw=input.yaw;
    if(this.elevator){c.position=ridePosition(this.elevator,this.time);this.velocity=[0,0,0];this.dash=0;this.jumpBuffer=0;this.coyote=0;this.grounded=true;return;}
    if(input.jump)this.jumpBuffer=m.jumpBuffer;else this.jumpBuffer=Math.max(0,this.jumpBuffer-dt);
    this.coyote=this.grounded?m.coyoteTime:Math.max(0,this.coyote-dt);
    if(this.jumpBuffer>0&&this.coyote>0){this.velocity[1]=m.jump;this.grounded=false;this.coyote=0;this.jumpBuffer=0;this.event('sound',{name:'jump'});}
    if(input.dash&&this.time>=this.dashReady){this.dash=m.dashDuration;this.dashReady=this.time+m.dashCooldown;this.event('sound',{name:'surge'});}
    this.dash=Math.max(0,this.dash-dt);
    let f=clamp(input.forward||0,-1,1),side=clamp(input.strafe||0,-1,1),len=Math.hypot(f,side);
    if(len>1){f/=len;side/=len;}
    if(this.dash>0&&!f&&!side)f=1;
    const speed=(this.dash>0?m.dashSpeed:input.sprint?m.sprint:m.speed)*(spirit?this.data.rules.death.spiritSpeedMultiplier:s.speed);
    const tx=(-Math.sin(c.yaw)*f+Math.cos(c.yaw)*side)*speed,tz=(-Math.cos(c.yaw)*f-Math.sin(c.yaw)*side)*speed;
    const accel=(this.grounded?1:m.airControl)*m.acceleration*dt;
    for(const [axis,target]of[[0,tx],[2,tz]])this.velocity[axis]+=clamp(target-this.velocity[axis],-accel,accel);
    if(!len&&this.dash===0&&this.grounded){this.velocity[0]*=Math.exp(-m.friction*dt);this.velocity[2]*=Math.exp(-m.friction*dt);}
    const p=c.position;
    // Substeps prevent a dash crossing a narrow wall at a low frame rate.
    const steps=Math.max(1,Math.ceil(Math.hypot(this.velocity[0],this.velocity[2])*dt/.35));
    for(let i=0;i<steps;i++){
      const arena=this.inDungeon?this.data.dungeons.rules:null;
      for(const axis of [0,2]){
        const next=this.world.stepPosition(p,axis,this.velocity[axis]*dt/steps,this.grounded,m.radius,m.height);
        if(next&&(!arena||Math.abs(next[axis]-arena.arena[axis])<=arena.arenaRadius)){p[axis]=next[axis];p[1]=next[1];}else this.velocity[axis]=0;
      }
    }
    this.velocity[1]-=m.gravity*dt;let nextY=p[1]+this.velocity[1]*dt;
    if(this.velocity[1]>0){const ceiling=this.world.ceilingAt(p[0],p[2],p[1],nextY,m.radius,m.height);if(nextY>=ceiling){nextY=ceiling;this.velocity[1]=0;}}
    const floor=this.world.floorAt(p[0],p[2],p[1],nextY);
    if(nextY<=floor){p[1]=floor;this.velocity[1]=0;this.grounded=true;}else{p[1]=nextY;this.grounded=false;}
  }
}
