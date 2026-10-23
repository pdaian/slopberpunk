import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { World } from '../src/world.js';
import { Prediction, experienceFor } from '../src/prediction.js';
import { collectTargets, targetProblem, elevatorTarget } from '../src/targeting.js';
import { doorSeconds, doorOpen, rideDuration, ridePosition, rideLabel } from '../src/elevators.js';
import { elevatorCabin } from '../src/elevator-scenery.js';
import { isSpirit } from '../src/death.js';
import { controlLabel, inputText } from '../src/input-prompts.js';
import { distance, clamp } from '../src/math.js';
import { formatGold } from '../src/currency.js';
import { clockLabel } from '../src/clock.js';
import { founderBoostActive } from '../src/founders.js';
import { talentBudget } from '../src/progression.js';
import { enemyAttackStatus } from '../src/enemy-attacks.js';

const read=name=>JSON.parse(readFileSync(new URL(`../data/${name}.json`,import.meta.url)));
const data=Object.fromEntries(['world','rules','races','factions','talents','abilities','npcs','quests','dungeons','events'].map(name=>[name,read(name)]));
const world=new World(data.world),near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const player=position=>new Prediction(data,world,{id:'guest',position:[...position],yaw:0,race:'human',faction:'relay',level:0,talents:{},health:120,completed:[],activeQuests:{}});
const trip=(e,down=false)=>{
  const from=[e.position[0],down?e.stops[1]:0,e.position[2]],to=[e.position[0],down?0:e.stops[1],e.position[2]];
  return {id:e.id,from,to,started:10,duration:rideDuration(from,to)};
};

test('four distinct high-floor venues have free observation elevators and supported landings',()=>{
  assert.equal(world.elevators.length,4);
  assert.equal(new Set(world.elevators.map(e=>e.venue.kind)).size,4);
  assert.equal(new Set(world.elevators.map(e=>e.venue.velvet)).size,4);
  for(const e of world.elevators){
    const b=world.rooftops.find(b=>e.id===`elevator-${b.id}`);
    assert.ok(e.stops[1]>120&&e.stops[1]===b.h);
    for(const y of e.stops){
      const p=[e.position[0],y,e.position[2]];
      assert.equal(world.collides(...p),false);
      near(world.floorAt(p[0],p[2],y+.1,y-.2),y);
      assert.ok(world.lineOfSight([p[0],y,p[2]-2],p));
    }
    // Walk from the cabin into the venue and back, without jumping a parapet.
    let p=[e.position[0],b.h,e.position[2]];
    for(const z of [b.z,e.position[2]])while(Math.abs(p[2]-z)>1e-7){
      p=world.stepPosition(p,2,Math.max(-.2,Math.min(.2,z-p[2])),true);
      assert.ok(p,`${e.name} has a blocked arrival`);
      near(p[1],b.h);near(world.floorAt(p[0],p[2],b.h+.1,b.h-.2),b.h);
    }
    for(const side of [-1,1])assert.ok(world.collides(p[0]+side*3,b.h,p[2]),'balcony sides must protect the arrival');
    assert.ok(world.collides(p[0],b.h,p[2]+3),'panoramic end must have a solid guardrail');
  }
});

test('rides ease in both directions with closed gates throughout motion and bounded endpoints',()=>{
  for(const e of world.elevators)for(const down of [false,true]){
    const r=trip(e,down),start=r.started+doorSeconds,end=r.started+r.duration-doorSeconds;
    assert.deepEqual(ridePosition(r,-100),r.from);
    assert.deepEqual(ridePosition(r,start),r.from);
    assert.deepEqual(ridePosition(r,end+100),r.to);
    near(ridePosition(r,(start+end)/2)[1],e.stops[1]/2);
    assert.equal(doorOpen(r,r.started),1);near(doorOpen(r,start),0);
    near(doorOpen(r,r.started+r.duration),1);
    let previous=r.from[1];
    for(let time=start;time<=end;time+=.05){
      const y=ridePosition(r,time)[1];
      assert.ok(down?y<=previous:y>=previous);assert.ok(y>=0&&y<=e.stops[1]);
      near(doorOpen(r,time),0);previous=y;
    }
    assert.match(rideLabel(r,r.started),/Closing/);
    assert.match(rideLabel(r,start+1),down?/Descending/:/Ascending/);
    assert.match(rideLabel(r,end+.01),/Opening/);
  }
});

