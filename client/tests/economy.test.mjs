// Buildless economy checks: content, stat parity, and rendered player flows in memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateEconomy, tierFor, itemById, itemCount, classBonuses, equipmentComparison, inventoryPanel, craftingPanel, bestiaryPanel, bestiaryEntries, catalogPage, modularDropsPanel, workOrdersPanel, equipmentSlots, itemRoom } from '../src/economy.js';
import { stats } from '../src/prediction.js';
import { Community } from '../src/social.js';
import { expandCatalog } from '../src/item-catalog.js';
import { formatGold, parseGold } from '../src/currency.js';

const data=Object.fromEntries(['economy','rules','enemies','talents','races','npcs','world'].map(n=>[n,JSON.parse(readFileSync(new URL(`../data/${n}.json`,import.meta.url)))]));
const character=()=>({id:'runner',race:'human',level:0,health:100,energy:100,gold:1000,medkits:3,position:[...data.npcs.find(n=>n.id==='merchant').position],talents:{},items:{},equipment:{},buffs:{},mobKills:{}});

test('gold uses exact thousandths from the first reward through the wallet cap',()=>{
  for(const [units,display] of [[0,'0'],[1,'0.001'],[5,'0.005'],[18,'0.018'],[45,'0.045'],[100,'0.1'],[999,'0.999'],[1000,'1'],[1001,'1.001'],[1234567,'1234.567'],[8999999999,'8999999.999'],[9000000000,'9000000']]) {
    assert.equal(formatGold(units),display);
    assert.equal(parseGold(display),units);
  }
  for(let units=0;units<=1100;units++)assert.equal(parseGold(formatGold(units)),units);
  assert.equal(parseGold('  .009  '),9);assert.equal(parseGold('1.'),1000);assert.equal(parseGold('0001.001'),1001);
  assert.equal(formatGold(30/4,6),'0.0075');
  assert.equal(formatGold(1/999,6),'0.000001','a cheap full stack must not appear free per item');
  for(const invalid of ['', ' ', '.', '-1', '+1', '1e3', '0x10', '1,000', '1.0001', '0.0009', '1.2.3', 'Infinity', 'NaN', '9007199254741', null, 0.018])assert.equal(parseGold(invalid),null,String(invalid));
});

test('early wallets, crafting, sales, salvage, and work orders show fractional gold',()=>{
  expandCatalog(data.economy);
  const c=character();c.gold=data.rules.startingGold;c.items={'street-coil':1,'mod-1-weapon-bastion-sanguine-renewal':1};
  assert.equal(formatGold(c.gold),'0.045');
  assert.equal(formatGold(data.rules.inventory.medkitPrice),'0.018');
  assert.match(craftingPanel(c,data),/Wallet 0\.045 gold/);
  assert.match(craftingPanel(c,data),/Costs 0\.012 gold/);
  const inventory=inventoryPanel(c,data);
  assert.match(inventory,/SELL ONE \/ 0\.012 GOLD/);
  assert.match(inventory,/BREAK DOWN ONE \/ 0\.002 GOLD/);
  const orders=workOrdersPanel(c,data);
  assert.match(orders,/\+ 0\.06 gold/);assert.match(orders,/\+ 0\.88 gold/);
});

test('24,000 stable modular variants have balanced rarity pools and loss-making salvage recipes',()=>{
  expandCatalog(data.economy);
  const modules=data.economy.items.filter(i=>i.id.startsWith('mod-'));
  assert.equal(modules.length,24000);assert.ok(data.economy.items.length>23*1000);
  for(const tier of data.economy.tiers)for(const rarity of data.economy.rarities)assert.equal(modules.filter(i=>i.tier===tier.id&&i.rarity===rarity.id).length,960);
  const recipes=new Map(data.economy.recipes.map(r=>[r.item,r]));
  for(const item of modules) {
    assert.ok(item.id.length<=64);
    const recovered=item.tier+data.economy.rarities.findIndex(r=>r.id===item.rarity)+1;
    assert.ok(recovered<recipes.get(item.id).ingredients[data.economy.generation.materials[item.tier-1]]);
  }
  const item=itemById(data,'mod-5-charm-prospector-gilded-fortune');
  assert.equal(item.name,'Afterlight Gilded Prospector relay of Fortune');
  assert.equal(item.rarity,'epic');assert.equal(item.value,136);
  assert.deepEqual(item.stats,{regen:1.0875,goldFind:0.1088,leech:0.0145});
  const size=data.economy.items.length;expandCatalog(data.economy);assert.equal(data.economy.items.length,size);
});

