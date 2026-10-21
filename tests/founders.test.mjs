// All fixtures, saves, and meshes stay in memory. GPL-3.0-or-later.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { hasFounderHalo, founderBoostActive, founderXpReward, founderOfferView, founderHaloParts } from '../client/src/founders.js';
import { Simulation, createCharacter, experienceFor, stats } from '../client/src/simulation.js';
import { World } from '../client/src/world.js';
import { Renderer } from '../client/src/renderer.js';
import { decodeLocal, encodeLocal } from '../client/src/persistence.js';
import { escapeHtml } from '../client/src/icons.js';
import { WorldClock } from '../client/src/clock.js';

const names=['rules','world','races','factions','quests','talents','abilities','enemies','npcs'];
const data=Object.fromEntries(await Promise.all(names.map(async name=>[name,JSON.parse(await readFile(new URL(`../client/data/${name}.json`,import.meta.url),'utf8'))])));
const world=new World(data.world);
const make=(level=1,halo=1)=>{
  const character=createCharacter('Halo runner','human','relay',data);
  Object.assign(character,{level,founderHalo:halo});
  return new Simulation(data,world,character,()=>{},()=>.5);
};

test('local creation and legacy saves do not mint signup rewards; valid serials survive saves',()=>{
  assert.equal(hasFounderHalo(createCharacter('Local runner','human','relay',data)),false);
  for(const founderHalo of [null,undefined,0,-1,1001,1.5,'1',true,NaN])assert.equal(hasFounderHalo({founderHalo}),false);
  const c=make().character;c.founderXpRemainder=17;
  const [restored]=decodeLocal(encodeLocal([c]));
  assert.equal(restored.founderHalo,1);assert.equal(restored.founderXpRemainder,17);
  assert.equal(hasFounderHalo(decodeLocal('[{"id":"legacy"}]')[0]),false);
  assert.equal(hasFounderHalo({founderHalo:1000}),true);
});

test('the halo adds exactly 5% XP while leveling 1–10, without changing combat stats',()=>{
  for(const level of [1,5,9]){
    const s=make(level),before=stats(s.character,data);
    assert.equal(s.gainXp(100),105);assert.equal(s.character.xp,105);
    assert.equal(founderBoostActive(s.character),true);
    assert.deepEqual(stats(s.character,data),before);
  }
  for(const level of [0,10,11,60]){
    const s=make(level);assert.equal(founderBoostActive(s.character),false);
    assert.equal(s.gainXp(20),20);assert.equal(s.character.xp,level===60?0:20);
    assert.equal(hasFounderHalo(s.character),true,'The cosmetic remains after the boost ends');
  }
  const ordinary=make(1,null);assert.equal(ordinary.gainXp(100),100);
});

test('tiny rewards preserve the fractional bonus through saves without rounding up',()=>{
  let s=make();
  for(let i=0;i<19;i++)assert.equal(s.gainXp(1),1);
  const [saved]=decodeLocal(encodeLocal([s.character]));
  s=new Simulation(data,world,saved);
  assert.equal(s.character.xp,19);assert.equal(s.gainXp(1),2);assert.equal(s.character.xp,21);
  assert.equal(s.character.founderXpRemainder,0);
  const before=structuredClone(s.character);founderXpReward(s.character,100,data.rules);
  assert.deepEqual(s.character,before,'Quest previews cannot consume the fractional bonus');
});

test('rewards crossing levels zero and ten boost only their eligible portion',()=>{
  const start=make(0);assert.equal(start.gainXp(experienceFor(0,data.rules)+100),185);
  assert.equal(start.character.level,1);assert.equal(start.character.xp,105);
  const end=make(9);end.character.xp=experienceFor(9,data.rules)-21;
  assert.equal(end.gainXp(120),121);assert.equal(end.character.level,10);assert.equal(end.character.xp,100);
  assert.equal(end.character.founderXpRemainder,0);assert.equal(end.gainXp(100),100);
  const last=make(9);last.character.xp=experienceFor(9,data.rules)-1;last.character.founderXpRemainder=19;
  assert.equal(last.gainXp(1),1);assert.equal(last.character.level,10);assert.equal(last.character.xp,0);
  assert.equal(last.character.founderXpRemainder,0,'Discard a bonus that would spill past level ten');
});

