// Gameplay, geometry, rendering, and input regressions. All fixtures stay in memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GhostTrail, ghostPosition, ghostContact } from '../client/src/ghostline.js';
import { Simulation, createCharacter } from '../client/src/simulation.js';
import { World } from '../client/src/world.js';
import { Renderer } from '../client/src/renderer.js';
import { Input } from '../client/src/input.js';

const names=['world','rules','races','factions','quests','talents','abilities','enemies'];
const data=Object.fromEntries(await Promise.all(names.map(async name=>[name,JSON.parse(await readFile(new URL(`../client/data/${name}.json`,import.meta.url),'utf8'))])));
const world=new World(data.world),rules=data.rules.ghostline;
const emptyWorld={lineOfSight:()=>true,collides:()=>false};
const cast={type:'ability',id:'ghostline'};
const stationaryGhost=()=>({owner:'owner',name:'Runner',started:0,path:[{time:0,position:[0,0,0]},{time:3,position:[0,0,0]}]});
function make(){
  const events=[],sim=new Simulation(data,world,createCharacter('Runner','human','relay',data),e=>events.push(e),()=>.5);
  sim.character.position=[0,0,300];sim.enemies=[];
  return {sim,events};
}
function move(sim,seconds=3){for(let i=0;i<seconds*20;i++)sim.tick(.05,{forward:1,yaw:0});}

test('history is bounded, time-based, and released as an independent immutable route',()=>{
  const trail=new GhostTrail(rules,46);
  for(let i=0;i<=2000;i++)trail.record(i*.05,[0,0,i*.5]);
  assert.ok(trail.samples.length<=61);
  assert.ok(trail.samples[0].time>=94-1e-8);
  assert.ok(trail.charge.ready);
  const ghost=trail.release({id:'owner',name:'Runner'},100);
  assert.equal(ghost.path[0].time,0);
  assert.ok(ghost.path.at(-1).time<=6+1e-8);
  const serialized=JSON.stringify(ghost);
  trail.samples[0].position[0]=1000;trail.clear();
  assert.equal(JSON.stringify(ghost),serialized);
});

test('idle, too-short, stale, and teleported recordings cannot become usable routes',()=>{
  const trail=new GhostTrail(rules,46);
  for(let i=0;i<=60;i++)trail.record(i*.1,[0,0,0]);
  assert.equal(trail.charge.ready,false);
  trail.clear();
  for(let i=0;i<=10;i++)trail.record(i*.1,[i*2,0,0]);
  assert.ok(trail.charge.meters>=12);assert.equal(trail.charge.ready,false);
  for(let i=11;i<=80;i++)trail.record(i*.1,[20,0,0]);
  assert.equal(trail.charge.ready,false,'Old movement must age out even while standing still');
  trail.record(8.1,[1000,0,0]);assert.equal(trail.samples.length,1);
  trail.record(20,[1000,0,0]);assert.equal(trail.samples.length,1);
  trail.record(0,[1000,0,0]);assert.equal(trail.samples.length,1);
});

test('recording and replay keep real timing across variable client frame rates',()=>{
  const trail=new GhostTrail(rules,46);let time=0;
  for(let i=0;i<400;i++){time+=[.011,.027,.05][i%3];trail.record(time,[time*10,0,0]);}
  const ghost=trail.release({id:'owner',name:'Runner'},time);
  const middle=ghost.path.at(-1).time/2,position=ghostPosition(ghost,time+middle);
  assert.ok(Math.abs(position[0]-(ghost.path[0].position[0]+middle*10))<1e-8);
  assert.deepEqual(ghostPosition(ghost,time-1),ghost.path[0].position);
  assert.deepEqual(ghostPosition(ghost,time+20),ghost.path.at(-1).position);
});

test('swept contact catches a fast crossing and chooses the same partner regardless of iteration order',()=>{
  const ghost=stationaryGhost(),runner=id=>({id,health:100,previous:[-4,0,0],position:[4,0,0]});
  const runners=[runner('b'),runner('a')];
  for(const list of [runners,[...runners].reverse()]){
    const contact=ghostContact(ghost,1,.05,list,emptyWorld,rules);
    assert.equal(contact.id,'a');assert.deepEqual(contact.position,[0,0,0]);
  }
  assert.equal(ghostContact(ghost,.5,.05,runners,emptyWorld,rules),null);
  assert.equal(ghostContact(ghost,3.1,.05,runners,emptyWorld,rules),null);
  assert.equal(ghostContact(ghost,1,.05,[{...runner('a'),health:0}],emptyWorld,rules),null);
});

