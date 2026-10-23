// Run without a build: node --experimental-default-type=module --test client/tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, routeHeight, routeBlocksRay } from '../src/world.js';
import { Prediction } from '../src/prediction.js';
import { CharacterMeshes, motionPose } from '../src/character.js';
import { box, bevelBox, ellipsoid, slope, transformMesh } from '../src/geometry.js';
import { Renderer } from '../src/renderer.js';
import { CityLife } from '../src/citylife.js';
import { rooftopGeometry, streetDestination, routeGeometry } from '../src/scenery.js';
import { rideDuration, ridePosition } from '../src/elevators.js';

const read=name=>JSON.parse(readFileSync(new URL(`../data/${name}.json`,import.meta.url)));
const data=Object.fromEntries(['world','rules','races','talents','dungeons','citylife'].map(name=>[name,read(name)]));
const models=JSON.parse(readFileSync(new URL('../assets/models.json',import.meta.url)));
const world=new World(data.world),rooms=world.buildings.filter(b=>b.interior);
const player=position=>new Prediction(data,world,{position:[...position],yaw:0,race:'human',level:0,talents:{},health:120});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);

test('interiors preserve the original deterministic city footprint',()=>{
  const legacy=new World({...data.world,interiors:undefined});
  assert.equal(world.buildings.length,725);assert.equal(rooms.length,577);
  for(let i=0;i<725;i++)for(const key of ['x','z','w','d','h','shade','accent','seed'])assert.equal(world.buildings[i][key],legacy.buildings[i][key]);
  assert.equal(new Set(rooms.map(b=>b.interior.name)).size,8);
});

test('every address has a stable identity and a district-specific purpose',()=>{
  assert.equal(new Set(world.buildings.map(b=>b.identity.name)).size,725);
  assert.equal(new Set(world.buildings.map(b=>b.identity.address)).size,725);
  assert.equal(new Set(world.buildings.map(b=>b.identity.detail)).size,8);
  for(const b of world.buildings){
    assert.ok(b.identity.purpose&&b.identity.history&&b.identity.material&&b.identity.role);
    assert.equal(world.district([b.x,40,b.z]).id,b.identity.district,'height must not rename a neighborhood');
  }
});

test('streets, stairs, ramps and hills are traversable in both directions without jumping',()=>{
  for(const route of world.routes){
    for(const reverse of [false,true]){
      const start=reverse?route.end:route.start,end=reverse?route.start:route.end;
      const sim=player(start),dx=end[0]-start[0],dz=end[2]-start[2],length=Math.hypot(dx,dz);
      sim.character.yaw=Math.atan2(-dx,-dz);
      const limit=Math.ceil(length/(data.rules.movement.speed*.05))*3+20;
      let progress=0;
      for(let frame=0;frame<limit&&progress<length-.05;frame++){
        sim.tick(.05,{forward:1,sprint:frame%100>50,dash:frame%100===60});
        const p=sim.character.position;progress=((p[0]-start[0])*dx+(p[2]-start[2])*dz)/length;
        assert.equal(world.collides(...p),false,`${route.id}: entered geometry at ${p}`);
      }
      assert.ok(progress>=length-.05,`${route.id}: ${reverse?'descent':'ascent'} stopped at ${sim.character.position}`);
      assert.ok(Math.abs(sim.character.position[1]-end[1])<.45,`${route.id}: missed landing`);
    }
  }
});

