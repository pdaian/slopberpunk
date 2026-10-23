// Buildless regression checks; no browser profile, database, or output files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, routeHeight } from '../src/world.js';
import { CityLife, CITY_ACTIVITIES, cityStage, cityEvent, createRoutine, routineAt, validateCityLife } from '../src/citylife.js';
import { availableQuest } from '../src/prediction.js';
import { CharacterMeshes, activityPose, motionPose } from '../src/character.js';
import { neighborhoodDetails, civilianProps, streetScene } from '../src/scenery.js';
import { distance } from '../src/math.js';

const read = name => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url)));
const data = Object.fromEntries(['world', 'citylife', 'npcs', 'quests', 'races', 'factions', 'manifest'].map(n => [n, read(n)]));
const world = new World(data.world), epoch = Date.UTC(2026, 9, 21, 12);
const create = () => new CityLife(world, data.citylife);
const near = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const atActivity = (resident, activity, hour = 12) => {
  const start = Date.UTC(2026, 9, 21, hour) / 1000, segment = resident.routine.segments.find(s => s.activity === activity);
  assert.ok(segment, `Missing ${activity} for ${resident.id}`);
  return (start + ((segment.start + 1 - start - resident.seed) % resident.routine.duration + resident.routine.duration) % resident.routine.duration) * 1000;
};

test('neighborhood records, contacts, sites, and contracts form five valid chains', () => {
  assert.equal(data.manifest.files.citylife, 1);
  validateCityLife(data.citylife, data, world);
  assert.equal(data.quests.length, 203);
  assert.equal(data.quests.filter(q => q.neighborhood).length, 15);
  assert.equal(data.quests.filter(q => q.faction || q.race).length, 176);
  assert.equal(data.quests.filter(q => q.biome).length, 12);
  for (const records of [data.npcs, data.world.landmarks, data.quests]) assert.equal(new Set(records.map(r => r.id)).size, records.length);
  for (const n of data.citylife.neighborhoods) {
    const quests = data.quests.filter(q => q.neighborhood === n.id), contact = data.npcs.find(p => p.id === n.contact);
    assert.equal(quests.length, 3);
    assert.ok(!world.collides(...contact.position));
    near(world.floorAt(contact.position[0], contact.position[2], contact.position[1] + .1, contact.position[1] - .2), contact.position[1]);
    for (const race of data.races) for (const faction of data.factions) {
      const c = { level: quests[0].level, race: race.id, faction: faction.id, activeQuests: {}, completed: [] };
      for (const [index, q] of quests.entries()) {
        assert.equal(availableQuest(q, c), true);
        assert.equal(availableQuest(q, { ...c, level: q.level - 1 }), false);
        if (index < 2) assert.equal(availableQuest(quests[index + 1], c), false);
        c.activeQuests[q.id] = 0;assert.equal(availableQuest(q, c), false);
        delete c.activeQuests[q.id];c.completed.push(q.id);
        assert.equal(availableQuest(q, c), false, 'completed contracts cannot award again');
        assert.equal(cityStage(n, c.completed), n.stages[index + 1]);
      }
    }
  }
});

test('invalid content fails before starting the scene', () => {
  for (const mutate of [
    c => c.neighborhoods.push(c.neighborhoods[0]),
    c => c.neighborhoods[0].stages[1].quest = 'missing',
    c => c.neighborhoods[0].sites[0] = 'missing',
    c => c.neighborhoods[0].residents[0].role = 'missing',
    c => c.neighborhoods[0].events[0].activity = 'missing',
    c => c.roles.cook.nightActivity = 'missing'
  ]) {
    const content = structuredClone(data.citylife);mutate(content);
    assert.throws(() => validateCityLife(content, data, world), /Invalid city life/);
  }
});

test('all authored and generated routes clear walls, furniture, and skyway edges', () => {
  const life = create(), residents = [...life.locals, ...life.travellers, ...world.buildings.flatMap(b => life.blockResidents(b))];
  assert.equal(life.locals.length, 36);
  assert.equal(new Set(residents.map(r => r.id)).size, residents.length);
  let samples = 0;
  for (const resident of residents) for (const routine of [resident.routine,...resident.scenes||[]]) for (const segment of routine.segments) {
    const count = Math.max(1, Math.ceil(distance(segment.from, segment.to) / .5));
    for (let i = 0; i <= count; i++) {
      const p = segment.from.map((n, j) => n + (segment.to[j] - n) * i / count);
      if(segment.route)p[1]=routeHeight(segment.route,p[0],p[2])??p[1];
      assert.equal(world.collides(...p, .55), false, `Blocked route: ${resident.id} at ${p}`);
      near(world.floorAt(p[0], p[2], p[1] + .1, p[1] - .2), p[1]);samples++;
    }
  }
  assert.ok(samples > 600000);
});

