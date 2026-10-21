// Behavioral expedition regressions. Fixtures, state, geometry, and saves stay in memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { World } from '../client/src/world.js';
import { Simulation, createCharacter } from '../client/src/simulation.js';
import { validateDungeons, dungeonPosition, dungeonZones, dungeonInDanger, dungeonEnemies, dungeonPanel } from '../client/src/dungeons.js';
import { Renderer } from '../client/src/renderer.js';
import { decodeLocal, encodeLocal } from '../client/src/persistence.js';

const names=['world','rules','races','factions','quests','talents','abilities','enemies','npcs','dungeons'];
const data=Object.fromEntries(await Promise.all(names.map(async name=>[name,JSON.parse(await readFile(new URL(`../client/data/${name}.json`,import.meta.url),'utf8'))])));
const world=new World(data.world),r=data.dungeons.rules;
function make(race='human',faction='relay'){
  const events=[],sim=new Simulation(data,world,createCharacter('Witness',race,faction,data),e=>events.push(e),()=>.5);
  return {sim,events};
}
function action(sim,operation,extra={}){
  const v=sim.dungeon?.run;
  return sim.action({type:'dungeon',operation,run:v?.id,chapter:v?.chapter,attempt:v?.attempt,...extra});
}
function enter(sim){
  assert.ok(action(sim,'queue',{dungeon:'ninth-bell'}));
  assert.ok(action(sim,'ready'));assert.equal(sim.dungeon.run.phase,'briefing');
}
function clearChapter(sim){
  assert.ok(action(sim,'begin'));
  const run=sim.dungeon.run,chapter=data.dungeons.entries[0].chapters[run.chapter];
  for(const e of chapter.evidence){sim.character.position=dungeonPosition(r,e.position);assert.ok(action(sim,'interact',{target:e.id}));}
  sim.character.position=dungeonPosition(r,[0,0,8]);
  // Real combat authority, resource and cooldown checks; no submitted progress or reward.
  for(let i=0;sim.enemies.some(e=>e.health>0)&&i<500;i++){
    const e=sim.enemies.find(e=>e.health>0);
    sim.action({type:'ability',id:'arc',target:e.id});
    for(let k=0;k<20;k++)sim.tick(.05);
  }
  assert.notEqual(sim.dungeon.run.phase,'active','Basic shared kit must be sufficient');
}

