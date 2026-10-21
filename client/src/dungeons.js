// Expedition content contract, local solo authority, and shared presentation.
// Online state and rewards are owned exclusively by the Rust expedition shard.
// GPL-3.0-or-later. See LICENSE.
import { distance } from './math.js';
import { escapeHtml as esc } from './icons.js';
import { World } from './world.js';

const phases = new Set(['ready','briefing','active','wipe','decision','complete']);
const validId = id => typeof id === 'string' && /^[a-z][a-z0-9-]{1,63}$/.test(id);
const prose = value => typeof value === 'string' && value.trim().length > 0;
export function validateDungeons(catalog, data) {
  const fail = () => { throw new Error('Invalid dungeon content. Check dungeons.json.'); };
  if (catalog?.version !== 1 || !catalog.rules || !Array.isArray(catalog.entries) || !catalog.entries.length || catalog.entries.length > 32) fail();
  const r = catalog.rules, vector = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  for (const key of ['readySeconds','voteSeconds','maxRunSeconds','arenaRadius','recoverySeconds','recoveryFraction','revivesPerEncounter','pulseSeconds','warningSeconds','pulseFraction','enemyHealthPerPlayer','enemyHealthPerLevel','enemyDamageFraction']) if (!Number.isFinite(r[key]) || r[key] <= 0) fail();
  if (!vector(r.arena) || r.arena[1] !== 0 || !vector(r.recoveryPosition) || r.recoveryPosition[1] !== 0 || r.arenaRadius < 20 || r.arenaRadius > 40 || Math.abs(r.arena[0]) + r.arenaRadius >= data.world.bounds || Math.abs(r.arena[2]) + r.arenaRadius >= data.world.bounds || distance(r.arena,r.recoveryPosition) >= r.arenaRadius || r.readySeconds < 10 || r.readySeconds > 120 || r.voteSeconds < 30 || r.voteSeconds > 300 || r.maxRunSeconds < r.voteSeconds || r.maxRunSeconds > 7200 || r.warningSeconds < 3 || r.warningSeconds >= r.pulseSeconds || r.pulseSeconds > 30 || r.recoverySeconds < 1 || r.recoveryFraction > 1 || r.pulseFraction >= 1 || r.enemyDamageFraction >= .1 || !Number.isInteger(r.revivesPerEncounter) || r.revivesPerEncounter > 5) fail();
  const ids = new Set();
  if(new World(data.world).buildings.some(b=>Math.abs(b.x-r.arena[0])<b.w/2+r.arenaRadius+1&&Math.abs(b.z-r.arena[2])<b.d/2+r.arenaRadius+1))fail();
  for (const d of catalog.entries) {
    if (!validId(d.id) || ids.has(d.id) || !Number.isInteger(d.players) || d.players < 1 || d.players > 8 || !Number.isInteger(d.level) || d.level < 0 || d.level > data.rules.levelCap || !/^#[0-9a-f]{6}$/i.test(d.color) || !['bells','ferry','court','orchard','theatre','harbor'].includes(d.motif) || ![d.name,d.venue,d.premise].every(prose) || !Array.isArray(d.chapters) || d.chapters.length < 1 || d.chapters.length > 8) fail();
    ids.add(d.id); const chapters = new Set();
    for (const c of d.chapters) {
      if (!validId(c.id) || chapters.has(c.id) || ![c.name,c.briefing,c.boss,c.reveal,c.warning].every(prose) || !data.enemies.some(e=>e.id===c.enemy) || !['lanes','ring','cross'].includes(c.pattern) || !Number.isFinite(c.healthMultiplier) || c.healthMultiplier < 1 || c.healthMultiplier > 4 || !Array.isArray(c.evidence) || c.evidence.length !== 2) fail();
      chapters.add(c.id); const evidence = new Set();
      for (const e of c.evidence) {
        if (!validId(e.id) || evidence.has(e.id) || ![e.name,e.text].every(prose) || !vector(e.position) || e.position[1] !== 0 || Math.max(Math.abs(e.position[0]),Math.abs(e.position[2])) > r.arenaRadius - 3) fail();
        evidence.add(e.id);
      }
    }
    if (!d.decision || ![d.decision.question,d.decision.deferred].every(prose) || !Array.isArray(d.decision.choices) || d.decision.choices.length !== 2 || new Set(d.decision.choices.map(c=>c.id)).size !== 2 || d.decision.choices.some(c=>!validId(c.id) || c.id==='defer' || ![c.label,c.cost,c.ending].every(prose)) || !d.reward || !Number.isSafeInteger(d.reward.xp) || d.reward.xp < 1 || d.reward.xp > 100000 || !Number.isSafeInteger(d.reward.credits) || d.reward.credits < 1 || d.reward.credits > 10000 || !d.production) fail();
  }
  return catalog;
}

export const dungeonPosition = (rules, offset) => rules.arena.map((v,i)=>v+offset[i]);
export function dungeonZones(r, chapter, pulse) {
  const n=r.arenaRadius;
  // Rectangles are shared by visible warnings and damage; jumping does not bypass them.
  if(chapter.pattern==='lanes') return [[pulse%2?-n/2:n/2,0,n,2*n]];
  if(chapter.pattern==='cross') return [[0,0,8,2*n],[0,0,2*n,8]];
  return [[-(n+8)/2,0,n-8,2*n],[(n+8)/2,0,n-8,2*n],[0,-(n+8)/2,16,n-8],[0,(n+8)/2,16,n-8]];
}
export function dungeonInDanger(r, chapter, pulse, position) {
  return dungeonZones(r,chapter,pulse).some(([x,z,w,h])=>Math.abs(position[0]-r.arena[0]-x)<=w/2&&Math.abs(position[2]-r.arena[2]-z)<=h/2);
}
export function dungeonEnemies(data, definition, chapter, run, attempt) {
  const r=data.dungeons.rules,c=definition.chapters[chapter],template=data.enemies.find(e=>e.id===c.enemy),count=Math.ceil(definition.players/2);
  const health=Math.ceil(definition.players*(r.enemyHealthPerPlayer+definition.level*r.enemyHealthPerLevel)*c.healthMultiplier/count);
  return Array.from({length:count},(_,i)=>{
    const position=dungeonPosition(r,[(i-(count-1)/2)*6,0,-4]);
    return {...template,id:`dungeon-${run}-${chapter}-${attempt}-${i}`,instance:run,type:c.enemy,name:count===1?c.boss:`${c.boss} ${i+1}`,color:definition.color,position,home:[...position],level:definition.level,maxHealth:health,health,damage:0,speed:3,attackAt:0,stunUntil:0,respawnAt:Infinity,yaw:0};
  });
}

export class LocalDungeon {
  constructor(sim,definition,id) {
    this.sim=sim;this.definition=definition;this.rules=sim.data.dungeons.rules;
    this.view={id,dungeon:definition.id,phase:'ready',chapter:0,attempt:0,ready:[],evidence:[],signed:[],votes:{},deadline:sim.time+this.rules.readySeconds,started:sim.time,pulse:0,nextPulse:0,recoveryReady:0,revivesLeft:this.rules.revivesPerEncounter};
    this.cityEnemies=sim.enemies;
  }
  get active(){return this.view.phase!=='ready';}
  snapshot(){const c=this.sim.character;return {...this.view,members:[{id:c.id,name:c.name,health:c.health,maxHealth:this.sim.playerStats.health}]};}
  resetPosition(){
    const s=this.sim,c=s.character;c.position=dungeonPosition(this.rules,[0,0,14]);c.yaw=0;c.health=s.playerStats.health;c.energy=s.playerStats.energy;
    s.velocity=[0,0,0];s.grounded=true;s.jumpBuffer=0;s.coyote=0;s.dash=0;s.shield=0;s.deadAt=0;s.ghostTrail.clear();s.ghostlines=[];
  }
  enter(){
    const s=this.sim;s.character.dungeonReturn=[...s.data.world.spawn];this.resetPosition();s.enemies=[];
    this.view.phase='briefing';this.view.ready=[];this.view.deadline=0;s.event('notice',{text:'Expedition ready. Open Dungeons [G] to read your first chapter.'});
  }
  begin(){
    const s=this.sim,v=this.view;v.phase='active';v.attempt++;v.ready=[];v.evidence=[];v.signed=[];v.pulse=0;v.nextPulse=s.time+this.rules.pulseSeconds;v.recoveryReady=0;v.revivesLeft=this.rules.revivesPerEncounter;
    s.enemies=dungeonEnemies(s.data,this.definition,v.chapter,v.id,v.attempt);
  }
  leave(message='Returned to Vesper.'){
    const s=this.sim;if(this.active){s.character.position=s.character.dungeonReturn||[...s.data.world.spawn];delete s.character.dungeonReturn;s.character.health=s.playerStats.health;s.character.energy=s.playerStats.energy;s.enemies=this.cityEnemies;s.velocity=[0,0,0];s.ghostTrail.clear();s.ghostlines=[];s.shield=0;s.deadAt=0;}
    s.expedition=null;s.event('notice',{text:message});return true;
  }
  act(a){
    const s=this.sim,v=this.view,c=s.character;if(a.run!==v.id)return false;
    if(a.operation==='leave')return this.leave();
    if(a.chapter!==v.chapter||a.attempt!==v.attempt)return false;
    if(a.operation==='ready'&&v.phase==='ready'&&s.time<v.deadline&&c.health>0){this.enter();return true;}
    if(a.operation==='begin'&&v.phase==='briefing'){this.begin();return true;}
    if(a.operation==='vote'&&v.phase==='decision'&&s.time<v.deadline&&(a.choice==='defer'||this.definition.decision.choices.some(o=>o.id===a.choice))){v.votes[c.id]=a.choice;this.finish(a.choice);return true;}
    if(v.phase!=='active'||c.health<=0)return false;
    if(a.operation==='recover'&&s.time>=v.recoveryReady&&distance(c.position,this.rules.recoveryPosition)<4){c.health=Math.min(s.playerStats.health,c.health+s.playerStats.health*this.rules.recoveryFraction);v.recoveryReady=s.time+this.rules.recoverySeconds;s.event('sound',{name:'heal'});return true;}
    if(a.operation==='interact'){
      const e=this.definition.chapters[v.chapter].evidence.find(e=>e.id===a.target);
      if(!e||distance(c.position,dungeonPosition(this.rules,e.position))>=4)return false;
      if(!v.evidence.includes(e.id))v.evidence.push(e.id);if(!v.signed.includes(c.id))v.signed.push(c.id);
      s.event('notice',{text:`Evidence recorded: ${e.name}. Read it in Dungeons [G].`});return true;
    }
    return false;
  }
  finish(choice){
    const s=this.sim,v=this.view;if(v.phase!=='decision')return;
    v.phase='complete';v.ending=choice;v.deadline=0;const d=this.definition;
    const history=s.character.dungeonHistory||={};history[d.id]={clears:(history[d.id]?.clears||0)+1,ending:choice};
    s.character.credits+=d.reward.credits;const xp=s.gainXp(d.reward.xp);
    s.event('reward',{xp,credits:d.reward.credits});s.event('notice',{text:'Expedition complete. Your ending is in the casebook.'});
  }
  tick(){
    const s=this.sim,v=this.view,c=s.character,r=this.rules;
    if(s.time-v.started>=r.maxRunSeconds)return this.leave('Expedition time limit reached. Your completed chapters earned no partial reward.');
    if(v.phase==='ready'){if(s.time>=v.deadline||c.health<=0)this.leave('Ready check ended. Queue again when ready.');return;}
    if(v.phase==='decision'){if(s.time>=v.deadline)this.finish(v.votes[c.id]||'defer');return;}
    if(v.phase==='wipe'){if(s.time>=v.deadline){this.resetPosition();v.phase='briefing';v.ready=[];v.evidence=[];v.signed=[];v.deadline=0;s.enemies=[];}return;}
    if(v.phase!=='active')return;
    if(c.health<=0){v.phase='wipe';v.deadline=s.time+s.data.rules.player.respawnSeconds;s.enemies=[];return;}
    const chapter=this.definition.chapters[v.chapter];
    if(s.time>=v.nextPulse){
      if(dungeonInDanger(r,chapter,v.pulse,c.position)){
        const damage=Math.round(s.playerStats.health*r.pulseFraction),absorbed=Math.min(s.shield,damage);s.shield-=absorbed;c.health=Math.max(0,c.health-damage+absorbed);s.lastCombat=s.time;s.event('hurt',{amount:damage-absorbed});
        if(c.health<=0){s.deadAt=s.time;s.event('death');}
      }
      v.pulse++;v.nextPulse=s.time+r.pulseSeconds;
    }
    if(c.health>0&&s.enemies.every(e=>e.health<=0)&&v.evidence.length===chapter.evidence.length&&v.signed.includes(c.id)){
      s.enemies=[];s.ghostlines=[];s.ghostTrail.clear();c.health=s.playerStats.health;c.energy=s.playerStats.energy;
      if(v.chapter+1===this.definition.chapters.length){v.phase='decision';v.deadline=s.time+r.voteSeconds;}
      else {v.chapter++;v.phase='briefing';v.ready=[];v.evidence=[];v.signed=[];}
      s.event('notice',{text:'Chapter complete. Open Dungeons [G] for the discovery and next chapter.'});
    }
  }
}

export function dungeonPanel(data,c,state,online,time) {
  const catalog=data.dungeons,run=state?.run,d=run&&catalog.entries.find(d=>d.id===run.dungeon);
  const button=(operation,label,extra='',disabled=false)=>`<button class="small-button" data-do="dungeon" data-operation="${operation}" ${run?`data-run="${run.id}" data-chapter="${run.chapter}" data-attempt="${run.attempt}"`:''} ${extra} ${disabled?'disabled':''}>${label}</button>`;
  const intro='<p class="dialog-intro">Find a crew. Follow the evidence. Decide what the city keeps.</p><p class="guide-note">Any lineage, faction, or talent combination. Everyone can heal, shield, investigate, and revive. G opens this casebook; E uses nearby evidence, the aid station, or a fallen ally. Each chapter waits for every runner before combat begins.</p>';
  if(!d||!phases.has(run.phase)){
    const queue=state?.queue;
    return intro+(queue?`<div class="dungeon-status" role="status">Queued for ${esc(catalog.entries.find(d=>d.id===queue.dungeon)?.name||queue.dungeon)} · ${queue.waiting}/${queue.required} runners · ${Math.max(0,Math.floor(time-queue.joined))}s waiting. ${button('leave','LEAVE QUEUE')}</div>`:'')+(!online?'<p class="guide-note">Local play supports The Ninth Bell for one runner. Sign into the realm for the shared group queue.</p>':'<p class="muted">Queue for one dungeon at a time. Matching uses arrival order and exact headcount, with a 30-second ready check. Queue members may have any build.</p>')+`<div class="card-grid">${catalog.entries.map(d=>`<article class="info-card dungeon-card" style="--dungeon-color:${d.color}"><span class="tag">${d.players} ${d.players===1?'RUNNER':'RUNNERS'} · LEVEL ${d.level}+ · ${d.chapters.length} CHAPTERS</span><h3>${esc(d.name)}</h3><p class="muted">${esc(d.venue)}</p><p>${esc(d.premise)}</p><p class="quest-meta">${d.reward.xp} BASE XP · ${d.reward.credits} ¤ · EQUAL REWARDS FOR EVERY ENDING</p>${button('queue',d.players>1&&!online?'ONLINE GROUP REQUIRED':c.level<d.level?`REQUIRES LEVEL ${d.level}`:'JOIN QUEUE',`data-dungeon="${d.id}"`,Boolean(queue)||c.level<d.level||c.health<=0||(!online&&d.players>1))}${c.dungeonHistory?.[d.id]?`<details class="dungeon-evidence"><summary tabindex="0">${esc(c.dungeonHistory[d.id].clears)} clear(s) · ${esc(d.decision.choices.find(o=>o.id===c.dungeonHistory[d.id].ending)?.label||'Provisional settlement')}</summary><p>${esc(d.decision.choices.find(o=>o.id===c.dungeonHistory[d.id].ending)?.ending||d.decision.deferred)}</p></details>`:''}</article>`).join('')}</div>`;
  }
  const ch=d.chapters[run.chapter],remaining=Math.max(0,Math.ceil((run.deadline||0)-time));
  const roster=`<ul class="dungeon-roster">${run.members.map(m=>`<li>${esc(m.name)} · <span data-dungeon-vitals="${esc(m.id)}">${m.health<=0?'DOWN':`${Math.ceil(m.health)}/${Math.ceil(m.maxHealth)} HP`}</span>${run.ready?.includes(m.id)?' · READY':''}${run.signed?.includes(m.id)?' · SIGNED':''}</li>`).join('')}</ul>`;
  let body='';
  if(run.phase==='ready')body=`<p>A crew is assembled. Accept within <strong data-dungeon-countdown>${remaining}</strong>s. Accepted runners keep their queue priority if the check fails. Declining or timing out removes your ticket.</p>${button('ready','READY TO ENTER','',run.ready.includes(c.id))}`;
  else if(run.phase==='briefing')body=`${run.chapter?`<p class="npc-quote">${esc(d.chapters[run.chapter-1].reveal)}</p>`:''}<h3>${esc(ch.name)}</h3><p>${esc(ch.briefing)}</p><p class="guide-note">${esc(ch.warning)} Disable the machines, read both stations, and have every runner sign at least one. The aid station restores health every ${catalog.rules.recoverySeconds}s. Each runner has ${catalog.rules.revivesPerEncounter} revives this encounter.</p>${button('begin','READY FOR THIS CHAPTER','',run.ready.includes(c.id))}`;
  else if(run.phase==='active')body=`<h3>${esc(ch.name)}</h3><p>${esc(ch.briefing)}</p><p class="guide-note">${esc(ch.warning)}</p><p>Evidence ${run.evidence.length}/${ch.evidence.length} · Signatures ${run.signed.length}/${run.members.length} · Your revives: ${run.revivesLeft}</p><p>Close this panel to move and fight. E interacts within 4 m. Evidence is retained here after reading.</p>`;
  else if(run.phase==='wipe')body=`<p>The crew is down. This chapter resets in <strong data-dungeon-countdown>${remaining}</strong>s. Earlier chapters remain complete; no entry fee or item is consumed.</p>`;
  else if(run.phase==='decision')body=`<p class="npc-quote">${esc(ch.reveal)}</p><h3>${esc(d.decision.question)}</h3><p><strong data-dungeon-countdown>${remaining}</strong>s to decide · ${Object.keys(run.votes).length}/${run.members.length} ballots. Revise your ballot until everyone has voted or the timer ends. Most votes wins; ties or an abstention win produce a provisional settlement. Every ending awards the same reward.</p>${d.decision.choices.map(o=>`<article class="info-card"><h3>${esc(o.label)}</h3><p>${esc(o.cost)}</p>${button('vote',run.votes[c.id]===o.id?'BALLOT RECORDED':'VOTE FOR THIS',`data-choice="${o.id}"`)}</article>`).join('')}${button('vote',run.votes[c.id]==='defer'?'ABSTENTION RECORDED':'ABSTAIN', 'data-choice="defer"')}`;
  else body=`<p class="tag">EXPEDITION COMPLETE · REWARD AWARDED</p><p class="npc-quote">${esc(d.decision.choices.find(o=>o.id===run.ending)?.ending||d.decision.deferred)}</p><p>Your clear count and last ending are saved with your character. The group decision does not claim that every runner agreed.</p>`;
  const casebook=d.chapters.slice(0,run.chapter+1).map((chapter,i)=>{
    const known=i<run.chapter||['decision','complete'].includes(run.phase);
    const clues=chapter.evidence.filter(e=>known||(i===run.chapter&&run.evidence.includes(e.id)));
    return clues.length?`<details class="dungeon-evidence"><summary tabindex="0">${esc(chapter.name)} · ${clues.length} records</summary>${clues.map(e=>`<h4>${esc(e.name)}</h4><p>${esc(e.text)}</p>`).join('')}${known?`<p class="npc-quote">${esc(chapter.reveal)}</p>`:''}</details>`:'';
  }).join('');
  return `<p class="tag">${esc(d.name)} · ${d.players} RUNNERS · CHAPTER ${run.chapter+1}/${d.chapters.length}</p>${roster}${body}${casebook}<div class="settings-actions">${button('leave',run.phase==='complete'?'RETURN TO VESPER':run.phase==='ready'?'DECLINE':'END EXPEDITION FOR CREW')}</div>${!['ready','complete'].includes(run.phase)?'<p class="muted">Leaving or disconnecting ends this unfinished expedition for the crew. No partial reward is granted. Completed expeditions remain available in your character history.</p>':''}`;
}