test('upper floors stay populated and street scenes return continuously to their meeting point',()=>{
  const life=create(),b=world.buildings.find(b=>b.interior),h=data.world.interiors.height;
  const actors=life.update(epoch,[b.x,h*2,b.z]);
  assert.ok(actors.some(a=>a.position[1]===h*2&&a.building?.address===b.identity.address));
  assert.ok(life.blockResidents(b).some(r=>r.routine.segments.some(s=>s.route)));
  for(const resident of life.locals.filter(r=>r.scenes))for(const scene of resident.scenes){
    near(scene.duration,180);
    assert.ok(distance(routineAt(scene,179.999).position,routineAt(scene,0).position)<.01);
    assert.ok(scene.segments.some(s=>s.activity==='scene'));
  }
});

test('street hosts, rooftop neighbors and couriers populate every destination by day and night on both quality settings',()=>{
  const life=create();
  for(const b of world.rooftops){
    const residents=life.blockResidents(b),courier=residents.find(r=>r.id===`roof-courier-${b.id}`);
    assert.ok(courier);
    assert.equal(new Set(courier.routine.segments.filter(s=>s.route).map(s=>s.route)).size,b.routes.length);
    near(courier.routine.segments[0].from[1],0);
    assert.ok(courier.routine.segments.some(s=>s.from[1]===b.h&&s.activity==='carry'));
    assert.ok(distance(routineAt(courier.routine,courier.routine.duration-.001).position,routineAt(courier.routine,0).position)<.01);
    for(const now of [epoch,epoch+12*3600000])for(const quality of [.5,1]){
      const roofActors=life.update(now,[b.x,b.h,b.z],{quality});
      assert.ok(roofActors.some(a=>a.id===`roof-host-${b.id}`&&a.position[1]===b.h));
      assert.ok(roofActors.some(a=>a.id===`roof-neighbor-${b.id}`&&a.position[1]===b.h));
      assert.ok(roofActors.length<=(quality===.5?30:64));
      const streetActors=life.update(now,[b.x,0,b.z+b.d/2+4],{quality});
      const host=streetActors.find(a=>a.id===`street-host-${b.id}`);
      assert.ok(host&&host.position[1]===0);
      assert.ok(life.conversation(host,now).personal.includes(b.rooftop.line));
    }
  }
});

test('every street scene has visible props, bounded effects, and a stable reduced-motion pose',()=>{
  for(const n of data.citylife.neighborhoods)for(let i=0;i<n.events.length;i++)for(const quality of [.5,1]){
    const now=epoch+i*180000,index=n.events.indexOf(cityEvent(n,now)),site=data.world.landmarks.find(l=>l.id===n.sites[index]);
    const v=[],mist=[];streetScene(v,mist,n,data.world,now,10,false,quality,site.position);
    assert.ok(v.length>0&&v.every(Number.isFinite)&&mist.every(Number.isFinite));
    assert.ok(v.length+mist.length<25000,'street scene exceeds its small geometry budget');
    const still=(time)=>{const v=[],mist=[];streetScene(v,mist,n,data.world,now,time,true,quality,site.position);return[v,mist];};
    assert.deepEqual(still(10),still(20),'reduced motion must stop local animation');
  }
});

test('routines pause at a destination, walk at a fixed speed, and loop continuously', () => {
  const routine = createRoutine([{ position: [0, 0, 0], activity: 'repair', seconds: 10 }, { position: [10, 0, 0], activity: 'eat', seconds: 5 }], 2);
  assert.equal(routine.duration, 25);
  assert.equal(routineAt(routine, 4).activity, 'repair');
  assert.deepEqual(routineAt(routine, 4).velocity, [0, 0, 0]);
  near(routineAt(routine, 12).position[0], 4);
  assert.equal(routineAt(routine, 16).activity, 'eat');
  assert.deepEqual(routineAt(routine, -1), routineAt(routine, 24));
  for (const s of routine.segments) assert.ok(distance(routineAt(routine, s.end - .001).position, routineAt(routine, s.end + .001).position) < .005);
});