test('all six authored dungeons validate, use exact sizes, and annotate their creative production logic',()=>{
  assert.equal(validateDungeons(data.dungeons,data),data.dungeons);
  assert.deepEqual(data.dungeons.entries.map(d=>d.players),[1,2,3,4,6,8]);
  const titles=new Set(),prose=new Set();
  for(const d of data.dungeons.entries){
    assert.equal(d.chapters.length,3);assert.equal(d.decision.choices.length,2);
    for(const key of ['intent','twistFairness','mechanicMeaning','composition','artDirection','audioDirection','acceptance'])assert.ok(d.production[key].length>50,`${d.id}: ${key}`);
    assert.ok(d.production.inspirations.length>=3);
    for(const c of d.chapters){assert.ok(!titles.has(c.name));titles.add(c.name);for(const text of [c.briefing,c.reveal,...c.evidence.map(e=>e.text)]){assert.ok(text.length>90);assert.ok(!prose.has(text));prose.add(text);}for(const e of c.evidence)assert.equal(world.collides(...dungeonPosition(r,e.position)),false);}
  }
});
test('malformed content fails before loading a dungeon',()=>{
  for(const mutate of [c=>c.version++,c=>c.entries[0].players=0,c=>c.entries[0].players=9,c=>c.entries[0].id=c.entries[1].id,c=>c.entries[0].chapters[0].enemy='missing',c=>c.rules.warningSeconds=.1,c=>c.rules.arena[0]=data.world.bounds,c=>c.entries[0].chapters[0].evidence[0].position=[0,Infinity,0],c=>c.entries[0].decision.choices[0].id='defer',c=>c.entries[0].reward.xp=-1,c=>c.entries[0].chapters[0].healthMultiplier=Infinity]){
    const copy=structuredClone(data.dungeons);mutate(copy);assert.throws(()=>validateDungeons(copy,data),/Invalid dungeon/);
  }
});
test('every lineage and faction can clear the solo dungeon using the same basic attack',()=>{
  for(const race of data.races)for(const faction of data.factions){
    const {sim}=make(race.id,faction.id);const start=sim.character.credits;
    enter(sim);
    for(let i=0;i<3;i++){clearChapter(sim);assert.equal(sim.character.xp,0,'Dungeon machines cannot farm kill XP');assert.equal(sim.character.credits,start);}
    assert.equal(sim.dungeon.run.phase,'decision');
    assert.ok(action(sim,'vote',{choice:'repair'}));
    assert.equal(sim.dungeon.run.phase,'complete');assert.equal(sim.character.credits,start+65);assert.deepEqual(sim.character.dungeonHistory['ninth-bell'],{clears:1,ending:'repair'});
    const restored=new Simulation(data,world,decodeLocal(encodeLocal([sim.character]))[0]);
    assert.deepEqual(restored.character.dungeonHistory,sim.character.dungeonHistory);assert.equal(restored.inDungeon,false);assert.equal(action(restored,'vote',{choice:'name',run:sim.dungeon.run.id}),false);
    const rewarded=JSON.stringify(sim.character);assert.equal(action(sim,'vote',{choice:'name'}),false);assert.equal(JSON.stringify(sim.character),rewarded);
    assert.ok(action(sim,'leave'));assert.equal(sim.inDungeon,false);assert.deepEqual(sim.character.position,data.world.spawn);assert.equal(sim.character.dungeonReturn,undefined);
  }
});
test('admission enforces level, exact solo size, combat, health, duplicate requests, and ready deadlines',()=>{
  const {sim}=make();assert.equal(action(sim,'queue',{dungeon:'borrowed-ferry'}),false);assert.equal(action(sim,'queue',{dungeon:'forged'}),false);
  sim.lastCombat=sim.time;assert.equal(action(sim,'queue',{dungeon:'ninth-bell'}),false);sim.lastCombat=-100;
  sim.character.health=0;assert.equal(action(sim,'queue',{dungeon:'ninth-bell'}),false);sim.character.health=140;
  assert.ok(action(sim,'queue',{dungeon:'ninth-bell'}));assert.equal(action(sim,'queue',{dungeon:'ninth-bell'}),false);
  const run=sim.dungeon.run;sim.time=run.deadline;assert.equal(action(sim,'ready'),false);sim.tick(.05);assert.equal(sim.dungeon,null);
});
test('evidence and recovery require proximity; chapter and attempt tokens reject replays',()=>{
  const {sim}=make();enter(sim);assert.ok(action(sim,'begin'));
  const old=sim.dungeon.run;assert.equal(action(sim,'interact',{target:'chair'}),false);
  sim.character.position=dungeonPosition(r,[-16,0,-12]);assert.ok(action(sim,'interact',{target:'chair'}));assert.ok(action(sim,'interact',{target:'chair'}));assert.equal(sim.dungeon.run.evidence.length,1);assert.equal(sim.dungeon.run.signed.length,1);
  assert.equal(action(sim,'interact',{target:'roster',chapter:999}),false);
  sim.character.health=20;assert.equal(action(sim,'recover'),false);sim.character.position=[...r.recoveryPosition];const kits=sim.character.medkits;
  assert.ok(action(sim,'recover'));assert.equal(sim.character.health,83);assert.equal(sim.character.medkits,kits);assert.equal(action(sim,'recover'),false);
  sim.character.health=0;sim.tick(.05);assert.equal(sim.dungeon.run.phase,'wipe');assert.equal(sim.action({type:'respawn'}),false);
  sim.time=sim.dungeon.run.deadline;sim.tick(.05);assert.equal(sim.dungeon.run.phase,'briefing');assert.ok(action(sim,'begin'));
  assert.equal(sim.dungeon.run.attempt,old.attempt+1);assert.equal(action(sim,'interact',{target:'chair',attempt:old.attempt}),false);
  assert.equal(sim.character.xp,0);
});
test('wipes retain completed chapters and prediction cannot resolve encounters or pay rewards',()=>{
  const {sim}=make();enter(sim);clearChapter(sim);assert.equal(sim.dungeon.run.chapter,1);assert.ok(action(sim,'begin'));
  const snapshot=JSON.stringify(sim.dungeon);const health=sim.enemies.map(e=>e.health);
  for(let i=0;i<1000;i++)sim.tick(.05,{},true);
  assert.deepEqual(sim.enemies.map(e=>e.health),health);assert.equal(JSON.stringify(sim.dungeon),snapshot);assert.equal(sim.character.xp,0);
  sim.character.health=0;sim.tick(.05);sim.time=sim.dungeon.run.deadline;sim.tick(.05);assert.equal(sim.dungeon.run.chapter,1);assert.equal(sim.dungeon.run.phase,'briefing');
  assert.ok(action(sim,'leave'));assert.equal(sim.character.dungeonHistory,undefined);
});
test('all endings award the same reward and timeout resolves to the authored provisional ending',()=>{
  const credits=[];
  for(const choice of ['name','repair','timeout']){
    const {sim}=make();enter(sim);for(let i=0;i<3;i++)clearChapter(sim);
    if(choice==='timeout'){sim.time=sim.dungeon.run.deadline;sim.tick(.05);}else assert.ok(action(sim,'vote',{choice}));
    credits.push(sim.character.credits);assert.equal(sim.character.dungeonHistory['ninth-bell'].ending,choice==='timeout'?'defer':choice);
    assert.equal(sim.character.health,sim.playerStats.health,'Timed completion must retain level-up health');
  }
  assert.equal(new Set(credits).size,1);
});
test('arena movement is bounded and each hazard has a safe route at ordinary walking speed',()=>{
  const {sim}=make();enter(sim);sim.character.position=dungeonPosition(r,[25,0,0]);
  for(let i=0;i<120;i++)sim.tick(.05,{strafe:1,yaw:0});assert.ok(sim.character.position[0]<=r.arena[0]+r.arenaRadius);
  for(const d of data.dungeons.entries)for(const ch of d.chapters)for(const pulse of [0,1]){
    const safe=ch.pattern==='lanes'?[pulse%2?1:-1,0,0]:ch.pattern==='cross'?[5,0,5]:[0,0,0];
    assert.equal(dungeonInDanger(r,ch,pulse,dungeonPosition(r,safe)),false);
    for(const [x,z,w,h]of dungeonZones(r,ch,pulse)){assert.equal(dungeonInDanger(r,ch,pulse,dungeonPosition(r,[x,0,z])),true);assert.ok(w>0&&h>0);}
    const far=ch.pattern==='lanes'?27:ch.pattern==='ring'?Math.hypot(26-7.9,26-7.9):Math.hypot(4.1,4.1);
    assert.ok(far<data.rules.movement.speed*(r.warningSeconds-.2),'Warning includes time to walk clear without dashing');
  }
});
test('all encounters have bounded class-independent health budgets and distinct renderable venues',()=>{
  const meshes=[];
  for(const d of data.dungeons.entries){
    for(let chapter=0;chapter<d.chapters.length;chapter++){
      const enemies=dungeonEnemies(data,d,chapter,7,2);assert.equal(enemies.length,Math.ceil(d.players/2));assert.ok(enemies.every(e=>e.instance===7&&e.level===d.level&&e.health>0));assert.equal(new Set(enemies.map(e=>e.id)).size,enemies.length);
      const run={dungeon:d.id,chapter,evidence:[],phase:'active',pulse:0,nextPulse:3};const v=[];
      Renderer.prototype.dungeon.call({},v,data.dungeons,run,1);assert.equal(v.length%30,0);assert.ok(v.every(Number.isFinite));assert.ok(v.length<100000);
      if(chapter===0)meshes.push(JSON.stringify(v));
    }
  }
  assert.equal(new Set(meshes).size,data.dungeons.entries.length);
});
test('casebook hides undiscovered spoilers, escapes prose, and exposes the finder without online claims in local play',()=>{
  const {sim}=make();let html=dungeonPanel(data,sim.character,null,false,0);assert.match(html,/ONLINE GROUP REQUIRED/);assert.match(html,/1 RUNNER/);
  enter(sim);html=dungeonPanel(data,sim.character,sim.dungeon,false,0);assert.ok(!html.includes(data.dungeons.entries[0].chapters[0].reveal));assert.ok(!html.includes('The cushion is worn'));
  action(sim,'begin');sim.character.position=dungeonPosition(r,[-16,0,-12]);action(sim,'interact',{target:'chair'});html=dungeonPanel(data,sim.character,sim.dungeon,false,0);assert.ok(html.includes('The cushion is worn'));
  const poisoned=structuredClone(data);poisoned.dungeons.entries[0].chapters[0].briefing='<img src=x onerror=alert(1)>';
  html=dungeonPanel(poisoned,sim.character,sim.dungeon,false,0);assert.ok(!html.includes('<img'));assert.match(html,/&lt;img/);
});
test('local checkpoints and exports cannot strand a reconnect inside an abandoned arena',()=>{
  const {sim}=make();enter(sim);action(sim,'begin');const saved=decodeLocal(encodeLocal([sim.character]))[0];
  assert.deepEqual(saved.dungeonReturn,data.world.spawn);const reloaded=new Simulation(data,world,saved);assert.equal(reloaded.inDungeon,false);assert.deepEqual(reloaded.character.position,data.world.spawn);assert.equal(reloaded.character.dungeonReturn,undefined);
  const prior=sim.dungeon.run.id;action(sim,'leave');sim.lastCombat=-100;enter(sim);assert.notEqual(sim.dungeon.run.id,prior);assert.equal(action(sim,'leave',{run:prior}),false);
  sim.time=sim.dungeon.run.started+r.maxRunSeconds;sim.tick(.05);assert.equal(sim.inDungeon,false);assert.deepEqual(sim.character.position,data.world.spawn);
});
