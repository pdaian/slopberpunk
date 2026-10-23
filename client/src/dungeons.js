// Expedition content validation and presentation.
// Online state and rewards are owned exclusively by the Rust expedition shard.
// GPL-3.0-or-later. See LICENSE.
import { distance } from './math.js';
import { escapeHtml as esc } from './icons.js';
import { inputPrompt } from './input-prompts.js';
import { World } from './world.js';
import { consequenceText, moralRecord } from './morality.js';

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
    if (!d.decision || ![d.decision.question,d.decision.deferred].every(prose) || !Array.isArray(d.decision.choices) || d.decision.choices.length !== 2 || new Set(d.decision.choices.map(c=>c.id)).size !== 2 || d.decision.choices.some(c=>!validId(c.id) || c.id==='defer' || ![c.label,c.cost,c.ending].every(prose)) || !d.reward || !Number.isSafeInteger(d.reward.xp) || d.reward.xp < 1 || d.reward.xp > 100000 || !Number.isSafeInteger(d.reward.gold) || d.reward.gold < 1 || d.reward.gold > 10000 || !d.production) fail();
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
export function ballotConsequences(data,c,d,choice) {
  const id=`dungeon:${d.id}`,decision=data.morality?.decisions[id];
  if(!decision)return '';
  const saved=moralRecord(c,id),option=decision.choices.find(o=>o.id===choice);
  if(saved)return `<p class="moral-record">Your first vote is saved: ${esc(decision.choices.find(o=>o.id===saved.choice)?.label||saved.choice)}. Repeating this dungeon does not give more reputation or choice reward points.</p>`;
  return option?`<p class="moral-effects">${esc(consequenceText(data,c,id,option))}</p><p class="muted">The first time you finish this dungeon, your own vote is saved permanently, even if you skip voting or the group chooses another ending. You earn its reputation changes and choice reward points only once.</p>`:'';
}

