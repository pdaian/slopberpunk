// Buildless checks: node --experimental-default-type=module client/tests/quests.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World } from '../src/world.js';
import { questView, questDestination, objectiveText, openingGuide } from '../src/quests.js';
import { worldEventViews, validateWorldEvents, incidentStatus, incidentTargets, incidentGeometry } from '../src/events.js';
import { CityLife } from '../src/citylife.js';

const data = Object.fromEntries(['world', 'rules', 'events', 'quests', 'enemies', 'citylife'].map(n => [n, JSON.parse(readFileSync(new URL(`../data/${n}.json`, import.meta.url)))]));
data.npcs = JSON.parse(readFileSync(new URL('../data/npcs.json', import.meta.url)));
const world = new World(data.world);
const quest = data.quests.find(q => q.id === 'relay-00');
const character = () => ({ position: [36, 0, 40], activeQuests: { [quest.id]: 0 }, questStages: { [quest.id]: { index: 0, progress: 0 } }, completed: [] });
const snapshot = (id, phase = 'active', extra = {}) => ({ id, state: { phase, cycle: 3, deadline: 150, repaired: [], hold: 0, hazard: null, ...extra } });

test('incident content and every staged contract reference reachable, supported content', () => {
  validateWorldEvents(data.events, data, world);
  assert.equal(data.quests.filter(q => q.steps).length, 23);
  assert.equal(data.events.entries.length, 5);
  const invalid = structuredClone(data.events);
  invalid.entries[0].spawns[0] = [5000, 0, 0];
  assert.throws(() => validateWorldEvents(invalid, data, world));
  const badQuest = structuredClone(data);
  badQuest.quests[0].steps[1].target = 'missing-incident';
  assert.throws(() => validateWorldEvents(data.events, badQuest, world));
});

test('old accepted contracts keep their original objective and ready-to-turn-in state', () => {
  const c = character(); delete c.questStages;
  assert.equal(questView(quest, c).staged, false);
  assert.equal(questView(quest, c).step, quest.objective);
  c.activeQuests[quest.id] = 1;
  assert.equal(questView(quest, c).ready, true);
  assert.equal(questDestination(quest, c, data).id, quest.giver);
  delete c.activeQuests[quest.id];
  assert.equal(questView(quest, c).staged, true, 'new contracts preview their full steps');
});

test('saved steps guide players through controls, defense, and the final handover', () => {
  const c = character();
  assert.equal(questDestination(quest, c, data).id, 'market');
  c.questStages[quest.id].index = 1;
  let events = worldEventViews(data, [snapshot('water-lockout')]);
  assert.equal(questDestination(quest, c, data, events).id, 'commons-water');
  events[0].repaired = ['commons-water'];
  assert.equal(questDestination(quest, c, data, events).id, 'lantern-kitchen');
  events[0].repaired.push('lantern-kitchen');
  assert.equal(questDestination(quest, c, data, events).id, 'commons-water');
  assert.equal(questDestination(quest, c, data, []).id, 'commons-water', 'unseen incidents still have a map destination');
  c.questStages[quest.id].index = 2;
  const restored = JSON.parse(JSON.stringify(c));
  assert.equal(questDestination(quest, restored, data).id, 'relay-node');
  assert.equal(questView(quest, restored).ready, false);
  restored.activeQuests[quest.id] = 1;
  restored.questStages[quest.id].index = 3;
  assert.equal(questDestination(quest, restored, data).id, quest.giver);
});

test('only active, unrepaired controls offer an incident interaction with the current cycle', () => {
  for (const phase of ['idle', 'warning', 'failed', 'recovery']) assert.equal(incidentTargets(worldEventViews(data, [snapshot('water-lockout', phase)])).length, 0);
  const events = worldEventViews(data, [snapshot('water-lockout', 'active', { repaired: ['commons-water'] })]);
  const targets = incidentTargets(events);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].object.id, 'lantern-kitchen');
  assert.equal(targets[0].object.cycle, 3);
  assert.equal(targets[0].object.event, 'water-lockout');
  assert.match(incidentStatus(events[0], data.events.rules, 30), /1\/2.*120s/);
  events[0].repaired.push('lantern-kitchen'); events[0].hold = 4.4;
  assert.match(incidentStatus(events[0], data.events.rules, 30), /defeat enemy machines.*4\/12s/);
  assert.equal(incidentTargets(events).length, 0);
});

test('hazard footprints and beacons render finite geometry at both quality and motion settings', () => {
  const entry = data.events.entries[1], position = data.world.landmarks.find(l => l.id === entry.anchor).position;
  const events = worldEventViews(data, [snapshot(entry.id, 'active', { hazard: { position, radius: data.events.rules.hazardRadius, hitsAt: 33 } })]);
  for (const reduced of [true, false]) {
    const vertices = [];
    incidentGeometry(vertices, events, data.events.rules, position, 31, reduced);
    assert.ok(vertices.length > 1000); assert.ok(vertices.every(Number.isFinite));
    const expired = [];
    incidentGeometry(expired, events, data.events.rules, position, 34, reduced);
    assert.ok(expired.length < vertices.length, 'expired hazards must disappear');
  }
  const distant = [];
  incidentGeometry(distant, events, data.events.rules, [2500, 0, 2500], 31);
  assert.equal(distant.length, 0);
});