test('movement prediction stays in the cabin despite held jump, dash and movement, then releases on arrival',()=>{
  for(const e of world.elevators)for(const down of [false,true]){
    const ride=trip(e,down),sim=player(ride.from);sim.time=ride.started;sim.elevator=ride;
    for(let i=0;i<Math.ceil(ride.duration/.05)+20;i++){
      sim.tick(.05,{forward:1,strafe:1,jump:true,dash:true,sprint:true,yaw:.75});
      assert.deepEqual(sim.character.position,ridePosition(ride,sim.time));
      assert.deepEqual(sim.velocity,[0,0,0]);assert.equal(sim.dash,0);
    }
    assert.deepEqual(sim.character.position,ride.to);
    sim.elevator=null;
    for(let i=0;i<5;i++)sim.tick(.05,{forward:1,yaw:down?Math.PI:0});
    near(sim.character.position[1],ride.to[1]);
    assert.notEqual(sim.character.position[2],ride.to[2]);
    assert.equal(world.collides(...sim.character.position),false);
  }
});

test('targeting offers the correct destination at each landing, including to spirits, and nothing during transit',()=>{
  for(const e of world.elevators)for(const y of e.stops){
    const sim=player([e.position[0],y,e.position[2]]);
    let t=collectTargets(data,sim).find(t=>t.object.id===e.id);
    assert.ok(t);assert.equal(t.position[1],y);assert.equal(targetProblem(t,sim.character,world),null);
    assert.equal(t.action,y?'Return to street':'Visit top floor');
    sim.character.health=0;sim.character.death={released:true,corpse:[...sim.character.position],graveyard:data.world.graveyards[0].id};
    t=collectTargets(data,sim).find(t=>t.object.id===e.id);
    assert.ok(t);assert.equal(targetProblem(t,sim.character,world),null);
    sim.elevator=trip(e,y>0);assert.deepEqual(collectTargets(data,sim),[]);
    sim.elevator=null;sim.character.position[1]=e.stops[1]/2;
    t=collectTargets(data,sim).find(t=>t.object.id===e.id);
    assert.ok(!t||targetProblem(t,sim.character,world),'a passing cabin cannot be boarded from midair');
  }
});

test('elevator cabins remain finite and bounded through gate animation and reduced motion',()=>{
  for(const e of world.elevators){
    const ride=trip(e);
    for(const time of [ride.started,ride.started+doorSeconds,ride.started+ride.duration/2,ride.started+ride.duration])for(const reduced of [false,true]){
      const v=[];elevatorCabin(v,e,ridePosition(ride,time),ride,time,reduced);
      assert.ok(v.length>0&&v.length<110000);assert.equal(v.length%30,0);
      assert.ok(v.every(Number.isFinite));
      for(let i=0;i<v.length;i+=10)near(Math.hypot(...v.slice(i+3,i+6)),1);
    }
  }
});

test('invalid venue kinds, colors and missing descriptions fail content validation',()=>{
  const roof=data.world.rooftops.find(r=>r.venue);
  for(const venue of [null,{}, {...roof.venue,kind:'missing'},{...roof.venue,accent:'red'},{...roof.venue,velvet:'#fff'},{...roof.venue,description:''},{...roof.venue,view:'x'.repeat(301)}]){
    assert.throws(()=>new World({...data.world,rooftops:[{...roof,venue}]}),/rooftop venue/i);
  }
});

test('automatic elevator use covers each cabin floor without extending to nearby streets, walls or other heights',()=>{
  for(const e of world.elevators)for(const y of e.stops){
    const sim=player([e.position[0],y,e.position[2]]),c=sim.character;
    for(const x of [-2,0,2])for(const z of [-2.3,0,2.3]){
      c.position=[e.position[0]+x,y,e.position[2]+z];
      assert.equal(world.collides(...c.position),false);
      assert.equal(elevatorTarget(collectTargets(data,sim),c,world)?.object.id,e.id);
    }
    for(const offset of [[3.01,0,0],[-3.01,0,0],[0,0,3.01],[0,0,-3.01],[0,1,0],[0,-1,0],[0,5,0]]){
      c.position=[e.position[0]+offset[0],y+offset[1],e.position[2]+offset[2]];
      assert.equal(elevatorTarget(collectTargets(data,sim),c,world),null);
    }
    c.position=[e.position[0],y,e.position[2]];
    assert.equal(elevatorTarget(collectTargets(data,sim),c,{lineOfSight:()=>false}),null);
    c.health=0;
    assert.equal(elevatorTarget(collectTargets(data,sim),c,world),null);
    c.death={released:true,corpse:[...c.position],graveyard:data.world.graveyards[0].id};
    assert.equal(elevatorTarget(collectTargets(data,sim),c,world)?.object.id,e.id);
    sim.elevator=trip(e,y>0);
    assert.equal(elevatorTarget(collectTargets(data,sim),c,world),null);
  }
});