test('street circuits and their approaches connect ground, 12 m, skyways and crowns in both directions',()=>{
  const paths=[
    [[-160,12,-240],[160,12,-240],[160,12,160],[-160,12,160],[-160,12,-240]],
    [[-320,48,-80],[328,48,-80],[328,48,320],[-320,48,320],[-320,48,-80]],
    [[-80,0,-328],[-80,0,-320],[-80,12,-248],[-80,12,-240],[-160,12,-240],[-160,12,0],[-168,12,0],[-314,24,0],[-323.5,24,0],[-323.5,24,-200],[-320,24,-200],[-320,48,-80],[328,48,-80],[328,48,320],[320,48,320],[320,24,200],[320,24,0],[314,24,0],[168,12,0],[160,12,0],[160,12,160],[80,12,160],[80,12,168],[80,0,232],[80,0,240]]
  ];
  for(const path of paths)for(const reverse of [false,true]){
    const stops=reverse?[...path].reverse():path;
    let position=[...stops[0]];
    for(const end of stops.slice(1)){
      const axis=position[0]===end[0]?2:0;
      assert.equal(position[2-axis],end[2-axis]);
      while(Math.abs(position[axis]-end[axis])>1e-7){
        const next=world.stepPosition(position,axis,Math.max(-.25,Math.min(.25,end[axis]-position[axis])),true);
        assert.ok(next,`Street journey blocked at ${position} toward ${end}`);
        assert.ok(Math.abs(world.floorAt(next[0],next[2],next[1]+.01,next[1]-.01)-next[1])<1e-7,`Missing street floor at ${next} toward ${end}`);
        assert.ok(Math.abs(next[1]-position[1])<=.42,'street junction must not require jumping or falling');
        position=next;
      }
      near(position[1],end[1]);
    }
  }
});

test('elevated streets support both lanes, leave underpasses open, and block shots and jumps through their decks',()=>{
  const streets=data.world.routes.filter(r=>r.kind==='street');
  assert.equal(streets.length,12);
  for(const route of streets){
    const axis=route.start[0]===route.end[0]?2:0,cross=2-axis;
    for(const t of [.25,.5,.75])for(const side of [-1,0,1]){
      const p=route.start.map((n,i)=>n+(route.end[i]-n)*t);p[cross]+=side*(route.width/2-1);
      assert.equal(world.collides(...p),false,`${route.id}: lane is obstructed`);
      near(world.floorAt(p[0],p[2],p[1]+.01,p[1]-.01),p[1]);
      assert.equal(world.streetAt(p),route);
      assert.equal(world.streetAt([p[0],0,p[2]]),null);
      assert.equal(world.collides(p[0],0,p[2]),false,`${route.id}: underpass is blocked`);
      assert.ok(world.collides(p[0],p[1]-.2,p[2]));
      assert.equal(world.lineOfSight([p[0],p[1]-4,p[2]],p),false);
      near(world.ceilingAt(p[0],p[2],p[1]-3,p[1]),p[1]-.35-2.1);
    }
    const p=route.start.map((n,i)=>(n+route.end[i])/2),sim=player(p);
    sim.tick(.025,{jump:true});assert.ok(sim.character.position[1]>p[1]);
    for(let i=0;i<120;i++)sim.tick(.025,{});
    near(sim.character.position[1],p[1]);assert.ok(sim.grounded);
    const mesh=[];routeGeometry(mesh,route);
    assert.ok(mesh.length>0&&mesh.every(Number.isFinite));assert.equal(mesh.length%30,0);
    assert.ok(mesh.length<20000,'street geometry must remain bounded');
    for(let i=0;i<mesh.length;i+=10)near(Math.hypot(...mesh.slice(i+3,i+6)),1);
  }
});

test('ramps have solid undersides, block cross-floor sightlines, and allow an underpass',()=>{
  const route=data.world.routes.find(r=>r.id==='commons-ramp'),x=route.start[0],z=(route.start[2]+route.end[2])/2,y=routeHeight(route,x,z);
  assert.equal(world.collides(x,y,z),false);assert.ok(world.collides(x,y-.2,z));
  assert.equal(world.collides(x,0,z),false);
  near(world.ceilingAt(x,z,y-3,y,.65,2.1),y-.35-2.1);
  assert.equal(world.lineOfSight([x,0,z],[x,y,z]),false);
  assert.equal(routeBlocksRay(route,[x,y+1,z],[x,y+1,z+1]),false);
  const sim=player([x,y,z]);sim.tick(.05,{jump:true});
  assert.ok(sim.character.position[1]>y);assert.equal(sim.grounded,false,'jump must leave the slope');
  for(let i=0;i<120;i++)sim.tick(.025,{});
  near(sim.character.position[1],y);
});