test('UTC routines and street events agree across clients and frame rates', () => {
  const a = create(), b = create(), origin = [0, 0, 32];
  a.update(epoch, origin);
  for (let i = 1; i <= 120; i++) a.update(epoch + i * 1000 / 60, origin);
  const first = a.update(epoch + 2000, origin), second = b.update(epoch + 2000, origin);
  assert.deepEqual(first.map(r => [r.id, r.position, r.activity]), second.map(r => [r.id, r.position, r.activity]));
  for (const n of data.citylife.neighborhoods) {
    assert.equal(cityEvent(n, epoch), cityEvent(n, epoch + n.events.length * 180000));
    assert.notEqual(cityEvent(n, epoch), cityEvent(n, epoch + 180000));
  }
});

test('shops have attendants and customers; night shifts change the work being done', () => {
  const b = world.buildings.find(b => b.interior?.name === 'COIL REPAIR'), life = create();
  const residents = life.blockResidents(b), attendant = residents.find(r => r.role === 'technician');
  assert.ok(residents.some(r => r.role === 'customer'));
  const day = create().update(atActivity(attendant, 'duty', 12), [b.x, 0, b.z]).find(r => r.id === attendant.id);
  const night = create().update(atActivity(attendant, 'duty', 1), [b.x, 0, b.z]).find(r => r.id === attendant.id);
  assert.equal(day.activity, 'repair');assert.equal(night.activity, 'work');
  assert.equal(world.interiorAt(day.position), b);assert.equal(world.interiorAt(night.position), b);
  assert.notEqual(day.title, night.title);
});

test('saved quest completions change civilian dialogue and street activity', () => {
  const life = create(), n = data.citylife.neighborhoods[0], resident = life.locals[1], time = atActivity(resident, 'story');
  const initial = life.update(time, [0, 0, 0]).find(a => a.id === resident.id);
  assert.equal(initial.activity, 'wait');assert.equal(initial.line, n.stages[0].line);
  const completed = n.stages.slice(1).map(s => s.quest);
  const resumed = create(), after = resumed.update(time, [0, 0, 0], { completed }).find(a => a.id === resident.id);
  assert.equal(after.activity, 'serve');assert.equal(after.line, n.stages[3].line);
  assert.equal(resumed.conversation(after, time).stage, n.stages[3]);
  assert.deepEqual(completed, n.stages.slice(1).map(s => s.quest), 'presentation must not mutate saved progress');
});

test('visible danger interrupts routines, retreats safely, and eventually resumes them', () => {
  const life = create(), resident = life.locals[1], start = atActivity(resident, 'story');
  let actor = life.update(start, [0, 0, 0]).find(a => a.id === resident.id), previous = actor.position;
  const enemy = { health: 100, position: [actor.position[0] - 2, actor.position[1], actor.position[2]] };
  let fled = false;
  for (let i = 1; i <= 600; i++) {
    actor = life.update(start + i * 50, [0, 0, 0], { enemies: i < 21 ? [enemy] : [] }).find(a => a.id === resident.id);
    assert.ok(actor);assert.equal(world.collides(...actor.position, .55), false);
    assert.ok(distance(previous, actor.position) < .23, 'civilian teleported instead of moving');
    fled ||= actor.activity === 'flee';previous = actor.position;
  }
  assert.ok(fled);assert.notEqual(actor.activity, 'flee');
  assert.equal(life.states.get(resident.id).position, undefined);
  assert.equal(life.states.get(resident.id).trail.length, 0);
});

test('escape routes stay on elevated walkways and walls conceal threats', () => {
  const life = create(), resident = life.locals.find(r => r.neighborhood === 'skybridge'), start = atActivity(resident, 'duty');
  let actor = life.update(start, [320, 24, 320]).find(a => a.id === resident.id);
  for (let i = 1; i < 150; i++) {
    const enemy = { health: 100, position: [actor.position[0], 24, actor.position[2] - 2] };
    actor = life.update(start + i * 50, [320, 24, 320], { enemies: [enemy] }).find(a => a.id === resident.id);
    near(world.floorAt(actor.position[0], actor.position[2], 24.1, 23.8), 24);
    assert.equal(world.collides(...actor.position, .55), false);
  }
  const b = world.buildings.find(b => b.interior && Math.hypot(b.x, b.z) < 160), hidden = create();
  const p = [b.x - b.w / 2 - 2, 0, b.z];
  const observer = hidden.resident('wall-observer', 'Wall observer', 'neighbor', 'market', 1, createRoutine([{ position: p, seconds: 60 }]));
  hidden.locals = [observer];
  const enemy = { health: 100, position: [b.x - b.w / 2 + 2, 0, b.z] };
  assert.equal(world.lineOfSight(p, enemy.position), false);
  assert.notEqual(hidden.update(epoch, p, { enemies: [enemy] }).find(a => a.id === observer.id).activity, 'flee');
});

