import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World } from '../src/world.js';
import { Prediction } from '../src/prediction.js';
import { collectTargets, targetProblem } from '../src/targeting.js';
import { doorSeconds, doorOpen, rideDuration, ridePosition, rideLabel } from '../src/elevators.js';
import { elevatorCabin } from '../src/elevator-scenery.js';

const read=name=>JSON.parse(readFileSync(new URL(`../data/${name}.json`,import.meta.url)));
const data=Object.fromEntries(['world','rules','races','talents','abilities','npcs','quests','dungeons'].map(name=>[name,read(name)]));
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