// Exercise the real application actions and HUD in memory, without browser files.
function application(position,storage=new Map(),id='guest'){
  const simulation=player(position),nodes=new Map(),sent=[];
  Object.assign(simulation.character,{id,name:'Guest',xp:0,gold:45,energy:100,medkits:3});
  const node=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{hidden:true,open:false,textContent:'',style:{},
      classList:{toggle(){}},querySelector:s=>node(`${selector} ${s}`)});
    return nodes.get(selector);
  };
  const context={fixtureData:data,fixtureWorld:world,fixtureSimulation:simulation,sent,
    document:{querySelector:node,querySelectorAll:()=>[]},matchMedia:()=>({matches:false}),WorldClock:class{now(){return 18000;}},
    setTimeout(){},clearTimeout(){},localStorage:storage instanceof Map?{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}:storage,
    collectTargets,targetProblem,elevatorTarget,rideLabel,isSpirit,controlLabel,inputText,distance,clamp,
    experienceFor,formatGold,clockLabel,founderBoostActive,talentBudget,enemyAttackStatus};
  let source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'');
  source=source.slice(0,source.lastIndexOf('boot().catch'));
  runInNewContext(source+`\ndata=fixtureData;world=fixtureWorld;simulation=fixtureSimulation;state='playing';
    input={lastDevice:'keyboard',clear(){}};connection={send(action){sent.push(action);}};cityLife={actors:[],neighborhoods:new Map()};
    updateStoryGuide=()=>{};updateRecoveryUI=()=>{};drawMap=()=>{};
    globalThis.harness={perform,updateHUD,cabinTarget,selectedTarget,inputBlocked,
      select(key){targetKey=key;},setDevice(device){input.lastDevice=device;},setChat(chat){liveChat=chat;},setScreen(screen){state=screen;}};`,context);
  return {...context.harness,simulation,node,sent};
}

test('every Use control rides immediately from either floor with no selection or a different target selected',()=>{
  for(const e of world.elevators)for(const y of e.stops)for(const device of ['keyboard','gamepad','touch']){
    const app=application([e.position[0]+2,y,e.position[2]-2.3]),c=app.simulation.character;
    app.setDevice(device);app.updateHUD();
    assert.equal(app.node('#interaction').hidden,false);
    assert.equal(app.node('#interaction').disabled,false);
    assert.equal(app.node('#interaction-key').textContent,controlLabel('interact',device));
    assert.match(app.node('#interaction-text').textContent,y?/Return to street/:/Visit top floor/);
    app.perform('interact');
    const enemy={id:'other-target',name:'Machine',health:100,position:[...c.position]};
    app.simulation.enemies=[enemy];app.select('enemy:other-target');app.updateHUD();
    assert.equal(app.selectedTarget().object.id,enemy.id);
    assert.ok(app.node('#interaction-text').textContent.includes(e.name));
    app.perform('interact');app.perform('pick-activate');
    assert.equal(app.sent.length,3);
    for(const action of app.sent){assert.equal(action.type,'lift');assert.equal(action.id,e.id);}
    assert.equal(app.node('#panel-dialog').open,false);
    assert.equal(app.inputBlocked(),false);
    assert.equal(app.simulation.elevator,null,'travel still waits for the server');
    assert.deepEqual(c.position,[e.position[0]+2,y,e.position[2]-2.3]);
    app.perform('ability:arc');
    assert.equal(app.sent.at(-1).type,'ability');assert.equal(app.sent.at(-1).target,enemy.id);
  }
});

test('menus, chat, death and transit block boarding, while spirits and arrivals can use the cabin',()=>{
  const e=world.elevators[0],app=application(e.position),c=app.simulation.character;
  app.node('#panel-dialog').open=true;app.perform('interact');
  app.node('#panel-dialog').open=false;app.setChat({expanded:true});app.perform('interact');
  app.setChat(null);c.health=0;app.perform('interact');
  assert.equal(app.sent.length,0);
  c.death={released:true,corpse:[...c.position],graveyard:data.world.graveyards[0].id};
  app.perform('interact');assert.equal(app.sent.length,1);
  const ride=trip(e);app.simulation.elevator=ride;app.simulation.time=ride.started;
  app.perform('interact');app.perform('pick-activate');app.updateHUD();
  assert.equal(app.sent.length,1);assert.equal(app.node('#interaction').hidden,true);
  assert.equal(app.node('#elevator-status').hidden,false);assert.match(app.node('#elevator-phase').textContent,/Closing/);
  app.simulation.elevator=null;c.position=[...ride.to];app.updateHUD();
  assert.match(app.node('#interaction-text').textContent,/Return to street/);
  app.perform('interact');assert.equal(app.sent.length,2);
  app.simulation.dungeonState={run:{phase:'complete'}};
  assert.equal(app.cabinTarget(),null);
});