test('arming does not retroactively count an earlier crossing; walls and elevation block contact',()=>{
  const ghost=stationaryGhost(),runner={id:'owner',health:100,previous:[-4,0,0],position:[20,0,0]};
  assert.equal(ghostContact(ghost,.61,.05,[runner],emptyWorld,rules),null);
  const standing={...runner,previous:[0,0,0],position:[0,0,0]};
  assert.equal(ghostContact(ghost,1,.05,[standing],{...emptyWorld,lineOfSight:()=>false},rules),null);
  assert.equal(ghostContact(ghost,1,.05,[standing],{...emptyWorld,collides:()=>true},rules),null);
  assert.equal(ghostContact(ghost,1,.05,[{...standing,previous:[0,24,0],position:[0,24,0]}],emptyWorld,rules),null);
  const b=world.buildings[0];ghost.path.forEach(s=>s.position=[b.x,0,b.z]);
  assert.equal(ghostContact(ghost,1,.05,[{...standing,previous:[b.x,0,b.z],position:[b.x,0,b.z]}],world,rules),null);
});

test('the final partial frame can braid before expiry but cannot count a later crossing',()=>{
  const ghost=stationaryGhost(),runner={id:'owner',health:100,previous:[-4,0,0],position:[0,0,0]};
  assert.equal(ghostContact(ghost,3.02,.05,[runner],emptyWorld,rules).id,'owner');
  assert.equal(ghostContact(ghost,3.02,.05,[{...runner,previous:[-20,0,0]}],emptyWorld,rules),null);
});

test('casting validates fresh movement, health, energy, and cooldown before charging the player',()=>{
  const {sim}=make();
  assert.equal(sim.action({...cast,path:stationaryGhost().path}),false);
  assert.equal(sim.character.energy,100);assert.equal(sim.cooldowns.ghostline,undefined);
  move(sim);sim.character.energy=29;
  assert.equal(sim.action(cast),false);assert.equal(sim.cooldowns.ghostline,undefined);
  sim.character.energy=100;assert.ok(sim.action(cast));
  assert.equal(sim.character.energy,70);assert.equal(sim.cooldowns.ghostline,sim.time+18);
  assert.equal(sim.action(cast),false);assert.equal(sim.ghostlines.length,1);assert.equal(sim.character.energy,70);
  sim.time+=19;sim.character.health=0;assert.equal(sim.action(cast),false);
});

test('a real move, cast, and return braids once, restores dash, and gives ordinary kill credit',()=>{
  const {sim,events}=make();move(sim);
  const spawn=data.world.enemySpawns[0],template=data.enemies.find(e=>e.id===spawn.type);
  sim.enemies=[{...template,id:'victim',type:spawn.type,level:0,position:[0,0,285],home:[0,0,285],health:35,maxHealth:35,stunUntil:999,respawnAt:0}];
  const quest=data.quests.find(q=>q.objective.type==='kill'&&q.objective.target===spawn.type);
  sim.character.activeQuests[quest.id]=0;
  assert.ok(sim.action(cast));sim.character.energy=0;sim.dashReady=999;
  let beforeEnergy;
  for(let i=0;i<120&&!events.some(e=>e.type==='braid');i++){beforeEnergy=sim.character.energy;sim.tick(.05,{forward:-1,yaw:0});}
  assert.equal(events.filter(e=>e.type==='braid').length,1);
  assert.equal(sim.ghostlines.length,0);assert.equal(sim.dashReady,sim.time);
  assert.ok(Math.abs(sim.character.energy-beforeEnergy-.05*data.rules.player.energyRegen-20)<1e-8);
  assert.equal(sim.enemies[0].health,0);assert.equal(sim.character.activeQuests[quest.id],1);
  assert.equal(sim.character.xp,data.rules.xp.killBase);assert.equal(sim.character.credits,data.rules.startingCredits+5);
  for(let i=0;i<60;i++)sim.tick(.05);
  assert.equal(events.filter(e=>e.type==='braid').length,1);assert.equal(events.filter(e=>e.type==='reward').length,1);
});

test('a shockwave cannot damage enemies beyond its radius or through a wall',()=>{
  const {sim,events}=make();move(sim);assert.ok(sim.action(cast));
  const ghost=sim.ghostlines[0];sim.time=ghost.started+1;
  const center=ghostPosition(ghost,sim.time);
  sim.character.position=[...center];
  sim.world={...emptyWorld,lineOfSight:(a,b)=>b[0]!==3};
  sim.enemies=[{id:'hidden',position:[3,0,center[2]],health:100},{id:'far',position:[0,0,center[2]+11],health:100}];
  sim.tickGhostlines(.05,center);
  assert.equal(events.filter(e=>e.type==='braid').length,1);
  assert.deepEqual(sim.enemies.map(e=>e.health),[100,100]);
});