test('malformed routes cannot introduce invalid heights or unwalkable steps',()=>{
  const base=data.world.routes.find(r=>r.kind==='stairs');
  for(const patch of [{end:base.start},{end:[base.end[0]+4,base.end[1],base.end[2]]},{steps:0},{steps:1},{width:Infinity},{kind:'missing'},{start:[0,-1,0]}]){
    assert.throws(()=>new World({...data.world,routes:[{...base,...patch}]}),/Invalid city/);
  }
});

test('sloped slabs and embankments have outward faces and finite unit normals',()=>{
  for(const filled of [true,false])for(const reverse of [true,false]){
    const a=[0,0,0],b=[0,8,32],v=[];slope(v,reverse?b:a,reverse?a:b,6,'#56664b',filled);
    assert.ok(v.length>0&&v.every(Number.isFinite));
    const center=[0,filled?2:3.825,16];
    for(let i=0;i<v.length;i+=30){
      const a=v.slice(i,i+3),b=v.slice(i+10,i+13),c=v.slice(i+20,i+23),n=v.slice(i+3,i+6);
      near(Math.hypot(...n),1);
      assert.ok(n.reduce((sum,x,j)=>sum+x*((a[j]+b[j]+c[j])/3-center[j]),0)>0,'inward slope face');
    }
  }
});

test('upper floors have usable rooms, closed windows and stairwell openings',()=>{
  const h=data.world.interiors.height;
  for(const b of rooms)for(const floor of [1,2]){
    near(world.floorAt(b.x,b.z,floor*h+.1,floor*h-.1),floor*h);
    assert.equal(world.interiorAt([b.x,floor*h,b.z]),b);
    assert.equal(world.collides(b.x,floor*h,b.z),false);
    assert.ok(world.collides(b.x,floor*h,b.z+b.d/2),'upper window must stop a player');
  }
});

test('every furnished ground floor has two accessible doors and an unobstructed aisle',()=>{
  for(const b of rooms){
    for(let z=-b.d/2-2;z<=b.d/2+2;z+=.35)assert.equal(world.collides(b.x,0,b.z+z),false,`${b.x},${b.z}: aisle blocked`);
    for(const side of [-1,1]){
      assert.ok(world.collides(b.x+side*b.w/2,0,b.z),'side wall must block');
      assert.ok(world.collides(b.x+6,0,b.z+side*b.d/2),'door wings must block');
      assert.equal(world.collides(b.x,0,b.z+side*b.d/2),false);
    }
    for(const item of b.interior.furniture)assert.ok(world.collides(b.x+item.center[0],0,b.z+item.center[2]),'furniture must be solid');
    assert.equal(world.interiorAt([b.x,0,b.z]),b);
    assert.equal(world.interiorAt([b.x,b.h,b.z]),null);
  }
});

test('rooftops, furniture tops, and skyway landings remain valid floors',()=>{
  for(const b of world.buildings)near(world.floorAt(b.x,b.z,b.h+1,b.h-1),b.h);
  for(const b of rooms)for(const item of b.interior.furniture){
    const top=item.center[1]+item.size[1]/2;
    near(world.floorAt(b.x+item.center[0],b.z+item.center[2],top+.1,top-.1),top);
  }
  near(world.floorAt(0,-80,25,23),24);
  assert.ok(world.collides(data.world.bounds+1,0,0));
});

