// Integration and behavioral regressions; all fixtures stay in memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { World } from '../client/src/world.js';
import { Simulation, createCharacter, availableQuest, stats, rollAttack, experienceFor } from '../client/src/simulation.js';
import { random, distance, lookAt, perspective, multiply, project } from '../client/src/math.js';
import { box, biomeGeometry, Renderer } from '../client/src/renderer.js';
import { decodeLocal, encodeLocal } from '../client/src/persistence.js';

const names=['world','rules','races','factions','quests','talents','abilities','enemies','npcs','intro','audio'];
const values=await Promise.all(names.map(name=>readFile(new URL(`../client/data/${name}.json`,import.meta.url),'utf8').then(JSON.parse)));
const data=Object.fromEntries(names.map((name,i)=>[name,values[i]]));const world=new World(data.world);
const make=(race='human',faction='relay')=>new Simulation(data,world,createCharacter('Test runner',race,faction,data),()=>{},()=>.5);

test('world contains a large deterministic city with unobstructed roads, NPCs, lifts and objectives',()=>{
  assert.equal(world.buildings.length,725);assert.deepEqual(world.buildings,new World(data.world).buildings);
  assert.equal(Math.floor(random(87421)()*4294967296),499456184);
  for(const p of [data.world.spawn,...data.npcs.map(n=>n.position),...data.world.landmarks.map(l=>l.position),...data.world.lifts.map(l=>l.position),...data.world.enemySpawns.map(s=>s.position)])assert.equal(world.collides(...p),false,`Blocked map entity at ${p}`);
  const b=world.buildings[0];assert.ok(world.collides(b.x,0,b.z));assert.ok(!world.collides(b.x,b.h+1,b.z));assert.ok(world.collides(data.world.bounds+1,0,0));
  assert.equal(world.floorAt(b.x,b.z,b.h+1,b.h-.5),b.h,'Roof landing must not trap a character inside a tower');
  assert.equal(world.floorAt(0,-80,25,23),24);assert.equal(world.floorAt(0,-80,10,9),0);assert.equal(world.floorAt(0,0,25,23),0);
});
test('all 188 quests have unique prose, valid references, and continuous gated arcs',()=>{
  const quests=data.quests,ids=new Set(quests.map(q=>q.id));assert.equal(quests.length,188);assert.equal(ids.size,quests.length);assert.equal(new Set(quests.map(q=>q.title)).size,quests.length);
  assert.equal(new Set(quests.map(q=>q.briefing)).size,quests.length);assert.equal(new Set(quests.map(q=>q.completion)).size,quests.length);
  for(const q of quests){assert.ok(q.briefing.length>90);assert.ok(q.completion.length>30);assert.ok(q.level>=0&&q.level<=60);assert.ok(data.npcs.some(n=>n.id===q.giver));assert.ok(q.requires.every(id=>ids.has(id)));assert.ok(q.objective.count>0);assert.ok(q.reward.xp>0);assert.ok(q.reward.credits>=0);const targets=q.objective.type==='kill'?data.enemies:data.world.landmarks;assert.ok(targets.some(t=>t.id===q.objective.target),q.id);}
  for(const [key,groups,count,step]of[['faction',data.factions,31,2],['race',data.races,13,5]])for(const group of groups){const arc=quests.filter(q=>q[key]===group.id).sort((a,b)=>a.level-b.level);assert.equal(arc.length,count);for(let i=0;i<arc.length;i++){assert.equal(arc[i].level,i*step);assert.deepEqual(arc[i].requires,i?[arc[i-1].id]:[]);}}
});
test('nature biomes have distinct scenery, open routes, reachable contacts and appropriately placed objectives',()=>{
  assert.equal(data.world.biomes.length,4);
  assert.equal(new Set(data.world.biomes.map(b=>b.id)).size,4);
  assert.equal(new Set(data.world.biomes.map(b=>b.kind)).size,4);
  const meshes=[];
  for(const b of data.world.biomes){
    assert.ok(b.center.every(Number.isFinite)&&b.radius>0);
    assert.ok(Math.max(Math.abs(b.center[0]),Math.abs(b.center[2]))-b.radius>data.world.cityRadius);
    assert.ok(Math.max(Math.abs(b.center[0]),Math.abs(b.center[2]))+b.radius<data.world.bounds);
    assert.equal(world.district(b.center).id,b.id);
    assert.equal(world.biomeAt([b.center[0]+b.radius+1,0,b.center[2]]),undefined);
    const npc=data.npcs.find(n=>n.biome===b.id),quests=data.quests.filter(q=>q.biome===b.id);
    assert.ok(npc);assert.equal(world.district(npc.position).id,b.id);assert.equal(quests.length,3);
    for(const q of quests){
      assert.equal(q.giver,npc.id);assert.equal(q.faction,null);assert.equal(q.race,null);
      const destination=data.world.landmarks.find(l=>l.id===q.objective.target);assert.ok(destination);
      assert.equal(world.district(destination.position).id,b.id);assert.ok(q.level>=b.minLevel);
      assert.ok(world.lineOfSight(npc.position,destination.position));
      assert.ok(data.world.enemySpawns.every(e=>distance(e.position,npc.position)>data.rules.combat.aggroRadius));
    }
    // Each axial path from the city edge to the field contact stays walkable.
    const start=Math.abs(b.center[0])>Math.abs(b.center[2])?[Math.sign(b.center[0])*data.world.cityRadius,0,b.center[2]]:[b.center[0],0,Math.sign(b.center[2])*data.world.cityRadius];
    for(let i=0;i<=100;i++){const p=start.map((v,k)=>v+(npc.position[k]-v)*i/100);assert.equal(world.collides(...p),false);assert.equal(world.floorAt(p[0],p[2],1,-1),0);}
    const mesh=biomeGeometry(b);assert.deepEqual(mesh,biomeGeometry(b));assert.ok(mesh.every(Number.isFinite));assert.equal(mesh.length%30,0);assert.ok(mesh.length>1440&&mesh.length<500000);
    // The ground disc stays level; foliage leaves both 24 m crossing paths clear.
    for(let i=0;i<mesh.length;i+=10){assert.ok(Math.hypot(mesh[i]-b.center[0],mesh[i+2]-b.center[2])<=b.radius+.001);if(i>=1440){assert.ok(Math.abs(mesh[i]-b.center[0])>12);assert.ok(Math.abs(mesh[i+2]-b.center[2])>12);}}
    meshes.push(mesh.length);
  }
  assert.equal(new Set(meshes).size,4);
  assert.equal(world.district([0,0,0]).id,'market');assert.equal(world.district([320,24,320]).id,'skybridge');assert.equal(world.district([2800,0,2800]).id,'basin');
  for(const q of data.quests.filter(q=>q.objective.type!=='kill')){const target=data.world.landmarks.find(l=>l.id===q.objective.target),biome=world.biomeAt(target.position);if(biome)assert.ok(q.level>=biome.minLevel,`${q.id} sends an under-level runner to ${biome.id}`);}
});
test('every lineage and faction can complete the basin chains with spatial checks, gates, and persisted one-time rewards',()=>{
  for(const race of data.races)for(const faction of data.factions){
    let sim=make(race.id,faction.id);sim.enemies=[];
    for(const b of data.world.biomes){
      const arc=data.quests.filter(q=>q.biome===b.id),npc=data.npcs.find(n=>n.id===arc[0].giver);
      sim.character.level=arc[0].level-1;sim.character.position=[...npc.position];
      assert.equal(sim.action({type:'quest',id:arc[0].id,operation:'accept'}),false);
      sim.character.level=60;
      assert.equal(sim.action({type:'quest',id:arc[1].id,operation:'accept'}),false);
      for(const q of arc){
        const c=sim.character;c.position=[...data.world.spawn];assert.equal(sim.action({type:'quest',id:q.id,operation:'accept'}),false);
        c.position=[...npc.position];assert.ok(sim.action({type:'quest',id:q.id,operation:'accept'}));assert.equal(sim.action({type:'quest',id:q.id,operation:'complete'}),false);
        sim.time+=1.1;assert.equal(sim.action({type:'interact',id:q.objective.target}),false);
        c.position=[...data.world.landmarks.find(l=>l.id===q.objective.target).position];
        if(q.objective.type==='explore')sim.tick(.05);else assert.ok(sim.action({type:'interact',id:q.objective.target}));
        assert.equal(c.activeQuests[q.id],q.objective.count);assert.equal(sim.action({type:'quest',id:q.id,operation:'complete'}),false);
        c.position=[...npc.position];const before=c.credits;assert.ok(sim.action({type:'quest',id:q.id,operation:'complete'}));assert.equal(c.credits,before+q.reward.credits);
        sim=new Simulation(data,world,decodeLocal(encodeLocal([c]))[0]);sim.enemies=[];
        assert.equal(availableQuest(q,sim.character),false);assert.equal(sim.action({type:'quest',id:q.id,operation:'complete'}),false);assert.equal(sim.character.credits,before+q.reward.credits);
      }
    }
    assert.equal(sim.character.completed.length,12);
  }
});
test('each faction campaign reaches 60 through real acceptance, objective and reward logic without grinding',()=>{
  for(const faction of data.factions){
    const sim=make('human',faction.id),c=sim.character;sim.enemies=[];
    for(const q of data.quests.filter(q=>q.faction===faction.id).sort((a,b)=>a.level-b.level)){
      assert.ok(c.level>=q.level,`${faction.id} stalled before ${q.title}`);const npc=data.npcs.find(n=>n.id===q.giver);c.position=[...npc.position];
      assert.ok(sim.action({type:'quest',id:q.id,operation:'accept'}));assert.equal(sim.action({type:'quest',id:q.id,operation:'accept'}),false);
      if(q.objective.type==='kill'){for(let i=0;i<q.objective.count;i++)sim.progress('kill',q.objective.target);}
      else{c.position=[...data.world.landmarks.find(l=>l.id===q.objective.target).position];for(let i=0;i<q.objective.count;i++){sim.time+=1.01;if(q.objective.type==='interact')assert.ok(sim.action({type:'interact',id:q.objective.target}));else sim.tick(.05);}}
      assert.equal(c.activeQuests[q.id],q.objective.count);c.position=[...npc.position];assert.ok(sim.action({type:'quest',id:q.id,operation:'complete'}));
      const earned=c.credits;assert.equal(sim.action({type:'quest',id:q.id,operation:'complete'}),false);assert.equal(c.credits,earned,'Reward replay');
    }
    assert.equal(c.level,60);assert.equal(c.completed.length,31);assert.equal(c.xp,0);
  }
});
test('all sixteen faction / lineage combinations have two accessible starts and distinct racial stats',()=>{
  for(const race of data.races)for(const faction of data.factions){const sim=make(race.id,faction.id);assert.equal(data.quests.filter(q=>availableQuest(q,sim.character)).length,2);}
  assert.equal(make().playerStats.health,140);assert.equal(make('lattice').playerStats.energy,120);assert.equal(make('revenant').playerStats.crit,15);assert.equal(make('bloom').playerStats.speed,1.08);
});
test('movement accelerates, normalizes diagonals, jumps, lands and dash obeys cooldown',()=>{
  const run=input=>{const s=make();s.enemies=[];s.character.position=[0,0,300];for(let i=0;i<20;i++)s.tick(.05,{...input,yaw:0});return s;};
  const straight=run({forward:1}),diagonal=run({forward:1,strafe:1});assert.ok(Math.abs(distance(straight.character.position,[0,0,300])-distance(diagonal.character.position,[0,0,300]))<.7);
  assert.ok(distance(run({forward:1,sprint:true}).character.position,[0,0,300])>distance(straight.character.position,[0,0,300]));
  const s=make();s.enemies=[];s.tick(.05,{jump:true});assert.ok(s.character.position[1]>0);for(let i=0;i<60;i++)s.tick(.05);assert.equal(s.character.position[1],0);
  s.tick(.05,{dash:true});const ready=s.dashReady;s.tick(.05,{dash:true});assert.equal(s.dashReady,ready);
  s.character.position=[0,0,-80];assert.ok(s.action({type:'lift',id:'commons-lift'}));assert.equal(s.character.position[1],24);s.tick(.05);assert.equal(s.character.position[1],24);
});
test('combat validates target range, rolls, cooldowns, resource use, damage, death, and recovery',()=>{
  const s=make();const e=s.enemies[0];const start=s.character.energy;
  assert.equal(s.action({type:'ability',id:'surge',target:e.id}),false);assert.equal(s.character.energy,start);
  s.character.position=[e.position[0],0,e.position[2]-10];assert.ok(s.action({type:'ability',id:'surge',target:e.id}));assert.ok(e.health<e.maxHealth);assert.ok(e.stunUntil>s.time);assert.equal(s.character.energy,start-22);
  const hp=e.health;assert.equal(s.action({type:'ability',id:'arc',target:e.id}),false);assert.equal(e.health,hp);
  s.time+=1;s.action({type:'ability',id:'arc',target:e.id});s.time+=1;s.action({type:'ability',id:'arc',target:e.id});assert.equal(e.health,0);assert.ok(s.character.xp>0);assert.ok(e.respawnAt>s.time);
  assert.equal(rollAttack(()=>0,0,0,100,12,data.rules).damage,0);assert.equal(rollAttack(()=>.99,0,0,100,12,data.rules).critical,true);assert.equal(rollAttack(()=>.5,0,0,100,12,data.rules).damage,84);
  s.character.health=0;s.deadAt=s.time;assert.equal(s.action({type:'respawn'}),false);s.time+=5;assert.ok(s.action({type:'respawn'}));assert.deepEqual(s.character.position,data.world.spawn);assert.equal(s.character.health,s.playerStats.health);
});
test('healing, shields, inventory and talents cannot duplicate resources',()=>{
  const s=make();s.character.health=30;s.action({type:'ability',id:'mend'});assert.equal(s.character.health,78);s.time+=1;s.action({type:'ability',id:'aegis'});assert.equal(s.shield,65);
  s.character.position=[18,0,0];const credits=s.character.credits;s.action({type:'buy',item:'medkit'});assert.equal(s.character.credits,credits-18);assert.equal(s.character.medkits,4);
  s.action({type:'medkit'});const kits=s.character.medkits;s.action({type:'medkit'});assert.equal(s.character.medkits,kits);
  assert.equal(s.action({type:'talent',id:'plating'}),false);s.character.level=5;assert.ok(s.action({type:'talent',id:'plating'}));assert.equal(s.action({type:'talent',id:'capacitor'}),false);assert.equal(stats(s.character,data).health,230);
  const prior=s.character.credits;assert.equal(s.action({type:'buy',item:'forged-item'}),false);assert.equal(s.character.credits,prior);
});
test('online prediction cannot grant XP, apply damage, regenerate energy or advance objectives',()=>{
  const s=make();s.character.health=55;s.character.energy=10;const before=JSON.stringify({health:s.character.health,energy:s.character.energy,xp:s.character.xp,completed:s.character.completed});
  for(let i=0;i<200;i++)s.tick(.05,{forward:1},true);
  assert.equal(JSON.stringify({health:s.character.health,energy:s.character.energy,xp:s.character.xp,completed:s.character.completed}),before);
});
test('level gating, spatial validation and anti-replay hold even with forged local actions',()=>{
  const s=make();const q=data.quests.find(q=>q.id==='relay-00');
  assert.equal(s.action({type:'quest',id:q.id,operation:'accept'}),false);s.character.position=[-11,0,10];assert.ok(s.action({type:'quest',id:q.id,operation:'accept'}));
  assert.equal(s.action({type:'quest',id:q.id,operation:'complete'}),false);assert.equal(s.action({type:'quest',id:'relay-30',operation:'accept'}),false);
  assert.equal(s.action({type:'ability',id:'lance',target:'enemy-0'}),false);
  assert.throws(()=>createCharacter('<script>','human','relay',data));assert.throws(()=>createCharacter('Valid','injected','relay',data));
  assert.equal(experienceFor(60,data.rules),2180);
});
test('intro is a complete, contiguous, finite 38-second cinematic with original score',()=>{
  assert.equal(data.intro.duration,38);let end=0;for(const shot of data.intro.shots){assert.equal(shot.start,end);assert.ok(shot.end>shot.start);for(const k of ['from','to','lookFrom','lookTo'])assert.ok(shot[k].length===3&&shot[k].every(Number.isFinite));assert.ok(shot.caption.length>20);end=shot.end;}assert.equal(end,data.intro.duration);assert.equal(data.audio.chords.length,4);
});
test('mesh faces have outward normals and camera projection centers its target',()=>{
  const vertices=[];box(vertices,[0,0,0],[2,2,2],'#ffffff');assert.equal(vertices.length,360);
  for(let f=0;f<6;f++){const offset=f*60;const a=vertices.slice(offset,offset+3),b=vertices.slice(offset+10,offset+13),c=vertices.slice(offset+20,offset+23),n=vertices.slice(offset+3,offset+6);const u=b.map((v,i)=>v-a[i]),v=c.map((val,i)=>val-a[i]);const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];assert.ok(cross.reduce((sum,val,i)=>sum+val*n[i],0)>0);}
  const matrix=multiply(perspective(1,1,.1,1000),lookAt([10,10,10],[0,0,0]));const p=project([0,0,0],matrix,100,100);assert.ok(Math.abs(p[0]-50)<.001&&Math.abs(p[1]-50)<.001);
});
test('the entire original city assembles into finite triangle chunks without an asset download',()=>{
  let vertices=0,chunks=0;const mesh={world,upload(values,center,radius){assert.equal(values.length%30,0);assert.ok(values.every(Number.isFinite));assert.ok(center.every(Number.isFinite));assert.ok(radius>0);vertices+=values.length/10;chunks++;}};
  Renderer.prototype.build.call(mesh);assert.ok(chunks>70);assert.ok(vertices>100000);assert.ok(vertices<2000000);
});