test('unclaimed echoes expire without refunds, and lifts, death, respawn, and a new session clear them',()=>{
  const expired=make();move(expired.sim);assert.ok(expired.sim.action(cast));expired.sim.dashReady=999;
  move(expired.sim,4);assert.equal(expired.sim.ghostlines.length,0);assert.equal(expired.sim.dashReady,999);
  assert.equal(expired.events.some(e=>e.type==='braid'),false);
  for(const reason of ['lift','death','respawn']){
    const {sim}=make();move(sim);assert.ok(sim.action(cast));
    if(reason==='lift'){sim.character.position=[0,0,-80];assert.ok(sim.action({type:'lift',id:'commons-lift'}));}
    else{sim.character.health=0;if(reason==='death')sim.tick(.05);else{sim.deadAt=sim.time-5;assert.ok(sim.action({type:'respawn'}));}}
    assert.equal(sim.ghostlines.length,0);assert.equal(sim.ghostTrail.samples.length,0);
  }
  const {sim}=make();move(sim);sim.action(cast);
  const reloaded=new Simulation(data,world,structuredClone(sim.character));
  assert.equal(reloaded.ghostlines.length,0);assert.equal(reloaded.ghostTrail.samples.length,0);
});

test('online prediction never records authoritative routes, triggers a braid, or grants its rewards',()=>{
  const {sim,events}=make(),ghost=stationaryGhost();ghost.owner=sim.character.id;
  sim.character.position=[0,0,0];sim.character.energy=10;sim.dashReady=99;sim.ghostlines=[ghost];
  for(let i=0;i<30;i++)sim.tick(.05,{},true);
  assert.equal(sim.character.energy,10);assert.equal(sim.dashReady,99);
  assert.equal(sim.ghostTrail.samples.length,0);assert.equal(sim.ghostlines.length,1);
  assert.equal(events.some(e=>e.type==='braid'),false);
});

test('ghost runner, route, and contact ring produce finite, bounded, emissive geometry without WebGL',async()=>{
  const models=JSON.parse(await readFile(new URL('../client/assets/models.json',import.meta.url),'utf8'));
  const {sim}=make();move(sim,8);sim.action(cast);
  const mesh={models,actor:Renderer.prototype.actor},vertices=[];
  Renderer.prototype.ghostline.call(mesh,vertices,sim.ghostlines[0],sim.time+1);
  assert.ok(vertices.length>0&&vertices.length<40000);assert.equal(vertices.length%30,0);
  assert.ok(vertices.every(Number.isFinite));
  for(let i=9;i<vertices.length;i+=10)assert.ok(vertices[i]>=.8&&vertices[i]<=1);
});

test('keyboard R and controller right-stick press emit exactly one cast per press',t=>{
  const listeners={},actions=[];
  const pad={id:'Test controller',mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:16},()=>({pressed:false}))};
  const replacements={window:{addEventListener:(name,fn)=>listeners[name]=fn},document:{addEventListener:()=>{},querySelector:()=>null},navigator:{getGamepads:()=>[pad]}};
  const originals=Object.fromEntries(Object.keys(replacements).map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  t.after(()=>{for(const [name,descriptor]of Object.entries(originals)){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
  for(const [name,value]of Object.entries(replacements))Object.defineProperty(globalThis,name,{configurable:true,value});
  const input=new Input({addEventListener:()=>{}},action=>actions.push(action),()=>{});
  input.active=true;input.menu=false;
  const key={code:'KeyR',target:{tagName:'BODY'},repeat:false};
  listeners.keydown(key);listeners.keydown({...key,repeat:true});
  assert.deepEqual(actions,['ability:ghostline']);
  listeners.keyup(key);listeners.keydown({...key,target:{tagName:'INPUT'}});
  assert.equal(actions.length,1,'Typing in a form must not cast');
  pad.buttons[11].pressed=true;input.sample(.016);input.sample(.016);
  assert.equal(actions.length,2);
  pad.buttons[11].pressed=false;input.sample(.016);pad.buttons[11].pressed=true;input.sample(.016);
  assert.deepEqual(actions,Array(3).fill('ability:ghostline'));
});