test('conversation pauses a resident and releases without a movement jump', () => {
  const life = create(), id = life.locals[1].id;
  let actor = life.update(epoch, [0, 0, 0]).find(a => a.id === id), start = actor.position;
  for (let i = 1; i <= 100; i++) {
    actor = life.update(epoch + i * 50, [0, 0, 0], { focus: id }).find(a => a.id === id);
    assert.ok(distance(start, actor.position) < 1e-5);assert.equal(actor.activity, 'talk');
  }
  actor = life.update(epoch + 35000, [0, 0, 0], { focus: id }).find(a => a.id === id);
  assert.ok(distance(start, actor.position) < 1e-5, 'a background tab must not advance a paused conversation');
  const next = life.update(epoch + 35050, [0, 0, 0]).find(a => a.id === id);
  assert.ok(distance(next.position, actor.position) < .1);
});

test('returning from cover retraces axis steps around a building corner', () => {
  const b = world.buildings.find(b => b.interior && Math.hypot(b.x, b.z) < 160);
  for (const sign of [-1, 1]) {
    const life = create(), p = [b.x - b.w / 2 - 2, 0, b.z + sign * (b.d / 2 - 1)];
    const resident = life.resident('corner-worker', 'Corner worker', 'technician', 'market', 1, createRoutine([{ position: p, seconds: 60 }]));
    life.locals = [resident];life.update(epoch, p);
    const enemy = { health: 100, position: [p[0] - 2, 0, p[2] - sign * 3] };
    let actor;
    for (let i = 1; i <= 450; i++) {
      actor = life.update(epoch + i * 50, p, { enemies: i < 41 ? [enemy] : [] }).find(a => a.id === resident.id);
      assert.equal(world.collides(...actor.position, .55), false, 'return path cut through a corner');
    }
    assert.ok(distance(actor.position, p) < 1e-5);assert.equal(life.states.get(resident.id).trail.length, 0);
  }
});

test('streaming bounds crowd density and releases old block and reaction state', () => {
  const life = create();
  for (let i = 0; i < 35; i++) {
    const origin = [-960 + i % 12 * 160, 0, -800 + Math.floor(i / 12) * 320];
    assert.ok(life.update(epoch + i * 30000, origin).length <= 64);
    assert.ok(life.blocks.size <= 25);assert.ok(life.states.size < 200);
    assert.ok(life.update(epoch + i * 30000 + 100, origin, { quality: .5 }).length <= 30);
  }
  life.update(epoch + 2000000, [0, 0, 2700]);
  assert.equal(life.actors.length, 0);assert.equal(life.states.size, 0);assert.equal(life.blocks.size, 0);
  life.clear();assert.equal(life.lastTime, null);
});

test('activity poses, held objects, and all neighborhood scenery produce finite meshes', () => {
  const models = JSON.parse(readFileSync(new URL('../assets/models.json', import.meta.url))), meshes = new CharacterMeshes(models);
  for (const activity of CITY_ACTIVITIES) {
    const pose = activityPose(motionPose(activity === 'walk' ? 2 : 0, .5), activity, 12), v = [];
    const actor = { id: activity, activity, model: 'humanoid', race: 'human', color: '#abcdef', position: [0, 0, 0] };
    meshes.draw(v, actor, pose, true);civilianProps(v, actor);
    assert.ok(v.length > 0);assert.equal(v.length % 30, 0);assert.ok(v.every(Number.isFinite));
    if (['carry', 'repair', 'work', 'serve', 'eat', 'talk', 'tend', 'flee'].includes(activity)) assert.notDeepEqual(pose.rightArm, motionPose(0, .5).rightArm);
  }
  for (const n of data.citylife.neighborhoods) {
    const v = [];neighborhoodDetails(v, n, n.sites.map(id => data.world.landmarks.find(l => l.id === id)));
    assert.ok(v.length);assert.equal(v.length % 30, 0);assert.ok(v.every(Number.isFinite));
  }
});
