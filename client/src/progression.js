// Long-form advancement and prerequisite-aware talent views. GPL-3.0-or-later.
import { escapeHtml as esc } from './icons.js';
import { formatGold } from './currency.js';
import { statNames } from './item-catalog.js';

const branchDescriptions = {Anchor:'Anchor improves health, armor, and shields.',Disruptor:'Disruptor improves damage and attack combinations.',Sustainer:'Sustainer improves healing and energy.',Runner:'Runner improves movement and critical hits.',Artificer:'Artificer makes abilities faster and cheaper to use, and adds armor.',Prospector:'Prospector earns more gold from patrol enemies and improves combat bonuses.'};

export function experienceFor(level,rules) { return Math.round((rules.xp.base+level*rules.xp.perLevel)*(rules.xp.multiplier||1)); }
export function talentBudget(c,rules) {
  return rules.talents.startingPoints+c.level*rules.talents.pointsPerLevel+(c.level<rules.levelCap?Math.min(rules.talents.pointsPerLevel-1,Math.floor(c.xp*rules.talents.pointsPerLevel/experienceFor(c.level,rules))):0);
}
export const spentTalents = c => Object.values(c.talents||{}).reduce((sum,n)=>sum+n,0);
export const respecCost = (c,rules) => rules.talents.respecBaseGold+c.level*rules.talents.respecGoldPerLevel;
export function talentBlock(c,data,t) {
  if(c.health<=0)return 'Return to life before learning talents.';
  if((c.talents?.[t.id]||0)>=t.maxRank)return 'Already at the highest rank.';
  if(c.level<t.level)return `Requires level ${t.level}.`;
  for(const r of t.requires||[])if((c.talents?.[r.id]||0)<r.rank)return `Requires ${data.talents.find(n=>n.id===r.id)?.name} rank ${r.rank}.`;
  const invested=data.talents.filter(n=>n.branch===t.branch).reduce((sum,n)=>sum+(c.talents?.[n.id]||0),0);
  if(invested<t.branchPoints)return `Spend ${t.branchPoints} points in ${t.branch} first.`;
  if(t.exclusive&&data.talents.some(n=>n.id!==t.id&&n.exclusive===t.exclusive&&(c.talents?.[n.id]||0)>0))return 'You already chose a final talent in this group. Visit Patch to reset your points and change it.';
  if(spentTalents(c)>=talentBudget(c,data.rules))return 'Earn more XP for your next talent point.';
  return '';
}
export function validateProgression(data) {
  const fail=()=>{throw new Error('Invalid progression content.');}, r=data.rules;
  if(r.xp.multiplier!==1100||!Number.isFinite(r.xp.base)||r.xp.base<=0||!Number.isFinite(r.xp.perLevel)||r.xp.perLevel<0||r.talents.startingPoints!==6||r.talents.pointsPerLevel!==4||r.inventory.packSlots!==160)fail();
  if(new Set(data.talents.map(t=>t.id)).size!==data.talents.length)fail();
  for(const t of data.talents) {
    if(!/^[a-z0-9-]{1,64}$/.test(t.id)||!(t.stat in statNames)||!Number.isInteger(t.row)||t.row<0||t.row>4||!Number.isInteger(t.column)||t.column<0||t.column>2||!Number.isInteger(t.branchPoints)||t.branchPoints<0||!Number.isInteger(t.level)||t.level<0||t.level>r.levelCap||!Number.isInteger(t.maxRank)||t.maxRank<1||t.maxRank>5||!Number.isFinite(t.amount)||t.amount<=0)fail();
    if(!Array.isArray(t.requires)||t.row>0&&!t.requires.length)fail();
    for(const req of t.requires) { const parent=data.talents.find(n=>n.id===req.id); if(!parent||parent.branch!==t.branch||parent.row>=t.row||parent.level>t.level||!Number.isInteger(req.rank)||req.rank<1||req.rank>parent.maxRank)fail(); }
  }
  if(new Set(data.abilities.map(a=>a.id)).size!==data.abilities.length||new Set(data.abilities.map(a=>a.key)).size!==data.abilities.length)fail();
  for(const a of data.abilities)if(!Number.isInteger(a.level)||a.level<0||a.level>r.levelCap||!['damage','stun','heal','shield','area','ghostline'].includes(a.kind)||!['','expose','siphon','execute'].includes(a.effect||'')||['cost','power','range'].some(k=>!Number.isFinite(a[k])||a[k]<0)||!Number.isFinite(a.cooldown)||a.cooldown<=0)fail();
}
export function talentPanel(c,data,branch='Anchor',nearby=false) {
  const branches=[...new Set(data.talents.map(t=>t.branch))], nodes=data.talents.filter(t=>t.branch===branch), points=talentBudget(c,data.rules)-spentTalents(c);
  const next=c.level<data.rules.levelCap?Math.ceil(experienceFor(c.level,data.rules)*(Math.floor(c.xp*4/experienceFor(c.level,data.rules))+1)/4)-c.xp:0;
  return `<p class="dialog-intro">${points} points to spend. You start with six points and earn one more every quarter of a level. ${next>0?`${next.toLocaleString('en-US')} XP to your next point.`:'Maximum level reached.'}</p><p>Talents give permanent bonuses. You can choose talents from any of the six groups below. Each talent lists what you must learn first. You can choose only one final talent per group. Spending three points in a group unlocks its extra bonus.</p><nav class="tabs" aria-label="Talent trees">${branches.map(b=>`<button class="${b===branch?'selected':''}" aria-current="${b===branch?'page':'false'}" data-do="talent-branch" data-id="${esc(b)}">${esc(b.toUpperCase())}</button>`).join('')}</nav><p>${esc(branchDescriptions[branch] || '')}</p><div class="talent-tree" aria-label="${esc(branch)} tree">${Array.from({length:5},(_,row)=>`<div class="talent-tier">${nodes.filter(t=>t.row===row).map(t=>{
    const reason=talentBlock(c,data,t), rank=c.talents?.[t.id]||0;
    return `<article class="talent-card ${rank?'trained':''}" style="grid-column:${t.column+1}"><small>${esc(t.path.toUpperCase())} · LEVEL ${t.level}${t.exclusive?' · CHOOSE ONE':''}</small><h3>${esc(t.name)}</h3><p>${esc(t.description)}</p><p class="talent-link">${t.requires.length?t.requires.map(r=>`${esc(data.talents.find(n=>n.id===r.id).name)} ${r.rank} →`).join(' '):'START HERE'}${t.branchPoints?` · ${t.branchPoints} points spent in this group`:''}</p><button class="small-button" data-do="learn-talent" data-id="${t.id}" ${reason?'disabled':''}>${rank} / ${t.maxRank}${reason?'':' · LEARN / 1 POINT'}</button><small>${esc(reason||'Ready to learn.')}</small></article>`;
  }).join('')}</div>`).join('')}</div><p>Visit Patch to reset all your talents for ${formatGold(respecCost(c,data.rules))} gold. You get your points back to spend again. This does not refill health or energy.</p><button class="small-button" data-do="respec" ${nearby&&c.health>0&&spentTalents(c)>0&&c.gold>=respecCost(c,data.rules)?'':'disabled'}>RESET TALENTS / ${formatGold(respecCost(c,data.rules))} GOLD</button>`;
}