test('all street destinations have continuous routes to their roofs and back',()=>{
  assert.equal(world.rooftops.length,data.world.rooftops.length);
  assert.equal(new Set(world.rooftops.map(b=>b.rooftop.kind)).size,5);
  for(const b of world.rooftops){
    const path=[[b.x,0,b.z+b.d/2+3],[b.x,0,b.routes[0].start[2]],...b.routes.flatMap(r=>[r.start,r.end]),[b.x,b.h,b.routes.at(-1).end[2]],[b.x,b.h,b.z]];
    let position=[...path[0]];
    for(const end of [...path.slice(1),...path.slice(0,-1).reverse()]){
      const axis=position[0]===end[0]?2:0;
      assert.equal(position[2-axis],end[2-axis],'landings must connect without cutting corners');
      while(Math.abs(position[axis]-end[axis])>1e-7){
        position=world.stepPosition(position,axis,Math.max(-.25,Math.min(.25,end[axis]-position[axis])),true);
        assert.ok(position,`${b.rooftop.name}: blocked route to ${end}`);
        near(world.floorAt(position[0],position[2],position[1]+.1,position[1]-.2),position[1]);
      }
      near(position[1],end[1]);
    }
    assert.deepEqual(position,path[0]);
    assert.equal(world.rooftopAt([b.x,b.h,b.z]),b);
    assert.equal(world.interiorAt([b.x,b.h,b.z]),null);
    assert.equal(world.rooftopAt([b.x,0,b.z]),null);
    for(const y of b.levels.slice(0,-1))assert.equal(world.interiorAt([b.x,y,b.z]),b);
    for(const axis of [0,2])for(const side of [-1,1]){
      if(b.rooftop.venue&&axis===2&&side===1)continue; // Protected elevator balcony replaces this parapet.
      const p=[b.x,b.h,b.z];p[axis]+=side*((axis===0?b.w:b.d)/2-.2);
      assert.ok(world.collides(...p),'roof parapet must prevent walking off the edge');
    }
    assert.ok(world.collides(b.x+6,b.h,b.z+5),'roof furniture must be solid');
    for(const side of [-1,1]){
      const counter=[b.x+side*6,0,b.z+b.d/2+1.2];
      assert.ok(world.collides(...counter),'street counters must be solid outside the building footprint');
      near(world.floorAt(counter[0],counter[2],1.3,1.1),1.2);
      assert.equal(world.collides(counter[0],1.2,counter[2]),false);
    }
    const ceiling=world.ceilingAt(b.x,b.z,b.levels.at(-2),b.h,.65,2.1);
    near(ceiling,b.h-.35-2.1);
  }
});

test('rooftop scenery leaves the final stairwell visibly open',()=>{
  for(const b of world.rooftops){
    const roof=[],street=[];rooftopGeometry(roof,b);streetDestination(street,b);
    for(const mesh of [roof,street]){
      assert.ok(mesh.length>0&&mesh.every(Number.isFinite));
      assert.equal(mesh.length%30,0);
      assert.ok(mesh.length<180000,'destination geometry must remain bounded');
    }
    const route=b.routes.at(-1),point=route.start.map((n,i)=>n+(route.end[i]-n)*.85);
    for(let i=0;i<roof.length;i+=30){
      const triangle=[roof.slice(i,i+3),roof.slice(i+10,i+13),roof.slice(i+20,i+23)];
      if(!triangle.every(p=>Math.abs(p[1]-b.h)<1e-7))continue;
      const crosses=triangle.map((a,j)=>{const c=triangle[(j+1)%3];return(c[0]-a[0])*(point[2]-a[2])-(c[2]-a[2])*(point[0]-a[0]);});
      assert.ok(!(crosses.every(n=>n>=0)||crosses.every(n=>n<=0)),'roof mesh sealed the stairwell');
    }
  }
});

test('rooftop records reject duplicates, missing buildings and invalid presentation',()=>{
  const roof=data.world.rooftops[0];
  for(const rooftops of [[roof,roof],[{...roof,cell:[0,0]}],[{...roof,cell:[999,999]}],[{...roof,cell:1}],[{...roof,kind:'missing'}],[{...roof,name:12}],[null]]){
    assert.throws(()=>new World({...data.world,rooftops}),/rooftop/i);
  }
});