test('large catalogs render bounded pages and preserve search and tier constraints',()=>{
  const query={tier:'5',slot:'charm',rarity:'epic',search:'Gilded'},page=catalogPage(data.economy.items,query);
  assert.ok(page.total>0);assert.ok(page.items.length<=24);
  for(const i of page.items){assert.equal(i.tier,5);assert.equal(i.slot,'charm');assert.equal(i.rarity,'epic');assert.match(i.name,/Gilded/);}
  const html=craftingPanel(character(),data,{tier:'1'});
  assert.equal((html.match(/data-do="craft"/g)||[]).length,24);
  assert.ok(html.length<80000);
  assert.equal(catalogPage(data.economy.items,{page:Infinity}).page,catalogPage(data.economy.items).pages-1);
  assert.match(modularDropsPanel(data,{tier:'1',rarity:'legendary'}),/0.000167% per matching-tier patrol kill/);
});

test('new pack stacks are bounded while existing material stacks can still grow',()=>{
  const c=character();for(const i of data.economy.items.filter(i=>i.id!=='medkit').slice(0,160))c.items[i.id]=1;
  assert.equal(itemRoom(c,data,itemById(data,'wire-scrap')),998);
  const absent=data.economy.items.find(i=>i.id!=='medkit'&&!c.items[i.id]);assert.equal(itemRoom(c,data,absent),0);
  assert.equal(itemRoom(c,data,itemById(data,'medkit')),21);
});

test('repeatable work orders have reachable patrol sources and require a live visit to collect',()=>{
  const c=character();c.workOrder={id:'order-1-drone',progress:6};
  assert.equal(data.economy.orders.length,15);
  assert.match(workOrdersPanel(c,data),/data-operation="claim" >COLLECT REWARD/);
  c.position=[999,0,999];assert.match(workOrdersPanel(c,data),/data-operation="claim" disabled/);
  c.position=[...data.npcs.find(n=>n.id==='merchant').position];c.workOrder.progress=5;
  assert.match(workOrdersPanel(c,data),/data-operation="claim" disabled/);
});

test('catalog separates five progression tiers and five rarity grades with all equipment craftable',()=>{
  validateEconomy(data);
  assert.equal(data.economy.tiers.length,5);assert.equal(data.economy.rarities.length,5);
  for(const [level,tier] of [[0,1],[9,1],[10,2],[19,2],[20,3],[34,3],[35,4],[49,4],[50,5],[60,5]])assert.equal(tierFor(data,level).id,tier);
  for(const tier of data.economy.tiers) {
    const equipment=data.economy.items.filter(i=>i.tier===tier.id&&i.kind==='equipment');
    assert.deepEqual([...new Set(equipment.map(i=>i.slot))].sort(),[...equipmentSlots].sort());
    const recipes=new Set(data.economy.recipes.map(r=>r.item));for(const item of equipment)assert.ok(recipes.has(item.id));
  }
  assert.ok(new Set(data.economy.items.filter(i=>i.tier===1).map(i=>i.rarity)).size>1);
});