test('nearby selection still boards directly and ordinary lifts still require selection',()=>{
  const e=world.elevators[0],app=application([e.position[0],0,e.position[2]+3.5]);
  assert.equal(app.cabinTarget(),null);app.perform('interact');assert.equal(app.sent.length,0);
  app.select(`lift:${e.id}`);app.perform('interact');
  assert.equal(app.sent.length,1);assert.equal(app.sent[0].id,e.id);assert.equal(app.node('#panel-dialog').open,false);
  const lift=data.world.lifts[0];app.simulation.character.position=[...lift.position];app.select(null);
  assert.equal(app.cabinTarget(),null);app.perform('interact');assert.equal(app.sent.length,1);
  app.select(`lift:${lift.id}`);app.perform('interact');assert.equal(app.sent.length,2);assert.equal(app.sent[1].id,lift.id);
});

test('first entry shows nonblocking device-aware help once per character, including after reconnecting',()=>{
  const e=world.elevators[0],storage=new Map(),app=application([e.position[0],0,e.position[2]+4],storage),c=app.simulation.character;
  app.updateHUD();assert.equal(app.node('#elevator-tutorial').hidden,true);assert.equal(storage.size,0);
  c.position=[...e.position];app.node('#panel-dialog').open=true;app.updateHUD();assert.equal(storage.size,0);
  app.node('#panel-dialog').open=false;app.setChat({expanded:true});app.updateHUD();assert.equal(storage.size,0);
  app.setChat(null);app.setScreen('cinematic');app.updateHUD();assert.equal(storage.size,0);
  app.setScreen('playing');app.updateHUD();
  assert.equal(app.node('#elevator-status').hidden,false);assert.equal(app.node('#elevator-tutorial').hidden,false);
  assert.equal(app.node('#panel-dialog').open,false);assert.equal(app.inputBlocked(),false);assert.equal(app.sent.length,0);
  assert.equal(storage.size,1);
  const hint=app.node('#elevator-tutorial');let text=hint.textContent,writes=0;
  Object.defineProperty(hint,'textContent',{get:()=>text,set:value=>{text=value;writes++;}});
  app.updateHUD();app.updateHUD();assert.equal(writes,0,'unchanged help must not repeat live-region announcements');
  for(const [device,pattern]of [['keyboard',/press E/],['gamepad',/press X/],['touch',/tap USE/]]){
    app.setDevice(device);app.updateHUD();assert.match(app.node('#elevator-tutorial').textContent,pattern);
  }
  c.position[2]+=4;app.updateHUD();c.position=[...e.position];app.updateHUD();
  assert.equal(app.node('#elevator-tutorial').hidden,true);assert.equal(app.node('#interaction').hidden,false);
  c.position=[...world.elevators[1].position];app.updateHUD();assert.equal(app.node('#elevator-tutorial').hidden,true);
  const reconnected=application(e.position,storage);reconnected.updateHUD();assert.equal(reconnected.node('#elevator-tutorial').hidden,true);
  const other=application(e.position,storage,'another-character');other.updateHUD();assert.equal(other.node('#elevator-tutorial').hidden,false);
});

test('first-ride help also works when boarding from outside, and unavailable storage never repeats it within a session',()=>{
  const e=world.elevators[0],storage={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}},app=application(e.position,storage);
  app.simulation.elevator=trip(e);app.simulation.time=10;app.updateHUD();
  assert.equal(app.node('#elevator-tutorial').hidden,false);assert.match(app.node('#elevator-phase').textContent,/Closing/);
  app.simulation.elevator=null;app.simulation.character.position=[e.position[0],e.stops[1],e.position[2]-4];app.updateHUD();
  app.simulation.character.position=[...e.position];app.updateHUD();assert.equal(app.node('#elevator-tutorial').hidden,true);
  app.simulation.elevator=trip(e);app.updateHUD();
  assert.equal(app.node('#elevator-tutorial').hidden,true);assert.equal(app.node('#elevator-status').hidden,false);
});
