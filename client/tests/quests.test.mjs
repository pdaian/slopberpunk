// Buildless checks: node --experimental-default-type=module client/tests/quests.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World } from '../src/world.js';
import { questView, questDestination, questGuide, placeInfo, questProgressText, followedQuest, objectiveText, openingGuide } from '../src/quests.js';
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

test('hazard footprints and panel lights render finite geometry at both motion settings', () => {
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
    assert.match(guide.instruction, /Read.*Commons exchange/);
    assert.match(guide.hint, /press E/);
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

test('every quest has an actionable offer, directions for every step, and a final handover', () => {
  for (const q of data.quests) {
    const c = { faction: q.faction || 'relay', race: q.race || 'human', level: q.level, position: [0, 0, 32], activeQuests: {}, questStages: {}, completed: [...q.requires] };
    const offer = questGuide(q, c, data);
    assert.equal(offer.phase, 'offer', q.id);
    assert.equal(offer.destination.id, q.giver);
    assert.match(offer.hint, /ACCEPT QUEST/);
    c.activeQuests[q.id] = 0;
    for (const [index, step] of (q.steps || [q.objective]).entries()) {
      if (q.steps) c.questStages[q.id] = { index, progress: Math.max(0, step.count - 1) };
      const saved = structuredClone(c), guide = questGuide(q, c, data);
      assert.ok(guide.destination?.position.every(Number.isFinite), `${q.id}: ${index}`);
      assert.ok(guide.instruction && guide.hint);
      assert.ok(placeInfo(guide.destination, data).description);
      assert.doesNotMatch(guide.instruction + guide.hint, /undefined|NaN|marker|marked control/i);
      assert.deepEqual(c, saved, 'reading guidance never changes server progress');
      if (step.type === 'kill') {
        assert.ok(data.world.enemySpawns.some(s => s.type === step.target && s.position === guide.destination.position));
        assert.ok(guide.destination.level <= c.level, 'suggested patrols are suitable for the quest level');
        assert.match(guide.hint, /Any .* counts/);
      }
    }
    c.activeQuests[q.id] = q.objective.count;
    if (q.steps) c.questStages[q.id].index = q.steps.length;
    const ready = questGuide(q, JSON.parse(JSON.stringify(c)), data);
    assert.equal(ready.destination.id, q.giver);
    assert.equal(ready.phase, 'return');
    assert.match(ready.instruction, /choose an ending.*reward/);
    assert.equal(questProgressText(ready.view), '');
    c.completed.push(q.id); delete c.activeQuests[q.id]; delete c.questStages[q.id];
    assert.notEqual(followedQuest(q.id, c, data)?.id, q.id, 'handover advances or ends the followed story');
  }
});

test('every emergency guides its own controls, retry phase and defense without kitchen assumptions', () => {
  for (const definition of data.events.entries) {
    const q = data.quests.find(q => q.steps?.some(s => s.target === definition.id));
    const c = { ...character(), level: 60, activeQuests: { [q.id]: 0 }, questStages: { [q.id]: { index: q.steps.findIndex(s => s.type === 'event'), progress: 0 } } };
    const anchor = data.world.landmarks.find(l => l.id === definition.anchor);
    for (const phase of ['idle', 'warning', 'failed', 'recovery']) {
      const guide = questGuide(q, c, data, worldEventViews(data, [snapshot(definition.id, phase)]));
      assert.equal(guide.destination.id, definition.anchor);
      assert.ok(guide.instruction.includes(anchor.name));
      assert.match(guide.hint, /Completed steps stay saved/);
    }
    const events = worldEventViews(data, [snapshot(definition.id)]), event = events[0], original = structuredClone(events);
    const first = questGuide(q, c, data, events);
    assert.match(first.instruction, /Repair/);
    assert.deepEqual(events, original, 'choosing a repair does not sort or mutate the event');
    event.repaired.push(first.destination.id);
    const second = questGuide(q, c, data, events);
    assert.notEqual(second.destination.id, first.destination.id);
    assert.match(second.instruction, /1\/2/);
    event.repaired.push(second.destination.id); event.hold = 4;
    const defense = questGuide(q, c, data, events);
    assert.equal(defense.destination.id, definition.anchor);
    assert.ok(defense.instruction.includes(anchor.name));
    assert.match(defense.hint, /4\/12/);
    if (definition.enemy) assert.match(defense.instruction, /Defeat/);
    else assert.doesNotMatch(defense.instruction + defense.hint, /Defeat|shoot/i);
  }
});

test('legacy saves, level gates and prerequisites retain their original meaning', () => {
  for (const q of data.quests.filter(q => q.steps)) {
    const c = { ...character(), level: 60, activeQuests: { [q.id]: 0 }, completed: [...q.requires] };
    delete c.questStages;
    const guide = questGuide(q, c, data);
    assert.equal(guide.view.staged, false);
    assert.equal(guide.destination.id, q.objective.target);
    assert.equal(guide.instruction, objectiveText(q.objective, data));
  }
  const q = data.quests.find(q => q.id === 'neighborhood-archive-01');
  const c = { ...character(), level: 0, activeQuests: {} };
  let guide = questGuide(q, c, data);
  assert.equal(guide.locked, true); assert.equal(guide.destination, null);
  assert.match(guide.instruction, /Reach level .* and finish/);
  c.level = 60; guide = questGuide(q, c, data);
  assert.match(guide.instruction, /^Finish/);
  c.completed = [...q.requires]; assert.equal(questGuide(q, c, data).phase, 'offer');
});

test('following each local questline survives saved handovers and ends without looping', () => {
  for (const group of [...new Set(data.quests.map(q => q.neighborhood || q.biome).filter(Boolean))]) {
    const line = data.quests.filter(q => (q.neighborhood || q.biome) === group);
    let c = { ...character(), faction: 'relay', race: 'human', level: 60, completed: [] };
    const first = line[0].id;
    for (const q of line) {
      assert.equal(followedQuest(first, c, data).id, q.id);
      c.completed.push(q.id); c = JSON.parse(JSON.stringify(c));
    }
    assert.equal(followedQuest(first, c, data), null);
    assert.equal(followedQuest('missing', c, data), null);
    assert.equal(followedQuest('covenant-00', c, data), null, 'another faction cannot become the tracked story');
  }
});

test('quest help uses the active device and reports only meaningful progress', () => {
  const q = data.quests.find(q => q.id === 'relay-00'), c = character();
  for (const [device, pattern, forbidden] of [
    ['keyboard', /press E/, /\bRT\b|Tap/], ['gamepad', /then X/, /press E|Click|Tap/], ['touch', /then USE/, /press E|Click|\bRT\b/]
  ]) {
    const guide = questGuide(q, c, data, [], device);
    assert.match(guide.hint, pattern); assert.doesNotMatch(guide.hint, forbidden);
  }
  assert.equal(questProgressText(questView(q, c)), '');
  assert.equal(questProgressText(openingGuide({ ...c, tutorialStage: 'move' }, data).view), '');
  assert.equal(questProgressText({ accepted: true, ready: false, progress: 4, step: { type: 'hold', count: 10 } }), '4/10 seconds');
  assert.equal(questProgressText({ accepted: true, ready: false, progress: 2, step: { type: 'kill', count: 3 } }), '2/3 defeated');
});

test('every destination has a geographic description and upper transit names its access route', () => {
  for (const place of [...data.npcs, ...data.world.landmarks]) {
    assert.ok(place.location?.length > 20, place.id);
    const info = placeInfo(place, data);
    assert.ok(info.area && info.description && info.region);
    assert.doesNotMatch(info.description, /marker|undefined/i);
    if (place.position[1] === 24) assert.match(info.access, /Transit lift.*Night crew ramp/);
  }
  const gate = data.world.landmarks.find(l => l.id === 'tutorial-exit');
  assert.equal(placeInfo(gate, data).area, data.world.tutorial.name);
  const fen = data.world.landmarks.find(l => l.id === 'fen-gauge');
  assert.equal(placeInfo(fen, data).region, 'basin');
});