test('predicted sprint and dash enter and leave each room layout without wall penetration',()=>{
  for(const name of new Set(rooms.map(b=>b.interior.name))){
    const b=rooms.find(b=>b.interior.name===name),sim=player([b.x,0,b.z+b.d/2+3]);
    let frames=0;
    while(sim.character.position[2]>b.z-b.d/2-2&&frames++<120){
      sim.tick(.05,{forward:1,sprint:true,dash:frames===4});
      assert.equal(world.collides(...sim.character.position),false,'prediction entered a solid');
    }
    assert.ok(frames<120,`${name}: failed to cross building`);
    const wall=player([b.x+b.w/2+2,0,b.z]);wall.character.yaw=Math.PI/2;
    for(let i=0;i<15;i++)wall.tick(.05,{forward:1,sprint:true,dash:i===0});
    assert.ok(wall.character.position[0]>=b.x+b.w/2+.65,'dash crossed side wall');
  }
});

test('jumping under a lintel or from furniture stops at the ceiling and lands',()=>{
  const b=rooms.find(b=>b.interior.furniture.some(f=>f.kind==='cabinet'));
  const cabinet=b.interior.furniture.find(f=>f.kind==='cabinet');
  const top=cabinet.center[1]+cabinet.size[1]/2;
  for(const [position,ceiling,floor]of [
    [[b.x,0,b.z+b.d/2],data.world.interiors.doorHeight-2.1,0],
    [[b.x+cabinet.center[0],top,b.z+cabinet.center[2]],data.world.interiors.height-2.1,top]
  ]){
    const sim=player(position);let highest=position[1];
    for(let i=0;i<100;i++){sim.tick(.025,{jump:i===0});highest=Math.max(highest,sim.character.position[1]);}
    assert.ok(highest<=ceiling+1e-7);assert.ok(highest>floor+.5);
    near(sim.character.position[1],floor);assert.ok(sim.grounded);
  }
});

test('exact torso sightlines pass through doors and stop at walls and counters',()=>{
  for(const b of rooms){
    assert.ok(world.lineOfSight([b.x,0,b.z-b.d/2-1],[b.x,0,b.z+b.d/2+1]));
    assert.equal(world.lineOfSight([b.x,0,b.z],[b.x+b.w/2+1,0,b.z]),false);
    assert.equal(world.lineOfSight([b.x+6,0,b.z-b.d/2-1],[b.x+6,0,b.z+b.d/2+1]),false);
    const wallX=b.x+b.w/2-.4;
    assert.equal(world.lineOfSight([wallX-.01,0,b.z],[wallX+.01,0,b.z+.01]),false,'short ray entirely inside a wall');
  }
  const closed=world.buildings.find(b=>!b.interior);
  assert.equal(world.lineOfSight([closed.x,0,closed.z-closed.d/2-1],[closed.x,0,closed.z+closed.d/2+1]),false);
});

test('discovery reveals a bounded neighborhood and retains already visited streets',()=>{
  const map=new World(data.world);map.reveal([0,0,0]);
  assert.equal(map.discovered.size,13);assert.ok(map.isDiscovered([0,0,0]));
  assert.equal(map.isDiscovered(data.world.biomes[0].center),false);
  map.reveal(data.world.biomes[0].center);
  assert.ok(map.isDiscovered([0,0,0]));assert.ok(map.isDiscovered(data.world.biomes[0].center));
  const size=map.discovered.size;map.reveal(data.world.biomes[0].center);assert.equal(map.discovered.size,size);
});

test('new primitives have outward winding and finite unit normals',()=>{
  for(const shape of [box,bevelBox,ellipsoid]){
    const vertices=[];shape(vertices,[0,0,0],[1,2,3],'#abcdef');
    assert.ok(vertices.every(Number.isFinite));assert.equal(vertices.length%30,0);
    for(let i=0;i<vertices.length;i+=30){
      const a=vertices.slice(i,i+3),b=vertices.slice(i+10,i+13),c=vertices.slice(i+20,i+23);
      const u=b.map((v,j)=>v-a[j]),v=c.map((v,j)=>v-a[j]);
      const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
      assert.ok(n.reduce((sum,x,j)=>sum+x*(a[j]+b[j]+c[j]),0)>0);
    }
    for(let i=0;i<vertices.length;i+=10)near(Math.hypot(...vertices.slice(i+3,i+6)),1);
    const rotated=[];transformMesh(rotated,vertices,[4,5,6],.8,.4,.2);
    for(let i=0;i<rotated.length;i+=10)near(Math.hypot(...rotated.slice(i+3,i+6)),1);
  }
});

