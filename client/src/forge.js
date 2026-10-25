// Permanent collections, independent appearance/attunement and server-owned hunts.
// GPL-3.0-or-later.
import { statNames } from './item-catalog.js';
export const forgeStats = ['level','contracts','kills','orders','expeditions','routes'];
export const partDesigns = {
  head:['visor','mask','cyclops','antlers','crown','prism'], shoulders:['plates','fenders','turbines','spires','bastions','ramparts'],
  core:['split','grille','iris','shards','sun','lattice'], arms:['pistons','cuffs','coils','talons','hammers','clamps'],
  legs:['runners','treads','jets','stilts','sabatons','anchors'], back:['fins','stacks','wings','array','eclipse','orbit']
};
const count = n => Number.isSafeInteger(n) && n > 0 ? n : 0;
export function forgeProgress(c) {
  const history=Object.values(c.dungeonHistory||{}).filter(h=>count(h.clears)>0);
  return {level:count(c.level),contracts:new Set(c.completed||[]).size,kills:Object.values(c.mobKills||{}).reduce((n,k)=>n+count(k),0),orders:count(c.ordersCompleted),expeditions:history.reduce((n,h)=>n+count(h.clears),0),routes:history.length,hunts:c.forge?.hunts||{}};
}
export function partUnlocked(item, progress) { return item.hunt ? progress.hunts?.[item.id]?.found===true : !item.unlock || (progress[item.unlock.stat]||0)>=item.unlock.target; }
export function huntStatus(item,progress) {
  const h=item.hunt,record=progress.hunts?.[item.id],attempts=Math.min(count(record?.attempts),h.guarantee),unit=h.kind==='patrol'?'qualifying kills':'completions';
  return record?.found===true?`FOUND · ${attempts} ${unit} · permanently collected`:`${Number((h.chance*100).toFixed(3))}% each attempt · ${attempts} / ${h.guarantee} ${unit} · guaranteed within ${h.guarantee-attempts} more`;
}
export function collectionSets(c,catalog) {
  const progress=forgeProgress(c);
  return (catalog.sets||[]).map(set=>{
    const items=catalog.items.filter(i=>i.set===set.name),owned=items.filter(i=>partUnlocked(i,progress)).length;
    return {...set,items,owned,complete:owned===items.length};
  });
}
export function collection(c, catalog) {
  const progress=forgeProgress(c),earned=catalog.items.filter(i=>partUnlocked(i,progress)),sets=collectionSets(c,catalog);
  const score=earned.reduce((n,i)=>n+catalog.rarities.find(r=>r.id===i.rarity).score,0)+sets.filter(s=>s.complete).reduce((n,s)=>n+s.prestige,0);
  return {progress,earned,sets,score,rank:forgeRank(score,catalog),next:catalog.ranks.find(r=>r.score>score)};
}
// Preview may include locked parts. Live bonuses always check earned ownership.
export function frameBonuses(parts,catalog,c) {
  if(!parts||!Object.keys(parts).length||!catalog)return {stats:{},sets:[]};
  const stats={},sets=[],progress=c?forgeProgress(c):null;
  const fitted=(catalog?.items||[]).filter(i=>parts?.[i.slot]===i.id&&(!progress||partUnlocked(i,progress)));
  const add=bonuses=>{for(const [stat,value]of Object.entries(bonuses||{}))stats[stat]=(stats[stat]||0)+value;};
  fitted.forEach(i=>add(i.stats));
  for(const set of catalog?.sets||[]) {
    const count=fitted.filter(i=>i.set===set.name).length;
    if(!count)continue;
    const bonuses=set.bonuses.map(b=>({...b,active:count>=b.pieces}));
    bonuses.filter(b=>b.active).forEach(b=>add(b.stats));sets.push({...set,count,bonuses});
  }
  return {stats,sets};
}
export function forgeBonuses(c,catalog) { return frameBonuses(c.forge?.attuned,catalog,c).stats; }
export function forgeRank(score,catalog) { return [...catalog.ranks].reverse().find(r=>r.score<=score)||catalog.ranks[0]; }
export function defaultAppearance(catalog) { return structuredClone(catalog.default); }
export function appearanceProblem(appearance,catalog,c) {
  if(!appearance||typeof appearance!=='object'||Array.isArray(appearance))return 'Choose a frame first.';
  if(Object.keys(appearance).length!==7||Object.keys(appearance).some(k=>!['frame','primary','secondary','energy','finish','pattern','parts'].includes(k)))return 'Invalid frame configuration.';
  for(const [key,choices]of [['frame',catalog.frames],['finish',catalog.finishes],['pattern',catalog.patterns],...['primary','secondary','energy'].map(k=>[k,catalog.colors])]) {
    if(!choices.some(o=>o.id===appearance[key]))return `Choose a valid ${key}.`;
  }
  if(!appearance.parts||typeof appearance.parts!=='object'||Array.isArray(appearance.parts)||Object.keys(appearance.parts).length!==catalog.slots.length)return 'Fit one part in every slot.';
  const progress=c?forgeProgress(c):null;
  for(const slot of catalog.slots) {
    const item=catalog.items.find(i=>i.id===appearance.parts[slot.id]&&i.slot===slot.id);
    if(!item)return `Choose a valid ${slot.name.toLowerCase()}.`;
    if(progress&&!partUnlocked(item,progress))return `${item.name}: ${item.hunt?.label||item.unlock.label}.`;
  }
  return '';
}
export function appearanceKey(a) {
  return a?JSON.stringify([a.frame,a.primary,a.secondary,a.energy,a.finish,a.pattern,...Object.keys(partDesigns).map(slot=>a.parts?.[slot])]):'';
}
export function validateForge(catalog,data) {
  const fail=()=>{throw new Error('Invalid Frame Forge catalog.');};
  if(catalog?.version!==1)fail();
  for(const key of ['slots','frames','colors','finishes','patterns','rarities','items']) {
    const entries=catalog[key];
    if(!Array.isArray(entries)||!entries.length||new Set(entries.map(e=>e.id)).size!==entries.length||entries.some(e=>!/^[a-z][a-z0-9-]{0,31}$/.test(e.id)||!e.name))fail();
  }
  if(catalog.slots.length!==6||catalog.slots.some(s=>!partDesigns[s.id])||catalog.items.length>120||catalog.colors.some(c=>!/^#[0-9a-f]{6}$/i.test(c.hex))||catalog.frames.some(f=>!(f.width>=.8&&f.width<=1.25)))fail();
  if(catalog.rarities.some(r=>!/^#[0-9a-f]{6}$/i.test(r.color)||!Number.isInteger(r.score)||r.score<0))fail();
  if(!catalog.ranks?.length||catalog.ranks[0].score!==0||catalog.ranks.some((r,i)=>!r.name||!Number.isInteger(r.score)||(i&&r.score<=catalog.ranks[i-1].score)))fail();
  const designs=new Set();
  const statsOK=s=>s&&typeof s==='object'&&!Array.isArray(s)&&Object.entries(s).every(([key,value])=>Object.hasOwn(statNames,key)&&Number.isFinite(value)&&value>0&&value<=1000);
  for(const item of catalog.items) {
    if(!partDesigns[item.slot]?.includes(item.design)||designs.has(item.design)||!item.description||!item.set||!catalog.rarities.some(r=>r.id===item.rarity))fail();
    designs.add(item.design);
    if(item.unlock&&(!forgeStats.includes(item.unlock.stat)||!Number.isSafeInteger(item.unlock.target)||item.unlock.target<=0||!item.unlock.label))fail();
    if((item.rarity==='standard')===Boolean(item.unlock||item.hunt)||item.unlock&&item.hunt||!statsOK(item.stats||{}))fail();
    if(item.rarity!=='standard'&&!Object.keys(item.stats||{}).length)fail();
    if(item.rarity==='standard'&&Object.keys(item.stats||{}).length)fail();
    if(item.hunt){
      const h=item.hunt;
      if(!['patrol','expedition'].includes(h.kind)||!h.source||!h.label||!h.hint||!Number.isInteger(h.level)||h.level<0||h.level>60||!Number.isFinite(h.chance)||h.chance<=0||h.chance>1||!Number.isInteger(h.guarantee)||h.guarantee<1||h.guarantee>1000)fail();
      if(data&&(h.kind==='patrol'?!data.world.enemySpawns.some(s=>s.type===h.source&&s.level>=h.level):!data.dungeons.entries.some(d=>d.id===h.source&&d.level>=h.level)))fail();
    }
  }
  if(!Array.isArray(catalog.sets)||new Set(catalog.sets.map(s=>s.name)).size!==catalog.sets.length)fail();
  for(const set of catalog.sets){
    const items=catalog.items.filter(i=>i.set===set.name);
    if(!set.name||!set.description||!items.length||new Set(items.map(i=>i.slot)).size!==items.length||!Number.isInteger(set.prestige)||set.prestige<=0||set.prestige>1000||!Array.isArray(set.bonuses)||!set.bonuses.length)fail();
    if(set.bonuses.some((b,n)=>!Number.isInteger(b.pieces)||b.pieces<2||b.pieces>items.length||n&&b.pieces<=set.bonuses[n-1].pieces||!statsOK(b.stats)||!Object.keys(b.stats).length))fail();
  }
  if(catalog.items.some(i=>i.rarity!=='standard'&&!catalog.sets.some(s=>s.name===i.set)))fail();
  if(appearanceProblem(catalog.default,catalog,{}))fail();
  return catalog;
}
// Ranking is confined to the current nearby snapshot, with equal scores sharing a place.
export function showcaseEntries(c,players,catalog) {
  const own=collection(c,catalog);
  const entries=[{...c,score:own.score,owned:own.earned.length,sets:own.sets.filter(s=>s.complete).length,self:true},...players.filter(p=>p.id!==c.id).map(p=>({...p,score:count(p.forge?.score),owned:count(p.forge?.owned),sets:count(p.forge?.sets)}))];
  const unique=[...new Map(entries.map(p=>[p.id,p])).values()].sort((a,b)=>b.score-a.score||(a.name||'').localeCompare(b.name||''));
  let rank=0;
  return unique.map((p,i)=>{if(!i||p.score!==unique[i-1].score)rank=i+1;return {...p,place:rank,rank:forgeRank(p.score,catalog)};});
}
