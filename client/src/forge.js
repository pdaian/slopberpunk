// Shared cosmetic rules and presentation data. No combat stats or random rewards.
// GPL-3.0-or-later.
export const forgeStats = ['level','contracts','kills','orders','expeditions','routes'];
export const partDesigns = {
  head:['visor','mask','cyclops','antlers','crown'], shoulders:['plates','fenders','turbines','spires','bastions'],
  core:['split','grille','iris','shards','sun'], arms:['pistons','cuffs','coils','talons','hammers'],
  legs:['runners','treads','jets','stilts','sabatons'], back:['fins','stacks','wings','array','eclipse']
};
const count = n => Number.isSafeInteger(n) && n > 0 ? n : 0;
export function forgeProgress(c) {
  const history=Object.values(c.dungeonHistory||{}).filter(h=>count(h.clears)>0);
  return {level:count(c.level),contracts:new Set(c.completed||[]).size,kills:Object.values(c.mobKills||{}).reduce((n,k)=>n+count(k),0),orders:count(c.ordersCompleted),expeditions:history.reduce((n,h)=>n+count(h.clears),0),routes:history.length};
}
export function partUnlocked(item, progress) { return !item.unlock || (progress[item.unlock.stat]||0)>=item.unlock.target; }
export function collection(c, catalog) {
  const progress=forgeProgress(c),earned=catalog.items.filter(i=>partUnlocked(i,progress));
  const score=earned.reduce((n,i)=>n+catalog.rarities.find(r=>r.id===i.rarity).score,0);
  return {progress,earned,score,rank:forgeRank(score,catalog),next:catalog.ranks.find(r=>r.score>score)};
}
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
    if(progress&&!partUnlocked(item,progress))return `${item.name}: ${item.unlock.label}.`;
  }
  return '';
}
export function appearanceKey(a) {
  return a?JSON.stringify([a.frame,a.primary,a.secondary,a.energy,a.finish,a.pattern,...Object.keys(partDesigns).map(slot=>a.parts?.[slot])]):'';
}
export function validateForge(catalog) {
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
  for(const item of catalog.items) {
    if(!partDesigns[item.slot]?.includes(item.design)||designs.has(item.design)||!item.description||!item.set||!catalog.rarities.some(r=>r.id===item.rarity))fail();
    designs.add(item.design);
    if(item.unlock&&(!forgeStats.includes(item.unlock.stat)||!Number.isSafeInteger(item.unlock.target)||item.unlock.target<=0||!item.unlock.label))fail();
    if((item.rarity==='standard')===Boolean(item.unlock))fail();
  }
  if(appearanceProblem(catalog.default,catalog,{}))fail();
  return catalog;
}
// Ranking is confined to the current nearby snapshot, with equal scores sharing a place.
export function showcaseEntries(c,players,catalog) {
  const entries=[{...c,score:collection(c,catalog).score,self:true},...players.filter(p=>p.id!==c.id).map(p=>({...p,score:count(p.forge?.score)}))];
  const unique=[...new Map(entries.map(p=>[p.id,p])).values()].sort((a,b)=>b.score-a.score||(a.name||'').localeCompare(b.name||''));
  let rank=0;
  return unique.map((p,i)=>{if(!i||p.score!==unique[i-1].score)rank=i+1;return {...p,place:rank,rank:forgeRank(p.score,catalog)};});
}
