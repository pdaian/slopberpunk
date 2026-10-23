// Deterministic equipment families shared with server/src/economy.rs. GPL-3.0-or-later.
// IDs are permanent save/auction keys; changing a recipe never rerolls owned gear.
export const equipmentSlots = ['weapon','armor','implant','helmet','gloves','boots','belt','charm'];
export const statNames = {health:'maximum health',energy:'maximum energy',damage:'ability damage',speed:'movement speed',crit:'critical-hit chance',shield:'shield capacity',healing:'healing power',regen:'energy / second',armor:'damage reduction',haste:'shorter ability wait times',efficiency:'energy cost reduction',penetration:'armor penetration',leech:'damage returned as health',combo:'extra damage from attack combinations',goldFind:'gold from patrol enemies'};
export const percentStats = new Set(['damage','speed','armor','haste','efficiency','penetration','leech','combo','goldFind']);
export const statCaps = {speed:1.6,crit:60,armor:0.6,haste:0.4,efficiency:0.4,penetration:0.16,leech:0.2,goldFind:0.5,combo:1};
const expanded = new WeakSet();
const indexes = new WeakMap();
export function catalogItem(catalog,id) {
  let index = indexes.get(catalog);
  if (!index || index.size !== catalog.items.length) { index = new Map(catalog.items.map(i=>[i.id,i])); indexes.set(catalog,index); }
  return index.get(id);
}
export function expandCatalog(e) {
  if (!e?.generation || expanded.has(e)) return e;
  const g=e.generation, fail=()=>{throw new Error('Invalid economy generation.');};
  if(g.version!==1 || g.slots?.length!==8 || g.frames?.length!==6 || g.prefixes?.length!==10 || g.suffixes?.length!==10 || e.tiers?.length!==5 || e.rarities?.length!==5 || g.materials?.length!==5 || g.rarityWeights?.length!==5 || !g.rarityWeights.every(n=>Number.isInteger(n)&&n>0) || !(g.dropChance>0&&g.dropChance<=1))fail();
  for(const parts of [g.slots,g.frames,g.prefixes,g.suffixes]) {
    if(new Set(parts.map(p=>p.id)).size!==parts.length)fail();
    for(const p of parts)if(!/^[a-z0-9-]{1,12}$/.test(p.id)||!p.name||!Object.keys(p.stats||{}).length||Object.entries(p.stats).some(([k,v])=>!(k in statNames)||!Number.isFinite(v)||v<=0||v>1000))fail();
  }
  if(g.slots.some(s=>!equipmentSlots.includes(s.id)))fail();
  for(const id of g.materials)if(!e.items.some(i=>i.id===id&&i.kind==='material'))fail();
  // A cloned expanded catalog may be validated again without duplicating its families.
  const existing=e.items.filter(i=>i.id.startsWith('mod-'));
  if(existing.length) { if(existing.length!==24000)fail(); expanded.add(e); return e; }
  for(const tier of e.tiers)for(const slot of g.slots)for(const frame of g.frames)for(const [p,prefix] of g.prefixes.entries())for(const [s,suffix] of g.suffixes.entries()) {
    const grade=(p+s)%5, scale=tier.id*(1+grade*0.15), stats={};
    for(const part of [slot,frame,prefix,suffix])for(const [key,value] of Object.entries(part.stats))stats[key]=(stats[key]||0)+value;
    for(const key of Object.keys(stats))stats[key]=Math.round(stats[key]*scale*10000)/10000;
    const id=`mod-${tier.id}-${slot.id}-${frame.id}-${prefix.id}-${suffix.id}`, value=tier.id*20+grade*12;
    e.items.push({id,name:`${tier.name} ${prefix.name} ${frame.name} ${slot.name} ${suffix.name}`,tier:tier.id,rarity:e.rarities[grade].id,kind:'equipment',slot:slot.id,level:tier.level,stack:99,value,stats,description:`Equipment bonuses are listed below. Break it down at Patch to get ${tier.id+grade+1} ${e.items.find(i=>i.id===g.materials[tier.id-1]).name}.`});
    const ingredients={[g.materials[tier.id-1]]:10+tier.id*4+grade*4};
    if(tier.id>1)ingredients[g.materials[tier.id-2]]=6+grade*2;
    e.recipes.push({item:id,quantity:1,gold:value*4,ingredients});
  }
  expanded.add(e);indexes.delete(e);return e;
}
