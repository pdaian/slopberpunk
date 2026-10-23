// In-memory targeting checks; no generated assets or browser profiles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectTargets, targetProblem, targetBounds, visibleTargets, pickTarget, cycleTarget } from '../src/targeting.js';
import { perspective, lookAt, multiply, project } from '../src/math.js';

const data = {
  rules: { interactionRadius: 9, death: { reclaimRadius: 12 } }, abilities: [{ id: 'arc', range: 55 }], quests: [],
  npcs: [{ id: 'shared', name: 'Contact', position: [1, 0, -3] }],
  world: { landmarks: [{ id: 'record', name: 'Record', position: [0, 0, -4] }],
    lifts: [{ id: 'lift', name: 'Lift', position: [0, 0, -6], stops: [0, 24, 48] }],
    graveyards: [{ id: 'rest', name: 'Rest', position: [0, 0, 0] }] },
  dungeons: { rules: { arena: [1000, 0, 1000], recoveryPosition: [1000, 0, 1000] }, entries: [{ id: 'case', chapters: [{ evidence: [{ id: 'clue', name: 'Clue', position: [0, 0, 0] }] }] }] },
};
const enemy = (id = 'shared', position = [0, 0, -8]) => ({ id, name: 'Machine', model: 'humanoid', position, health: 50, maxHealth: 50 });
const simulation = () => ({ character: { id: 'self', health: 100, position: [0, 0, 0], completed: [], activeQuests: {} }, enemies: [enemy()], worldEvents: [], inDungeon: false, time: 10 });
const clearWorld = { lineOfSight: () => true };

test('all characters and services share one collection with distinct, stable identities', () => {
  const s = simulation(), resident = { id: 'shared', name: 'Neighbor', position: [3, 0, 0] };
  const players = [{ ...enemy('ally'), name: 'Ally' }, { ...enemy('self') }];
  const targets = collectTargets(data, s, [resident], players);
  assert.deepEqual(new Set(targets.map(t => t.kind)), new Set(['enemy', 'npc', 'resident', 'player', 'terminal', 'lift']));
  assert.equal(new Set(targets.map(t => t.key)).size, targets.length);
  assert.equal(targets.some(t => t.object.id === 'self'), false);
  s.enemies[0].health = 0;
  assert.equal(collectTargets(data, s).some(t => t.kind === 'enemy'), false);
  s.enemies.push(enemy('far', [0, 0, -81]));
  assert.equal(collectTargets(data, s).some(t => t.object.id === 'far'), false);
  s.character.health = 0;
  assert.deepEqual(collectTargets(data, s), []);
});

test('activation validates the selected target, elevation, sightlines, and fleeing residents', () => {
  const s = simulation(), target = collectTargets(data, s).find(t => t.kind === 'npc');
  assert.equal(targetProblem(target, s.character, clearWorld), null);
  assert.equal(targetProblem(target, s.character, { lineOfSight: () => false }), 'Something is blocking your view');
  s.character.position = [1, 9, -3];
  assert.equal(targetProblem(target, s.character, clearWorld), 'Move within 9 m');
  assert.equal(targetProblem(null, s.character, clearWorld), 'Select a target first');
  assert.equal(targetProblem({ ...target, action: null }, s.character, clearWorld), 'No action available');
  s.character.position = [0, 0, 0];
  const fleeing = collectTargets(data, s, [{ id: 'resident', position: [0, 0, 0], activity: 'flee' }]).find(t => t.kind === 'resident');
  assert.equal(targetProblem(fleeing, s.character, clearWorld), 'Taking cover');
  const machine = collectTargets(data, s).find(t => t.kind === 'enemy');
  s.character.position = [0, 0, 47];
  assert.equal(targetProblem(machine, s.character, clearWorld), null, 'combat range includes its boundary');
});