test('every world patrol has guaranteed salvage, bounded drop quantities, and a route to every recipe',()=>{
  const obtainable=new Set(['medkit']);
  for(const spawn of data.world.enemySpawns) {
    const drops=data.economy.drops.filter(d=>d.enemy===spawn.type&&d.tier===tierFor(data,spawn.level).id);
    assert.ok(drops.some(d=>d.chance===1&&itemById(data,d.item).kind==='material'));
    for(const d of drops)obtainable.add(d.item);
  }
  for(const recipe of data.economy.recipes) {
    for(const id of Object.keys(recipe.ingredients))assert.ok(obtainable.has(id),id);
    obtainable.add(recipe.item);
    const vendorCost=recipe.gold+Object.entries(recipe.ingredients).reduce((sum,[id,n])=>sum+n*itemById(data,id).value,0);
    assert.ok(recipe.quantity*itemById(data,recipe.item).value<vendorCost,'crafting must not mint vendor gold');
  }
  for(const item of data.economy.items)assert.ok(obtainable.has(item.id),item.id);
});

test('catalog validation rejects bad references, nonfinite stats, unsafe colors, and malformed drop tables',()=>{
  const corruptions=[
    e=>e.items.push({...e.items[0]}),e=>e.items[7].stats={damage:Infinity},e=>e.items[7].slot='unknown',
    e=>e.drops[0].item='missing',e=>e.drops[0].chance=1.01,e=>e.drops[0].max=0,e=>e.drops.push({...e.drops[0]}),
    e=>e.rarities[0].color='red;display:none',e=>e.tiers[1].level=0,e=>e.recipes[0].ingredients={missing:1},
    e=>e.classes[0].points=1000,e=>e.items[0].stack=100,e=>e.items.find(i=>i.id==='spark-tonic').duration=NaN,
  ];
  for(const corrupt of corruptions){const copy=structuredClone(data);corrupt(copy.economy);assert.throws(()=>validateEconomy(copy),/Invalid economy/);}
});

test('lineage bonuses stay distinct and class specializations activate at three invested points',()=>{
  const c=character();
  const expected={human:{health:140},lattice:{energy:120},revenant:{crit:15},bloom:{speed:1.08}};
  for(const [race,bonuses]of Object.entries(expected)){c.race=race;for(const [key,value]of Object.entries(bonuses))assert.equal(stats(c,data)[key],value);}
  c.race='human';c.level=30;c.talents={plating:2};
  assert.equal(classBonuses(c,data).find(b=>b.branch==='Anchor').invested,2);
  assert.equal(stats(c,data).health,600);
  c.talents={plating:3,capacitor:3};
  const s=stats(c,data);assert.equal(s.health,650);assert.equal(s.shield,10);assert.equal(s.energy,140);assert.equal(s.damage,1.04);
});

test('gear and provisions affect stats once, respect level and slots, and compose with sickness',()=>{
  const c=character();c.level=50;
  c.equipment={weapon:'afterlight-coil',armor:'afterlight-vest',implant:'tomorrow-lens'};
  c.buffs={'spark-tonic':300};
  const s=stats(c,data);assert.equal(s.health,920);assert.equal(s.energy,130);assert.equal(s.crit,17);assert.equal(s.shield,20);assert.ok(Math.abs(s.damage-1.16)<1e-10);
  c.items={'afterlight-coil':9};assert.deepEqual(stats(c,data),s,'unequipped copies never add power');
  c.resurrectionSickness=10;assert.equal(stats(c,data).damage,s.damage*.5);
  c.buffs={'spark-tonic':0};assert.equal(stats(c,data).energy,120);
  c.equipment={armor:'afterlight-coil'};assert.equal(stats(c,data).damage,.5,'wrong slot cannot grant weapon stats');
  c.level=0;c.equipment={weapon:'afterlight-coil'};assert.equal(stats(c,data).damage,.5);
});

test('legacy characters need no item migration and medkits retain their separate counter',()=>{
  const c=character();delete c.items;delete c.equipment;delete c.buffs;delete c.mobKills;
  assert.equal(itemCount(c,'medkit'),3);assert.equal(itemCount(c,'street-coil'),0);assert.equal(stats(c,data).health,140);
  assert.match(inventoryPanel(c,data),/Empty slot/);assert.match(inventoryPanel(c,data),/No temporary bonuses active/);
});