test('live incidents change civilian work, conversation, and recovery without modifying saved stories', () => {
  const life = new CityLife(world, data.citylife), resident = life.locals[1];
  const work = resident.routine.segments.find(s => s.activity === 'story');
  const epoch = (12 * 3600 - (12 * 3600 + resident.seed) % resident.routine.duration + work.start + 1) * 1000;
  const events = worldEventViews(data, [snapshot('water-lockout', 'recovery')]);
  const completed = ['neighborhood-market-00'];
  let actor = life.update(epoch, [0, 0, 0], { incidents: events, completed }).find(r => r.id === resident.id);
  assert.equal(actor.activity, 'serve'); assert.equal(actor.line, events[0].success);
  assert.equal(life.conversation(actor, epoch).event.detail, events[0].success);
  events[0].phase = 'failed';
  actor = life.update(epoch + 50, [0, 0, 0], { incidents: events, completed }).find(r => r.id === resident.id);
  assert.equal(actor.activity, 'wait'); assert.equal(actor.line, events[0].failure);
  assert.deepEqual(completed, ['neighborhood-market-00']);
  life.clear(); assert.equal(life.incidents.length, 0);
});

test('hold objectives display their saved seconds and authored instruction', () => {
  const q = data.quests.find(q => q.id === 'neighborhood-market-02');
  const c = { activeQuests: { [q.id]: 0 }, questStages: { [q.id]: { index: 1, progress: 4 } } };
  const view = questView(q, c);
  assert.equal(view.progress, 4); assert.equal(view.step.count, 10); assert.equal(view.ready, false);
  assert.equal(objectiveText(view.step, data), 'Stay near Commons water meter for 10 seconds.');
});

test('all sixteen faction and lineage combinations get a complete, saved opening route', () => {
  for (const faction of ['relay', 'covenant', 'foundry', 'choir']) for (const race of ['human', 'lattice', 'revenant', 'bloom']) {
    let c = { faction, race, level: 0, position: [0, 0, 32], activeQuests: {}, questStages: {}, completed: [] };
    let guide = openingGuide(c, data);
    assert.equal(guide.quest.id, `${faction}-00`);
    assert.equal(guide.destination.id, guide.quest.giver);
    c.activeQuests[guide.quest.id] = 0;
    c.questStages[guide.quest.id] = { index: 0, progress: 0 };
    guide = openingGuide(c, data);
    assert.equal(guide.quest.id, `${race}-00`, 'pick up both records before the shared emergency');
    c.activeQuests[guide.quest.id] = 0;
    c.questStages[guide.quest.id] = { index: 0, progress: 0 };
    guide = openingGuide(c, data);
    assert.equal(guide.destination.id, 'market');
    assert.match(guide.instruction, /press E/);
    for (const id of [`${faction}-00`, `${race}-00`]) {
      c.questStages[id] = { index: 1, progress: 0 };
      const q = data.quests.find(q => q.id === id);
      assert.ok(q.briefing.includes('kitchen') || q.briefing.includes('Kitchen'));
      assert.ok(q.steps.every(s => s.voice));
      assert.equal(q.story.speaker, q.giver);
    }
    const events = worldEventViews(data, [snapshot('water-lockout')]);
    guide = openingGuide(c, data, events);
    assert.match(guide.instruction, /Repair/);
    events[0].repaired = events[0].controls.map(s => s.id);
    assert.match(openingGuide(c, data, events).instruction, /Defeat the enemy machines/);
    events[0].phase = 'failed';
    assert.match(openingGuide(c, data, events).hint, /Completed steps stay saved/);
    for (const id of [`${faction}-00`, `${race}-00`]) c.questStages[id] = { index: 2, progress: 0 };
    c = JSON.parse(JSON.stringify(c));
    assert.equal(openingGuide(c, data).quest.id, `${faction}-00`);
    for (const id of [`${faction}-00`, `${race}-00`]) {
      c.activeQuests[id] = 1;
      c.questStages[id].index = 3;
    }
    guide = openingGuide(c, data);
    assert.equal(guide.phase, 'return');
    assert.equal(guide.destination.id, guide.quest.giver);
    for (const id of [`${faction}-00`, `${race}-00`]) { c.completed.push(id); delete c.activeQuests[id]; delete c.questStages[id]; }
    for (const id of ['neighborhood-market-00', 'neighborhood-market-01', 'neighborhood-market-02']) {
      guide = openingGuide(c, data);
      assert.equal(guide.quest.id, id);
      assert.equal(guide.destination.id, 'nella');
      c.completed.push(id);
    }
    assert.equal(openingGuide(c, data), null);
  }
});

test('guidance honors older single-objective contracts without requiring a new incident', () => {
  const c = { faction: 'relay', race: 'human', level: 4, position: [0, 0, 32], activeQuests: { 'relay-00': 0 }, completed: ['human-00'] };
  const guide = openingGuide(c, data);
  assert.equal(guide.destination.id, 'market');
  assert.equal(guide.key, 'relay-00:step-legacy');
  assert.doesNotMatch(guide.instruction, /shutoff|enforcement/);
  c.activeQuests['relay-00'] = 1;
  assert.equal(openingGuide(c, data).phase, 'return');
});