test('bulk rewards match an independent one-base-XP-at-a-time model across all early boundaries',()=>{
  function reference(c,amount){
    c={...c,founderXpRemainder:c.founderXpRemainder||0};let earned=0;
    for(let i=0;i<amount;i++){
      const active=hasFounderHalo(c)&&c.level>=1&&c.level<10;
      let bonus=0;
      if(active){c.founderXpRemainder++;if(c.founderXpRemainder===20){bonus=1;c.founderXpRemainder=0;}}
      else c.founderXpRemainder=0;
      if(c.level===9&&c.xp+1===experienceFor(9,data.rules))bonus=0;
      c.xp+=1+bonus;earned+=1+bonus;
      while(c.level<data.rules.levelCap&&c.xp>=experienceFor(c.level,data.rules)){c.xp-=experienceFor(c.level,data.rules);c.level++;}
      if(c.level>=10)c.founderXpRemainder=0;
      if(c.level===data.rules.levelCap)c.xp=0;
    }
    return {level:c.level,xp:c.xp,remainder:c.founderXpRemainder,earned};
  }
  for(const level of [0,1,2,8,9,10])for(const remaining of [1,2,20,21,70])for(const remainder of [0,1,18,19])for(const amount of [0,1,3,20,100,500,10000]){
    const s=make(level),c=s.character;c.xp=experienceFor(level,data.rules)-remaining;c.founderXpRemainder=level===0||level>=10?0:remainder;
    const expected=reference(c,amount),earned=s.gainXp(amount);
    assert.deepEqual({level:c.level,xp:c.xp,remainder:c.founderXpRemainder,earned},expected,JSON.stringify({level,remaining,remainder,amount}));
  }
});

test('combat and quest events report actual XP, with no duplicate quest bonus',()=>{
  const s=make(1),events=[];s.emit=event=>events.push(event);const enemy=s.enemies[0];
  s.character.position=[enemy.position[0],0,enemy.position[2]-10];enemy.health=1;
  const base=Math.max(3,data.rules.xp.killBase+enemy.level*data.rules.xp.killPerLevel-Math.max(0,s.character.level-enemy.level)*4);
  const expected=founderXpReward(s.character,base,data.rules).xp;
  assert.equal(s.action({type:'ability',id:'arc',target:enemy.id}),true);
  assert.equal(events.find(e=>e.type==='reward').xp,expected);assert.equal(s.character.xp,expected);
  const quest=data.quests.find(q=>q.id==='relay-00');s.character.position=[-11,0,10];
  assert.equal(s.action({type:'quest',id:quest.id,operation:'accept'}),true);
  s.character.activeQuests[quest.id]=quest.objective.count;
  const questXp=founderXpReward(s.character,quest.reward.xp,data.rules).xp;
  assert.equal(s.action({type:'quest',id:quest.id,operation:'complete'}),true);
  assert.equal(events.find(e=>e.type==='questComplete').xp,questXp);
  const saved=structuredClone(s.character);
  assert.equal(s.action({type:'quest',id:quest.id,operation:'complete'}),false);assert.deepEqual(s.character,saved);
});

test('landing availability is truthful when available, exhausted, owned, or disconnected',()=>{
  assert.match(founderOfferView({limit:1000,remaining:1},null).status,/1 \/ 1,000/);
  assert.match(founderOfferView({limit:1000,remaining:1000},null).action,/SIGN UP/);
  assert.match(founderOfferView({limit:1000,remaining:0},null).status,/LIMIT REACHED/);
  assert.doesNotMatch(founderOfferView({limit:1000,remaining:0},null).action,/HALO/);
  for(const offer of [null,{}, {limit:1000,remaining:1001},{limit:1000,remaining:-1},{limit:1000,remaining:'1000'}])assert.match(founderOfferView(offer,null).status,/unconfirmed/);
  assert.match(founderOfferView(null,{founderHalo:1000}).status,/YOURS · EDITION 1000/);
  assert.match(founderOfferView(null,{username:'legacy'}).action,/VIEW YOUR CHARACTERS/);
});