export function dungeonPanel(data,c,state,time) {
  const catalog=data.dungeons,run=state?.run,d=run&&catalog.entries.find(d=>d.id===run.dungeon);
  const button=(operation,label,extra='',disabled=false)=>`<button class="small-button" data-do="dungeon" data-operation="${operation}" ${run?`data-run="${run.id}" data-chapter="${run.chapter}" data-attempt="${run.attempt}"`:''} ${extra} ${disabled?'disabled':''}>${label}</button>`;
  const intro=`<p class="dialog-intro">Dungeons are optional missions with fights, clues, and a choice at the end. Each needs the exact number of players shown below. You can finish the main story without playing dungeons.</p><p class="guide-note">Any character type, faction, or talent setup can join. Everyone can heal, shield, read clues, and revive allies. ${inputPrompt("Press G to open this panel.","Press Menu and choose DUNGEONS to open this panel.","Tap DUNGEONS to open this panel.")} Select a clue, recovery station, or fallen player, move within 4 m, then ${inputPrompt("press E.","press X.","tap USE.")} Every player must choose READY before each chapter starts.</p>`;
  if(!d||!phases.has(run.phase)){
    const queue=state?.queue;
    return intro+(queue?`<div class="dungeon-status" role="status">Queued for ${esc(catalog.entries.find(d=>d.id===queue.dungeon)?.name||queue.dungeon)} · ${queue.waiting}/${queue.required} players · ${Math.max(0,Math.floor(time-queue.joined))}s waiting. ${button('leave','LEAVE QUEUE')}</div>`:'')+'<p class="muted">Choose JOIN QUEUE to wait for a group. You can wait for one dungeon at a time. When enough players join, you have 30 seconds to accept. The one-player dungeon also uses this button.</p>'+`<div class="card-grid">${catalog.entries.map(d=>`<article class="info-card dungeon-card" style="--dungeon-color:${d.color}"><span class="tag">${d.players} ${d.players===1?'PLAYER':'PLAYERS'} · LEVEL ${d.level}+ · ${d.chapters.length} CHAPTERS</span><h3>${esc(d.name)}</h3><p class="muted">${esc(d.venue)}</p><p>${esc(d.premise)}</p><p class="quest-meta">${d.reward.xp} BASE XP · ${d.reward.gold} gold · EQUAL REWARDS FOR EVERY ENDING</p>${button('queue',c.level<d.level?`REQUIRES LEVEL ${d.level}`:'JOIN QUEUE',`data-dungeon="${d.id}"`,Boolean(queue)||c.level<d.level||c.health<=0)}${c.dungeonHistory?.[d.id]?`<details class="dungeon-evidence"><summary tabindex="0">${esc(c.dungeonHistory[d.id].clears)} completion(s) · ${esc(d.decision.choices.find(o=>o.id===c.dungeonHistory[d.id].ending)?.label||'Decision postponed')}</summary><p>${esc(d.record)}</p><p>${esc(d.decision.choices.find(o=>o.id===c.dungeonHistory[d.id].ending)?.ending||d.decision.deferred)}</p></details>`:''}</article>`).join('')}</div>`;
  }
  const ch=d.chapters[run.chapter],remaining=Math.max(0,Math.ceil((run.deadline||0)-time));
  const roster=`<ul class="dungeon-roster">${run.members.map(m=>`<li>${esc(m.name)} · <span data-dungeon-vitals="${esc(m.id)}">${m.health<=0?'DEAD':`${Math.ceil(m.health)}/${Math.ceil(m.maxHealth)} HEALTH`}</span>${run.ready?.includes(m.id)?' · READY':''}${run.signed?.includes(m.id)?' · READ EVIDENCE':''}</li>`).join('')}</ul>`;
  let body='';
  if(run.phase==='ready')body=`<p>Your group is ready. Join within <strong data-dungeon-countdown>${remaining}</strong>s. If someone does not join, players who accepted keep their place in line. If you decline or run out of time, you leave the queue.</p>${button('ready','READY TO ENTER','',run.ready.includes(c.id))}`;
  else if(run.phase==='briefing')body=`${run.chapter?`<p class="npc-quote">${esc(d.chapters[run.chapter-1].reveal)}</p>`:''}<h3>${esc(ch.name)}</h3><p>${esc(ch.briefing)}</p><p class="guide-note">${esc(ch.warning)} Defeat all machines and read both clues. Every player must read at least one clue. The recovery station restores health once every ${catalog.rules.recoverySeconds} seconds. Each player can revive an ally ${catalog.rules.revivesPerEncounter} times in this chapter.</p>${button('begin','READY FOR THIS CHAPTER','',run.ready.includes(c.id))}`;
  else if(run.phase==='active')body=`<h3>${esc(ch.name)}</h3><p>${esc(ch.briefing)}</p><p class="guide-note">${esc(ch.warning)}</p><p>Evidence ${run.evidence.length}/${ch.evidence.length} · Players who read a clue ${run.signed.length}/${run.members.length} · Ally revives left: ${run.revivesLeft}</p><p>Close this panel to move and fight. Select a clue or recovery station, move within 4 m, then ${inputPrompt("press E to use it.","press X to use it.","tap USE.")} Clues you read stay in this panel.</p>`;
  else if(run.phase==='wipe')body=`<p>Everyone has died. This chapter restarts in <strong data-dungeon-countdown>${remaining}</strong>s. Earlier chapters stay complete. Restarting costs no gold or items.</p>`;
  else if(run.phase==='decision')body=`<p class="npc-quote">${esc(ch.reveal)}</p><h3>${esc(d.decision.question)}</h3><p><strong data-dungeon-countdown>${remaining}</strong>s to decide · ${Object.keys(run.votes).length}/${run.members.length} votes. You can change your vote until everyone has voted or time runs out. The option with the most votes wins. A tie, or a win for Skip vote, postpones the decision. Every ending gives the same XP and gold.</p>${d.decision.choices.map(o=>`<article class="info-card"><h3>${esc(o.label)}</h3><p>${esc(o.cost)}</p>${ballotConsequences(data,c,d,o.id)}${button('vote',run.votes[c.id]===o.id?'YOUR CURRENT VOTE':'VOTE FOR THIS',`data-choice="${o.id}"`)}</article>`).join('')}${ballotConsequences(data,c,d,'defer')}${button('vote',run.votes[c.id]==='defer'?'VOTE SKIPPED':'SKIP VOTE', 'data-choice="defer"')}`;
  else body=`<p class="tag">DUNGEON COMPLETE · REWARD RECEIVED</p><p class="npc-quote">${esc(d.decision.choices.find(o=>o.id===run.ending)?.ending||d.decision.deferred)}</p><p>${esc(d.record)}</p>${ballotConsequences(data,c,d,moralRecord(c,`dungeon:${d.id}`)?.choice||run.votes?.[c.id]||'defer')}<p>Your completion count and latest group ending are saved. Open QUESTS → Story to read them again.</p>`;
  const casebook=d.chapters.slice(0,run.chapter+1).map((chapter,i)=>{
    const known=i<run.chapter||['decision','complete'].includes(run.phase);
    const clues=chapter.evidence.filter(e=>known||(i===run.chapter&&run.evidence.includes(e.id)));
    return clues.length?`<details class="dungeon-evidence"><summary tabindex="0">${esc(chapter.name)} · ${clues.length} records</summary>${clues.map(e=>`<h4>${esc(e.name)}</h4><p>${esc(e.text)}</p>`).join('')}${known?`<p class="npc-quote">${esc(chapter.reveal)}</p>`:''}</details>`:'';
  }).join('');
  return `<p class="tag">${esc(d.name)} · ${d.players} PLAYERS · CHAPTER ${run.chapter+1}/${d.chapters.length}</p>${roster}${body}${casebook}<div class="settings-actions">${button('leave',run.phase==='complete'?'RETURN TO VESPER':run.phase==='ready'?'DECLINE':'END DUNGEON FOR EVERYONE')}</div>${!['ready','complete'].includes(run.phase)?'<p class="muted">Leaving or losing your connection ends this unfinished dungeon for everyone. You get no reward for a partial run. Previously completed dungeons stay in your history.</p>':''}`;
}