test('spirits select their body, keeper, or correct lift floor without exposing living interactions', () => {
  const s = simulation();s.character.health = 0;s.character.position = [0, 24, -6];
  s.character.death = { released: true, corpse: [0, 24, -18], graveyard: 'rest' };
  const targets = collectTargets(data, s);
  assert.deepEqual(targets.map(t => t.kind), ['corpse', 'healer', 'lift']);
  const lift = targets.find(t => t.kind === 'lift');
  assert.deepEqual(lift.position, [0, 24, -6]);
  assert.equal(targetProblem(lift, s.character, clearWorld), null);
  const body = targets.find(t => t.kind === 'corpse');
  assert.equal(targetProblem(body, s.character, clearWorld), null);
  s.character.position[2] += .01;
  assert.equal(targetProblem(body, s.character, clearWorld), 'Move within 12 m');
  assert.deepEqual(data.world.lifts[0].position, [0, 0, -6], 'resolving a lift never mutates content');
});

test('dungeon selections follow the current phase, recovery cooldown, and ally revive state', () => {
  const s = simulation();s.inDungeon = true;s.character.position = [1000, 0, 1000];
  s.dungeon = { run: { id: 7, dungeon: 'case', chapter: 0, phase: 'active', members: [{ id: 'ally' }], revivesLeft: 0, recoveryReady: 12 } };
  const players = [{ id: 'ally', name: 'Ally', position: [1000, 0, 1001], health: 0 }];
  let targets = collectTargets(data, s, [], players);
  assert.deepEqual(new Set(targets.map(t => t.kind)), new Set(['revive', 'evidence', 'recover']));
  assert.equal(targetProblem(targets.find(t => t.kind === 'revive'), s.character, clearWorld), 'No revives left');
  assert.equal(targetProblem(targets.find(t => t.kind === 'recover'), s.character, clearWorld), 'Ready in 2s');
  s.time = 12;s.dungeon.run.revivesLeft = 1;
  targets = collectTargets(data, s, [], players);
  for (const target of targets) assert.equal(targetProblem(target, s.character, clearWorld), null);
  players[0].health = 100;
  assert.equal(collectTargets(data, s, [], players).find(t => t.key === 'player:ally').kind, 'player');
  s.dungeon.run.phase = 'briefing';
  assert.deepEqual(collectTargets(data, s, [], players).map(t => t.kind), ['player']);
});

function renderer() {
  const eye = [0, 3, 8], matrix = multiply(perspective(1.04, 800 / 600, .12, 5200), lookAt(eye, [0, 1, -8]));
  return { eye, canvas: { clientWidth: 800, clientHeight: 600 }, project: p => project(p, matrix, 800, 600) };
}

test('picking uses visible screen bounds and chooses the frontmost overlapping target', () => {
  const s = simulation();s.enemies.push(enemy('behind', [0, 0, -20]), enemy('behind-camera', [0, 0, 20]), enemy('offscreen', [70, 0, -2]));
  const r = renderer(), targets = collectTargets(data, s).filter(t => t.kind === 'enemy');
  const visible = visibleTargets(targets, s.character, clearWorld, r);
  assert.deepEqual(visible.map(t => t.object.id), ['shared', 'behind']);
  const pixel = r.project([0, 1.4, -8]);
  assert.equal(pickTarget([...visible].reverse(), r, pixel[0], pixel[1]).object.id, 'shared');
  assert.equal(pickTarget(visible, r, 10, 10), null);
  assert.equal(visibleTargets(targets, s.character, { lineOfSight: () => false }, r).length, 0);
  const cameraBlocked = { lineOfSight: from => from !== s.character.position ? false : true };
  assert.equal(visibleTargets(targets, s.character, cameraBlocked, r).length, 0);
  assert.equal(targetBounds(targets[0], () => [0, 0, 2]), null, 'reject clipped projections');
});

test('target cycling includes friendly characters and objects, wraps, and tolerates removal', () => {
  const s = simulation(), targets = visibleTargets(collectTargets(data, s), s.character, clearWorld, renderer());
  const visited = new Set();let target = null;
  for (let i = 0; i < targets.length; i++) { target = cycleTarget(targets, target?.key, s.character.position);visited.add(target.key); }
  assert.equal(visited.size, targets.length);
  assert.ok(visited.has('npc:shared'));assert.ok(visited.has('terminal:record'));assert.ok(visited.has('enemy:shared'));
  assert.equal(cycleTarget(targets, target.key, s.character.position).key, cycleTarget(targets, null, s.character.position).key);
  assert.ok(cycleTarget(targets, 'despawned', s.character.position));
  assert.equal(cycleTarget([], null, s.character.position), null);
});
