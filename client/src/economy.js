// Catalog-backed economy views and stat previews. Mutations belong to the server.
// GPL-3.0-or-later.
import { escapeHtml as esc } from './icons.js';
import { formatGold } from './currency.js';
import { distance } from './math.js';
import { equipmentSlots, statNames, percentStats, expandCatalog, catalogItem } from './item-catalog.js';
import { moralGearPanel } from './morality.js';
import { forgeBonuses, forgeProgress, huntStatus } from './forge.js';
export { equipmentSlots } from './item-catalog.js';

export const itemById = (data, id) => data.economy && catalogItem(data.economy,id);
export const itemCount = (c, id) => id === 'medkit' ? c.medkits || 0 : c.items?.[id] || 0;
export const itemRoom = (c,data,i) => i.id!=='medkit'&&!c.items?.[i.id]&&Object.keys(c.items||{}).length>=data.rules.inventory.packSlots?0:i.stack-itemCount(c,i.id);
export const tierFor = (data, level) => [...data.economy.tiers].reverse().find(t => level >= t.level);
export const nearPatch = (data, c) => data.npcs.some(n => n.id === 'merchant' && distance(c.position, n.position) < data.rules.interactionRadius);
export function classBonuses(c, data) {
  return (data.economy?.classes || []).map(b => ({ ...b, invested:data.talents.filter(t => t.branch === b.branch).reduce((n,t) => n + Math.min(c.talents?.[t.id] || 0,t.maxRank),0) }));
}
export function economyBonuses(c, data) {
  const bonuses = [];
  for (const [slot,id] of Object.entries(c.equipment || {})) {
    const i = itemById(data,id);
    if (i?.kind === 'equipment' && i.slot === slot && c.level >= i.level) bonuses.push(i.stats);
  }
  for (const b of classBonuses(c,data)) if (b.invested >= b.points) bonuses.push(b.stats);
  for (const [id,remaining] of Object.entries(c.buffs || {})) {
    const i = itemById(data,id);
    if (remaining > 0 && i?.kind === 'consumable' && i.duration > 0) bonuses.push(i.stats);
  }
  return bonuses;
}
export function statText(stats = {}) {
  return Object.entries(stats).filter(([,v]) => v).map(([key,value]) => {
    const percent = percentStats.has(key), n = Math.round(value * (percent ? 100 : 1) * 100) / 100;
    return `${n > 0 ? '+' : ''}${n}${percent ? '%' : key === 'crit' ? ' percentage points' : ''} ${statNames[key] || key}`;
  }).join(' · ');
}
export function equipmentComparison(c, data, item) {
  const current = itemById(data,c.equipment?.[item.slot]), before = current?.stats || {}, after = item.stats || {};
  const delta = Object.fromEntries([...new Set([...Object.keys(before),...Object.keys(after)])].map(key => [key,(after[key] || 0) - (before[key] || 0)]));
  return `${current ? `Compared with ${current.name}` : 'Compared with an empty slot'}: ${statText(delta) || 'same bonuses'}.`;
}
export function itemLabel(data, item) {
  if (!item) return 'Unknown item';
  const r = data.economy.rarities.find(r => r.id === item.rarity);
  return `<strong style="color:${esc(r.color)}">${esc(item.name)}</strong><small class="item-meta">Tier ${item.tier} · ${esc(r.name)} · ${esc(item.slot || item.kind)} · Level ${item.level}+</small>`;
}
export function economyTabs(selected) {
  return `<nav class="tabs" aria-label="Equipment and trading">${[['inventory','GEAR & BONUSES'],['forge','FRAME FORGE'],['crafting','CRAFTING'],['orders','WORK ORDERS'],['bestiary','ENEMIES & LOOT'],['auctions','AUCTION HOUSE']].map(([id,name]) => `<button class="${selected === id ? 'selected' : ''}" data-do="${id}" aria-current="${selected === id ? 'page' : 'false'}">${name}</button>`).join('')}</nav>`;
}
export function workOrdersPanel(c,data) {
  const nearby=nearPatch(data,c)&&c.health>0;
  return `${economyTabs('orders')}<p>Take one repeatable job from Patch. Defeat the listed patrol enemies, then return to Patch for gold and XP. Your progress is saved. Take the job again to earn another reward.</p><p>${c.ordersCompleted||0} jobs completed · ${nearby?'Patch is in range.':'Visit Patch in Afterlight Commons to accept or turn in.'}</p><div class="card-grid">${data.economy.orders.map(o=>{
    const active=c.workOrder?.id===o.id,progress=active?c.workOrder.progress:0;
    const spawns=data.world.enemySpawns.filter(s=>s.type===o.target&&tierFor(data,s.level).id===o.tier).sort((a,b)=>distance(a.position,c.position)-distance(b.position,c.position));
    const source=spawns[0],enemy=data.enemies.find(e=>e.id===o.target);
    return `<article class="info-card"><span class="tag">${active?'ACTIVE · ':''}T${o.tier} · LEVEL ${o.level}+</span><h3>${esc(o.name)}</h3><p>${esc(o.description)}</p><p>${progress} / ${o.count} ${esc(enemy.name)} patrols</p><p>Nearest source: ${source?`Lv ${source.level} at [${source.position.join(', ')}]`:'Check the basin map.'}</p><p>Reward: ${o.xp} XP + ${formatGold(o.gold)} gold</p>${active?`<button class="small-button" data-do="work-order" data-id="${o.id}" data-operation="claim" ${nearby&&progress>=o.count?'':'disabled'}>COLLECT REWARD</button><button class="small-button" data-do="work-order" data-id="${o.id}" data-operation="abandon" ${nearby?'':'disabled'}>ABANDON / LOSE PROGRESS</button>`:`<button class="small-button" data-do="work-order" data-id="${o.id}" data-operation="accept" ${nearby&&!c.workOrder&&c.level>=o.level?'':'disabled'}>ACCEPT JOB</button>`}</article>`;
  }).join('')}</div>`;
}
export function classPanel(c, data) {
  return `<h3>Bonuses for each talent group</h3><p>Spend three points in a talent group to activate its bonus. You can earn bonuses from all six groups. These add to your character type, equipment, food, and tool coating bonuses.</p><div class="card-grid">${classBonuses(c,data).map(b => `<article class="info-card"><span class="tag">${esc(b.branch)} · ${b.invested}/${b.points} POINTS · ${b.invested >= b.points ? 'ACTIVE' : 'LOCKED'}</span><h3>${esc(b.name)}</h3><p>${esc(b.description)}</p></article>`).join('')}</div>`;
}
export function catalogPage(items,query={}) {
  const search=(query.search||'').trim().toLowerCase();
  const filtered=items.filter(i=>(!query.tier||i.tier===Number(query.tier))&&(!query.slot||i.slot===query.slot)&&(!query.rarity||i.rarity===query.rarity)&&(!search||`${i.name} ${i.slot||i.kind}`.toLowerCase().includes(search)));
  const pages=Math.max(1,Math.ceil(filtered.length/24)),page=Math.min(pages-1,Math.max(0,Math.trunc(Number(query.page)||0)));
  return {items:filtered.slice(page*24,page*24+24),total:filtered.length,page,pages};
}
function catalogFilters(data,query,view) {
  return `<form data-economy-form="${view}" class="community-form community-grid"><label class="community-field">ITEM NAME<input name="search" maxlength="128" value="${esc(query.search||'')}" placeholder="Search equipment or supplies"></label>${selectField('TIER','tier',[['','All tiers'],...data.economy.tiers.map(t=>[t.id,t.name])],query.tier)}${selectField('SLOT','slot',[['','All slots'],...equipmentSlots.map(s=>[s,s])],query.slot)}${selectField('RARITY','rarity',[['','All rarities'],...data.economy.rarities.map(r=>[r.id,r.name])],query.rarity)}<button class="small-button">FILTER ITEMS</button></form>`;
}
function catalogPager(page,view) {
  return `<div class="settings-actions"><span role="status">${page.total.toLocaleString('en-US')} items · Page ${page.page+1} / ${page.pages}</span><button class="small-button" data-do="catalog-page" data-view="${view}" data-id="${page.page-1}" ${page.page===0?'disabled':''}>PREVIOUS</button><button class="small-button" data-do="catalog-page" data-view="${view}" data-id="${page.page+1}" ${page.page+1===page.pages?'disabled':''}>NEXT</button></div>`;
}
export function inventoryPanel(c,data,query={}) {
  const nearby=nearPatch(data,c);
  const equipped=equipmentSlots.map(slot=>{
    const item=itemById(data,c.equipment?.[slot]);
    return `<article class="info-card"><span class="tag">${slot.toUpperCase()}</span><p>${item?itemLabel(data,item):'Empty slot'}</p>${item?`<p>${esc(statText(item.stats))}</p><button class="small-button" data-do="unequip" data-id="${slot}" ${itemRoom(c,data,item)<=0||c.health<=0?'disabled':''}>TAKE OFF</button>`:''}</article>`;
  }).join('');
  const pack=Object.keys(c.items||{}).map(id=>itemById(data,id)).filter(i=>i&&itemCount(c,i.id)>0).sort((a,b)=>b.tier-a.tier||a.name.localeCompare(b.name));
  const page=catalogPage(pack,query);
  const buffs=Object.entries(c.buffs||{}).filter(([id,n])=>n>0&&itemById(data,id)).map(([id,n])=>{
    const i=itemById(data,id);
    return `<article class="info-card">${itemLabel(data,i)}<p>${esc(statText(i.stats))}</p><p>${i.group==='provision'?'Food':'Tool coating'} · <span data-buff-timer="${i.id}">${Math.ceil(n)}</span> seconds remaining · pauses while dead or offline.</p></article>`;
  }).join('');
  return `${moralGearPanel(c,data,statText)}${data.forge?`<article class="info-card"><span class="tag">FRAME ATTUNEMENT</span><h3>Your collection has a purpose</h3><p>${esc(statText(forgeBonuses(c,data.forge))||'No frame parts attuned yet. Earn milestone parts or signature finds, then choose ATTUNE PARTS in the Frame Forge.')}</p><p>Attune six owned parts for individual and set bonuses. Apply any earned appearance separately. Bonuses above include your active sets and follow the normal stat caps.</p><button class="small-button" data-do="forge">BUILD / HUNT / SHOWCASE</button></article>`:''}<h3>Equipment</h3><p>You can wear eight pieces of equipment. Equipped items leave your inventory. Take them off before selling or trading them. Each item below shows how it changes your bonuses.</p><div class="card-grid">${equipped}</div><h3>Your inventory</h3><p>${Object.keys(c.items||{}).length} / ${data.rules.inventory.packSlots} item types carried. You can hold up to 999 of each material and 99 of each equipment or supply item. Extra loot is sold automatically unless your gold is at its limit. Medkits have their own limit.</p>${catalogFilters(data,query,'inventory')}${catalogPager(page,'inventory')}<div class="card-grid">${page.items.map(i=>`<article class="info-card">${itemLabel(data,i)}<p>${esc(i.description)}</p><p>${esc(statText(i.stats))}</p><p>${itemCount(c,i.id)} / ${i.stack} · Sells for ${formatGold(i.value)} gold each</p>${i.kind==='equipment'?`<p class="muted">${esc(equipmentComparison(c,data,i))}</p><button class="small-button" data-do="equip" data-id="${i.id}" ${c.level<i.level||c.health<=0||c.equipment?.[i.slot]===i.id?'disabled':''}>EQUIP</button>`:''}${i.duration?`<button class="small-button" data-do="consume" data-id="${i.id}" ${c.level<i.level||c.health<=0?'disabled':''}>USE / REPLACE ${i.group==='provision'?'FOOD':'COATING'}</button>`:''}<button class="small-button" data-do="sell" data-id="${i.id}" ${!nearby||c.health<=0?'disabled':''}>SELL ONE / ${formatGold(i.value)} GOLD</button>${i.id.startsWith('mod-')?`<button class="small-button" data-do="salvage" data-id="${i.id}" ${!nearby||c.health<=0||c.gold<i.tier*2?'disabled':''}>BREAK DOWN ONE / ${formatGold(i.tier*2)} GOLD</button>`:''}</article>`).join('')}</div>${page.total?'':'<p>No items match. Defeat patrol enemies for equipment, or make it at Patch’s shop.</p>'}<p>Visit Patch to sell items, break equipment into materials, or make new items. Trade with other players in the auction house.</p><h3>Temporary bonuses</h3>${buffs||'<p>No temporary bonuses active. Make food and tool coatings at Patch’s shop. You can use one food bonus and one coating bonus at a time.</p>'}${classPanel(c,data)}`;
}
export function craftingPanel(c,data,query={}) {
  const nearby=nearPatch(data,c),recipes=new Map(data.economy.recipes.map(r=>[r.item,r]));
  const page=catalogPage(data.economy.items.filter(i=>recipes.has(i.id)),query);
  return `${economyTabs('crafting')}<p>Use materials and gold to make items at Patch’s shop. Each recipe lists its costs and bonuses. Compare the bonuses to your current equipment before making it. You can break down unwanted modular equipment for materials or sell it for gold.</p><p>${nearby?'Patch is in range.':'Visit Patch in Afterlight Commons to craft.'} · Wallet ${formatGold(c.gold)} gold</p>${catalogFilters(data,query,'crafting')}${catalogPager(page,'crafting')}<div class="card-grid">${page.items.map(i=>{
    const r=recipes.get(i.id),enough=Object.entries(r.ingredients).every(([id,n])=>itemCount(c,id)>=n);
    const ready=nearby&&c.health>0&&c.level>=i.level&&enough&&c.gold>=r.gold&&itemRoom(c,data,i)>=r.quantity;
    return `<article class="info-card">${itemLabel(data,i)}<p>${esc(statText(i.stats))}</p>${i.slot?`<p class="muted">${esc(equipmentComparison(c,data,i))}</p>`:`<p>${esc(i.description)}</p>`}<p>Produces ${r.quantity} · Costs ${formatGold(r.gold)} gold</p><ul>${Object.entries(r.ingredients).map(([id,n])=>`<li>${esc(itemById(data,id).name)}: ${itemCount(c,id)} / ${n} ${itemCount(c,id)>=n?'✓':'needed'}</li>`).join('')}</ul><button class="small-button" data-do="craft" data-id="${i.id}" ${ready?'':'disabled'}>CRAFT ${r.quantity}</button></article>`;
  }).join('')}</div>${page.total?'':'<p>No recipes match these filters.</p>'}`;
}
export function selectField(label, name, choices, selected = '') {
  return `<label class="community-field">${esc(label)}<select name="${name}">${choices.map(([id,label]) => `<option value="${esc(id)}" ${String(selected) === String(id) ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>`;
}
export function bestiaryEntries(data, query = {}) {
  const search = (query.search || '').trim().toLowerCase();
  return data.enemies.map(enemy => {
    const enemyMatch = `${enemy.name} ${enemy.description} ${enemy.id}`.toLowerCase().includes(search);
    const drops = data.economy.drops.filter(d => d.enemy === enemy.id && (!query.tier || d.tier === Number(query.tier)) && (!query.rarity || itemById(data,d.item).rarity === query.rarity) && (!search || enemyMatch || itemById(data,d.item).name.toLowerCase().includes(search)));
    return {enemy,drops};
  }).filter(row => row.drops.length);
}
export function signatureHuntsPanel(c,data,query={}) {
  const progress=forgeProgress(c),search=(query.search||'').trim().toLowerCase();
  const items=(data.forge?.items||[]).filter(i=>i.hunt?.kind==='patrol'&&(!search||`${i.name} ${i.hunt.label} ${i.hunt.source}`.toLowerCase().includes(search))&&(!query.rarity||i.rarity===query.rarity)&&(!query.tier||data.world.enemySpawns.some(s=>s.type===i.hunt.source&&s.level>=i.hunt.level&&tierFor(data,s.level).id===Number(query.tier))));
  if(!items.length)return '';
  return `<h3>Signature collection hunts</h3><p>Permanent Frame Forge parts with unique appearances and attunement bonuses. Qualifying patrol kills advance these guarantees even when no part drops. These finds use no pack space.</p><div class="card-grid">${items.map(i=>`<article class="info-card"><span class="tag">${esc(i.rarity.toUpperCase())} · ${esc(i.set)}</span><h3>${esc(i.name)}</h3><p>${esc(i.hunt.label)}</p><p>${esc(huntStatus(i,progress))}</p><p>${esc(statText(i.stats))}</p><p class="muted">Patrol starting positions: ${data.world.enemySpawns.filter(s=>s.type===i.hunt.source&&s.level>=i.hunt.level&&(!query.tier||tierFor(data,s.level).id===Number(query.tier))).map(s=>`Lv ${s.level} at [${s.position.join(', ')}]`).join(' · ')}</p><button class="small-button" data-do="forge">PREVIEW / ATTUNE</button></article>`).join('')}</div>`;
}
export function bestiaryPanel(c, data, query = {}) {
  const entries = bestiaryEntries(data,query);
  return `${economyTabs('bestiary')}${signatureHuntsPanel(c,data,query)}<p>Patrol enemies can drop the items listed below. Each item has its own chance to appear, so one enemy can drop several items. Loot goes to the player credited with the kill. Enemies in street emergencies and dungeons do not drop these items or add to this kill count.</p><p>Tier is an item’s level group. Rarity describes its quality. Compare the actual bonuses before choosing equipment. You can see every possible drop before fighting an enemy.</p><div class="economy-tiers">${data.economy.tiers.map((t,n) => `<span class="tag">T${t.id} ${esc(t.name)} · Lv ${t.level}–${(data.economy.tiers[n+1]?.level ?? data.rules.levelCap+1)-1}</span>`).join('')}</div><p>${data.economy.rarities.map(r => `<span style="color:${r.color}">${esc(r.name)}</span>`).join(' → ')}</p><form data-economy-form="bestiary" class="community-form community-grid"><label class="community-field">ENEMY OR ITEM<input name="search" maxlength="128" value="${esc(query.search || '')}" placeholder="Search enemies or loot"></label>${selectField('TIER','tier',[['','All tiers'],...data.economy.tiers.map(t => [t.id,`T${t.id} ${t.name}`])],query.tier)}${selectField('RARITY','rarity',[['','All rarities'],...data.economy.rarities.map(r => [r.id,r.name])],query.rarity)}<button class="small-button">SEARCH DROPS</button></form>${entries.length ? entries.map(({enemy,drops}) => `<article class="info-card economy-mob"><h3>${esc(enemy.name)}</h3><p>${esc(enemy.description)}</p><p>${c.mobKills?.[enemy.id] || 0} confirmed kills · Base health ${enemy.health} · Base damage ${enemy.damage}</p>${data.economy.tiers.filter(t => drops.some(d => d.tier === t.id)).map(t => {
    const spawns = data.world.enemySpawns.filter(s => s.type === enemy.id && tierFor(data,s.level).id === t.id);
    return `<h4>T${t.id} · ${esc(t.name)}</h4><p class="muted">${spawns.length ? `Enemy starting positions: ${spawns.map(s => `Lv ${s.level} at [${s.position.join(', ')}]`).join(' · ')}` : 'No patrol enemies currently drop this tier. Make the equipment at Patch’s shop.'}</p><div class="economy-drops">${drops.filter(d => d.tier === t.id).map(d => `<div class="community-entry">${itemLabel(data,itemById(data,d.item))}<p>${Number((d.chance*100).toFixed(3))}% per kill · ${d.min === d.max ? d.min : `${d.min}–${d.max}`} item${d.max === 1 ? '' : 's'}</p></div>`).join('')}</div>`;
  }).join('')}</article>`).join('') : '<p role="status">No enemies or loot match these filters.</p>'}`;
}

export function modularDropsPanel(data,query={}) {
  const g=data.economy.generation;
  const search=data.enemies.some(e=>`${e.id} ${e.name}`.toLowerCase().includes((query.search||'').trim().toLowerCase()))?'':query.search;
  const page=catalogPage(data.economy.items.filter(i=>i.id.startsWith('mod-')),{...query,search});
  const total=g.rarityWeights.reduce((sum,n)=>sum+n,0);
  return `<h3>Modular equipment drops</h3><p>Each patrol enemy also has a ${g.dropChance*100}% chance to drop one piece of modular equipment in its level group. If equipment drops, its chance of each rarity is: ${data.economy.rarities.map((r,n)=>`${esc(r.name)} ${g.rarityWeights[n]/total*100}%`).join(' · ')}. Each rarity has 960 equally likely items per tier. The percentages below show your chance of getting that exact item from one enemy in its level group. You can also make every item at Patch’s shop.</p>${catalogPager(page,'bestiary')}<div class="card-grid">${page.items.map(i=>`<article class="info-card">${itemLabel(data,i)}<p>${esc(statText(i.stats))}</p><p>${Number((g.dropChance*g.rarityWeights[data.economy.rarities.findIndex(r=>r.id===i.rarity)]/total/960*100).toFixed(6))}% per matching-tier patrol kill · one item</p></article>`).join('')}</div>${page.total?'':'<p>No modular drops match these filters.</p>'}`;
}

export function validateEconomy(data) {
  const e = expandCatalog(data.economy), fail = () => { throw new Error('Invalid economy catalog.'); };
  if (!e || e.format !== 'sloperberpunk-economy' || e.version !== 1 || !e.tiers?.length || e.tiers[0].level !== 0 || !e.rarities?.length || !e.items?.length || e.items.length > 25000) fail();
  const unique = (rows,key) => new Set(rows.map(r => r[key])).size === rows.length;
  const statsOK = s => s && Object.entries(s).every(([k,v]) => k in statNames && Number.isFinite(v) && v > 0 && v <= 1000);
  const integer = (n,min,max) => Number.isInteger(n) && n >= min && n <= max;
  if (!unique(e.items,'id') || !unique(e.rarities,'id') || !unique(e.recipes,'item') || !unique(e.classes,'branch')) fail();
  for (const [n,t] of e.tiers.entries()) if (t.id !== n+1 || !t.name || !integer(t.level,0,data.rules.levelCap) || (n && t.level <= e.tiers[n-1].level)) fail();
  for (const r of e.rarities) if (!r.id || !r.name || !/^#[\da-f]{6}$/i.test(r.color)) fail();
  for (const i of e.items) {
    if (!/^[a-z0-9-]{1,64}$/.test(i.id) || !i.name || !e.tiers.some(t => t.id === i.tier) || !e.rarities.some(r => r.id === i.rarity) || !['equipment','material','consumable'].includes(i.kind) || !integer(i.stack,1,999) || !integer(i.value,1,1000000) || !integer(i.level,0,data.rules.levelCap) || !statsOK(i.stats || {})) fail();
    if (i.kind === 'equipment' && (!equipmentSlots.includes(i.slot) || !Object.keys(i.stats || {}).length || i.level < e.tiers[i.tier-1].level)) fail();
    if ((i.kind !== 'equipment' && i.slot) || (i.kind === 'material' && Object.keys(i.stats || {}).length)) fail();
    if (i.kind === 'consumable' && i.id !== 'medkit' && (!i.group || !Number.isFinite(i.duration) || i.duration < 1 || i.duration > 3600 || !Object.keys(i.stats || {}).length)) fail();
  }
  const medkit = itemById(data,'medkit');
  if (medkit?.kind !== 'consumable' || medkit.stack !== data.rules.inventory.slots) fail();
  const dropKeys = new Set();
  for (const d of e.drops) {
    const item = itemById(data,d.item), key = `${d.enemy}/${d.tier}/${d.item}`;
    if (dropKeys.has(key) || !data.enemies.some(m => m.id === d.enemy) || !item || item.tier !== d.tier || !Number.isFinite(d.chance) || d.chance <= 0 || d.chance > 1 || !integer(d.min,1,item.stack) || !integer(d.max,d.min,item.stack)) fail();
    dropKeys.add(key);
  }
  for (const r of e.recipes) {
    const item = itemById(data,r.item);
    if (!item || !integer(r.quantity,1,item.stack) || !integer(r.gold,0,1000000) || !Object.keys(r.ingredients || {}).length || Object.entries(r.ingredients).some(([id,n]) => itemById(data,id)?.kind !== 'material' || !integer(n,1,itemById(data,id).stack))) fail();
  }
  for (const b of e.classes) if (!b.name || !integer(b.points,1,data.talents.filter(t => t.branch === b.branch).reduce((sum,t) => sum+t.maxRank,0)) || !statsOK(b.stats) || !Object.keys(b.stats).length) fail();
  if(!unique(e.orders,'id'))fail();
  for(const o of e.orders)if(!o.name||!integer(o.count,1,100)||!e.tiers.some(t=>t.id===o.tier&&t.level===o.level)||!data.world.enemySpawns.some(s=>s.type===o.target&&tierFor(data,s.level).id===o.tier)||!integer(o.xp,1,100000)||!integer(o.gold,1,100000))fail();
}