test('runner plants feet, bends knees, counter-swings arms, and has an airborne pose',()=>{
  const pose=motionPose(17,Math.PI/2,true,0,0);
  assert.ok(pose.leftFoot.position[2]>.3);assert.ok(pose.rightFoot.position[2]<-.3);
  near(pose.leftFoot.position[1],.12);near(pose.rightFoot.position[1],.12);
  assert.ok(pose.leftArm.pitch>pose.rightArm.pitch);
  assert.ok(pose.leftShin.pitch>pose.leftThigh.pitch);
  const jump=motionPose(17,Math.PI/2,false,8,0);
  assert.notDeepEqual(jump.leftFoot,pose.leftFoot);
  const meshes=new CharacterMeshes(models);
  for(const race of data.races){
    const high=[],low=[],actor={model:'humanoid',race:race.id,position:[0,0,0],color:race.color};
    meshes.draw(high,actor,pose,true);meshes.draw(low,actor,pose,false);
    assert.ok(high.length>low.length*3);assert.ok(high.every(Number.isFinite));
  }
});

test('motion blends to idle, resets on teleport, and expires absent actors',()=>{
  const meshes=new CharacterMeshes(models),actor={id:'runner',model:'humanoid',position:[0,0,0],velocity:[0,0,17]};
  for(let i=0;i<120;i++)meshes.pose(actor,i/60);
  assert.ok(meshes.motion.get('humanoid:runner').speed>16);
  actor.velocity=[0,0,0];for(let i=120;i<240;i++)meshes.pose(actor,i/60);
  assert.ok(meshes.motion.get('humanoid:runner').speed<.01);
  actor.position=[100,0,100];meshes.pose(actor,4);near(meshes.motion.get('humanoid:runner').phase,0);
  meshes.prune(10);assert.equal(meshes.motion.size,0);
});