test('the actual landing CTA opens registration, updates availability, and routes owners to characters',async()=>{
  const nodes=new Map(),requests=[];
  const node=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{textContent:'',innerHTML:'',open:false,addEventListener(){},showModal(){this.open=true;}});
    return nodes.get(selector);
  };
  let remaining=1;
  const context=vm.createContext({
    document:{querySelector:node,querySelectorAll:()=>[],addEventListener(){}},window:{addEventListener(){}},
    matchMedia:()=>({matches:false}),WorldClock,hasFounderHalo,founderBoostActive,founderXpReward,founderOfferView,esc:escapeHtml,
    api:async path=>{requests.push(path);return path==='/characters'?{characters:[]}:{limit:1000,remaining};}
  });
  const source=await readFile(new URL('../client/src/app.js',import.meta.url),'utf8');
  // Execute the actual UI handlers without WebGL, storage, timers, or browser startup.
  vm.runInContext(source.replace(/^import .*;\n/gm,'').replace(/\nboot\(\)\.catch[\s\S]*$/,'\n'),context);
  vm.runInContext('wireEvents()',context);
  await node('#founder-cta').onclick();
  assert.equal(node('#dialog-title').textContent,'Start a new signal.');
  assert.match(node('#dialog-content').innerHTML,/id="account-form" data-mode="register"/);
  assert.match(node('#founder-status').textContent,/1 \/ 1,000/);
  assert.deepEqual(requests,['/founder-offer']);
  remaining=0;await vm.runInContext('refreshFounderOffer()',context);
  assert.match(node('#founder-status').textContent,/LIMIT REACHED/);
  assert.equal(node('#founder-cta').textContent,'CREATE AN ACCOUNT ↗');
  vm.runInContext('account={username:"first_runner",founderHalo:1};updateFounderOffer()',context);
  await node('#founder-cta').onclick();
  assert.equal(node('#dialog-title').textContent,'Choose your signal.');
  assert.match(node('#dialog-content').innerHTML,/First Signal Halo unlocked/);
  assert.match(node('#founder-status').textContent,/YOURS/);
  assert.equal(requests.at(-1),'/characters');
});

test('the luminous halo renders above the head, retains guild tabards, and stays bounded',async()=>{
  const models=JSON.parse(await readFile(new URL('../client/assets/models.json',import.meta.url),'utf8'));
  const actor={position:[0,0,0],model:'humanoid',yaw:1.4,color:'#ffffff',guild:{tabard:{pattern:'split',emblem:'star'}}},base=[];
  Renderer.prototype.actor.call({models},base,actor,0);
  for(const time of [0,1,100000]){
    const vertices=[];Renderer.prototype.actor.call({models},vertices,{...actor,founderHalo:1000},time);
    assert.ok(vertices.every(Number.isFinite));assert.deepEqual(vertices.slice(0,models.humanoid.length*360),base.slice(0,models.humanoid.length*360));
    assert.equal(vertices.length-base.length,founderHaloParts(time).length*360);
    assert.ok(vertices.length/10<2000);
    for(const part of founderHaloParts(time)){assert.ok(part.center[1]-part.size[1]/2>2.18);assert.ok(Math.hypot(part.center[0],part.center[2])<.8);}
  }
  const invalid=[];Renderer.prototype.actor.call({models},invalid,{...actor,founderHalo:1001},0);assert.deepEqual(invalid,base);
  const ghost=[],plainGhost=[];Renderer.prototype.actor.call({models},ghost,{...actor,ghost:true,founderHalo:1},0);Renderer.prototype.actor.call({models},plainGhost,{...actor,ghost:true},0);assert.deepEqual(ghost,plainGhost);
});