test('equipment comparisons include both benefits and lost stats without leaking HTML',()=>{
  const c=character();c.equipment={implant:'tomorrow-lens'};
  const comparison=equipmentComparison(c,data,itemById(data,'surveyor-lens'));
  assert.match(comparison,/-4 percentage points critical-hit chance/);assert.match(comparison,/-20 maximum energy/);
  const copy=structuredClone(data);copy.economy.items.find(i=>i.id==='street-coil').name='<img onerror=alert(1)>';
  c.items={'street-coil':1};const html=inventoryPanel(c,copy);
  assert.ok(html.includes('&lt;img onerror=alert(1)&gt;'));assert.equal(html.includes('<img onerror'),false);
});

test('crafting requires proximity, level, space, gold, and actual ingredients',()=>{
  const c=character();c.items={'wire-scrap':8};
  const enabled=html=>html.includes('data-do="craft" data-id="street-coil" >CRAFT');
  assert.ok(enabled(craftingPanel(c,data)));
  c.position=[999,0,999];assert.equal(enabled(craftingPanel(c,data)),false);
  c.position=[...data.npcs.find(n=>n.id==='merchant').position];c.items['wire-scrap']=7;assert.equal(enabled(craftingPanel(c,data)),false);
  c.items['wire-scrap']=8;c.items['street-coil']=99;assert.equal(enabled(craftingPanel(c,data)),false);
  c.items['street-coil']=0;c.gold=11;assert.equal(enabled(craftingPanel(c,data)),false);
});

test('drop encyclopedia searches mobs and item names, combines filters, and exposes exact chances and sources',()=>{
  const c=character();c.mobKills={drone:7};
  const matches=bestiaryEntries(data,{search:'surveyor',tier:'1',rarity:'rare'});
  assert.equal(matches.length,1);assert.equal(matches[0].drops[0].item,'surveyor-lens');
  assert.equal(bestiaryEntries(data,{search:'not present'}).length,0);
  const html=bestiaryPanel(c,data,{tier:'1'});assert.match(html,/7 confirmed kills/);assert.match(html,/4% per kill/);assert.match(html,/Enemy starting positions: Lv 0/);
  assert.match(bestiaryPanel(c,data,{tier:'5',rarity:'legendary'}),/0.5% per kill/);
  assert.match(bestiaryPanel(c,data,{search:'absent'}),/No enemies or loot match/);
});

test('auction rows show stack and unit prices, rarity, tier, generic deliveries and legacy medkits',()=>{
  const community=Object.create(Community.prototype);
  Object.assign(community,{character,view:'auctions',data,now:()=>1000,query:{}});
  const a={id:1,item:'wire-scrap',quantity:4,buyout:30,minimum:10,bid:0,status:'open',seller:'other',expires:3600};
  let html=community.rows({items:[a]});assert.match(html,/0\.0075 gold \/ item/);assert.match(html,/Reclaimed wire/);assert.match(html,/Tier 1 · Common/);
  assert.match(html,/Starting bid 0\.01 gold/);assert.match(html,/Buy-now total 0\.03 gold/);
  assert.match(html,/inputmode="decimal" data-gold data-min="10" data-max="30" value="0\.01"/);
  a.bid=10;html=community.rows({items:[a]});assert.match(html,/Current bid 0\.01 gold/);assert.match(html,/data-min="11" data-max="30" value="0\.011"/);
  delete a.item;html=community.rows({items:[a]});assert.match(html,/Medkit/);
  community.view='deliveries';html=community.rows({items:[{id:1,reason:'Purchase',gold:29,medkits:0,items:{'tomorrow-lens':1}}]});assert.match(html,/Tomorrow&#39;s witness/);assert.match(html,/Legendary/);assert.match(html,/0\.029 gold/);
});