test('renderer streams and releases interior detail, scales quality, and pauses on context loss',()=>{
  const uniforms=new Map();let calls=0,deleted=0,depthWrite=true;
  const gl=new Proxy({
    createBuffer:()=>({}),createShader:()=>({}),createProgram:()=>({}),
    getShaderParameter:()=>true,getProgramParameter:()=>true,getShaderPrecisionFormat:()=>({precision:23}),
    getParameter:()=>16,
    getAttribLocation:(_,name)=>['aPosition','aNormal','aColor','aGlow','aLight','aTint'].indexOf(name),getUniformLocation:(_,name)=>name,
    uniform1f:(name,value)=>uniforms.set(name,value),
    uniform4fv:(name,value)=>{assert.ok([...value].every(Number.isFinite));uniforms.set(name,[...value]);},
    bufferData:(_,array)=>{assert.ok(array instanceof Float32Array);assert.ok(array.every(Number.isFinite));},
    drawArrays:(_,__,count)=>{assert.ok(Number.isInteger(count)&&count>=0);calls++;},
    deleteBuffer:()=>deleted++,depthMask:value=>{depthWrite=value;}
  },{get:(object,key)=>key in object?object[key]:(()=>{})});
  const previousRatio=globalThis.devicePixelRatio;globalThis.devicePixelRatio=1;
  try{
    const canvas={getContext:()=>gl,addEventListener(){},clientWidth:960,clientHeight:540};
    const life=new CityLife(world,data.citylife),renderer=new Renderer(canvas,world,models,life),camera={eye:[0,3,40],target:[0,2,0]},epoch=Date.UTC(2026,0,1,12);
    const residents=life.update(epoch,[0,0,32],{completed:data.citylife.neighborhoods.flatMap(n=>n.stages.slice(1).map(s=>s.quest))});
    assert.ok(residents.length>8);
    renderer.render(camera,residents,[],10,epoch);
    assert.ok(renderer.details.size>0&&renderer.details.size<40);assert.ok(calls>0);assert.ok(depthWrite);
    assert.equal(renderer.lightLimit,2,'fit fixture lighting within the WebGL 1 minimum uniform budget');
    assert.equal(uniforms.get('uLightPosition').length,8);
    assert.ok(uniforms.get('uLightPosition').some((v,i)=>i%4===3&&v>0),'nearby fixtures illuminate the Commons');
    renderer.quality=.5;renderer.reducedMotion=true;
    renderer.render(camera,residents,[],11,Date.UTC(2026,0,1,0));
    assert.equal(uniforms.get('uDay'),0);assert.equal(uniforms.get('uTime'),0);assert.ok(depthWrite);
    for(const height of [12,24,48])for(const quality of [.5,1]){
      const block=life.streetBlocks.find(b=>b.position[1]===height),[x,y,z]=block.position;
      renderer.quality=quality;
      renderer.render({eye:[x,y+2,z],target:[x,y+1,z-6]},life.update(epoch,block.position,{quality}),[],12,epoch);
      assert.ok(renderer.details.has(block),'upper street workspaces must stream on both quality settings');
      assert.ok(uniforms.get('uLightPosition').some((v,i)=>i%4===1&&Math.abs(v-y-4.35)<1e-4),'upper street fixtures must illuminate their own deck');
      assert.ok(depthWrite);
    }
    renderer.quality=.5;
    for(const b of world.rooftops){
      const y=b.levels.at(-2),inside={eye:[b.x,y+2,b.z],target:[b.x,y+1,b.z-6]};
      renderer.render(inside,[],[],12,epoch);
      assert.ok(renderer.details.has(b),'stairs must stream at the top floor');
      near(uniforms.get('uRoomHeight'),b.h);
      renderer.render({eye:[b.x,b.h+3,b.z],target:[b.x,b.h+1,b.z-6]},life.update(epoch,[b.x,b.h,b.z],{quality:.5}),[],13,Date.UTC(2026,0,1,0));
      assert.ok(renderer.details.has(b),'roof access must remain visible on low quality');
      assert.equal(uniforms.get('uRoomHeight'),0,'rooftops must receive outdoor lighting');
      assert.ok(depthWrite);
      const e=world.elevators.find(e=>e.id===`elevator-${b.id}`);
      if(e){
        const from=[...e.position],to=[e.position[0],b.h,e.position[2]],ride={id:e.id,from,to,started:0,duration:rideDuration(from,to)};
        for(const time of [0,ride.duration/2,ride.duration]){
          const p=ridePosition(ride,time);
          renderer.render({eye:[p[0],p[1]+1.8,p[2]],target:[p[0],p[1]+1.8,p[2]+8]},[],[],time,epoch,[],time,null,null,ride);
          assert.ok(depthWrite,'ride rendering must restore depth writes');
        }
      }
    }
    const residentBuffers=renderer.details.size,previouslyDeleted=deleted;
    renderer.render({eye:[0,3,2700],target:[0,2,2600]},[],[],20);
    assert.equal(canvas.width,480);assert.equal(canvas.height,270);
    assert.equal(renderer.details.size,0);assert.equal(deleted-previouslyDeleted,residentBuffers);
    assert.ok(uniforms.get('uLightPosition').every(v=>v===0),'leaving the city clears stale fixture lights');
    assert.equal(uniforms.get('uTime'),0);assert.equal(uniforms.get('uVolume'),.4);
    renderer.lost=true;const draws=calls;renderer.render(camera,[],[],21);assert.equal(calls,draws);
  }finally{if(previousRatio===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=previousRatio;}
});
