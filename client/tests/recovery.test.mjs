// Buildless recovery checks. No browser, files, or generated assets are created.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World } from '../src/world.js';
import { Prediction, stats } from '../src/prediction.js';
import { isSpirit, recoveryView, bearing } from '../src/death.js';
import { Renderer } from '../src/renderer.js';
import { CharacterMeshes } from '../src/character.js';
import { runInNewContext } from 'node:vm';
import { distance, mix3, clamp } from '../src/math.js';
import { escapeHtml } from '../src/icons.js';
import { openingGuide, questView, questDestination, objectiveText } from '../src/quests.js';
import { worldEventViews, incidentTargets } from '../src/events.js';

const read = name => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url)));
const data = Object.fromEntries(['world', 'rules', 'races', 'talents', 'dungeons', 'quests', 'npcs', 'events'].map(n => [n, read(n)]));
const world = new World(data.world);
const character = () => ({ position: [0, 0, 64], yaw: 0, health: 0, energy: 0, credits: 95, level: 0, race: 'human', talents: {}, death: { corpse: [0, 0, 32], graveyard: 'commons-rest', released: false, releaseAt: 15, creditsLost: 5 } });

test('every graveyard is reachable, uniquely identified, and outside enemy aggro range', () => {
  assert.equal(new Set(data.world.graveyards.map(g => g.id)).size, data.world.graveyards.length);
  assert.equal(data.world.graveyards.length, 9);
  for (const g of data.world.graveyards) {
    assert.equal(world.collides(...g.position), false, g.id);
    assert.equal(world.floorAt(g.position[0], g.position[2], 1, -1), 0, g.id);
    for (const e of data.world.enemySpawns) assert.ok(Math.hypot(...g.position.map((v, i) => v - e.position[i])) > data.rules.combat.aggroRadius + data.rules.interactionRadius, g.id);
  }
});

test('release countdown and recovery state survive JSON round trips without granting life', () => {
  const c = JSON.parse(JSON.stringify(character()));
  assert.equal(recoveryView(c, data, world, 12500).wait, 3);
  assert.equal(recoveryView(c, data, world, 18000).wait, 0);
  assert.equal(isSpirit(c), false);
  assert.equal(recoveryView(c, data, world, 18000).canReclaim, false);
  c.death.released = true;
  const view = recoveryView(c, data, world, 18000);
  assert.equal(view.spirit, true);
  assert.equal(view.atHealer, true);
  assert.equal(view.distance, 32);
  assert.equal(view.healerCost, 10);
  c.credits = 10000;
  assert.equal(recoveryView(c, data, world, 18000).healerCost, 100);
  c.credits = 0;
  assert.equal(recoveryView(c, data, world, 18000).healerCost, 0);
  c.health = 1;
  assert.equal(recoveryView(c, data, world, 18000), null);
  assert.equal(isSpirit(c), false);
});

test('corpse recovery requires range, elevation, and line of sight; keeper requires proximity', () => {
  const c = character(); c.death.released = true;
  c.position = [0, 0, 44];
  assert.equal(recoveryView(c, data, world, 18000).canReclaim, true);
  assert.equal(recoveryView(c, data, world, 18000).atHealer, false);
  c.position[2] += .01;
  assert.equal(recoveryView(c, data, world, 18000).canReclaim, false);
  c.position = [0, 24, 32];
  assert.equal(recoveryView(c, data, world, 18000).canReclaim, false);
  c.position = [0, 0, 32];
  assert.equal(recoveryView(c, data, { lineOfSight: () => false }, 18000).canReclaim, false);
});

test('only released spirits move while dead, and prediction does not restore health or energy', () => {
  const c = character(), prediction = new Prediction(data, world, c);
  for (let i = 0; i < 20; i++) prediction.tick(.05, { forward: 1 });
  assert.deepEqual(c.position, [0, 0, 64]);
  c.death.released = true;
  for (let i = 0; i < 20; i++) prediction.tick(.05, { forward: 1 });
  assert.ok(c.position[2] < 55);
  assert.equal(c.health, 0);
  assert.equal(c.energy, 0);
  assert.ok(Math.abs(prediction.velocity[2] + data.rules.movement.speed * data.rules.death.spiritSpeedMultiplier) < .001);
});

test('sickness applies to damage and movement while preserving base vitals and build bonuses', () => {
  const c = character(), normal = stats(c, data);
  c.resurrectionSickness = 60;
  const sick = stats(c, data);
  assert.equal(sick.damage, normal.damage * .5);
  assert.equal(sick.speed, normal.speed * .75);
  assert.equal(sick.health, normal.health);
  assert.equal(sick.energy, normal.energy);
});

test('directional guidance follows camera heading in all quadrants', () => {
  const origin = [0, 0, 0];
  assert.equal(bearing(origin, [0, 0, -10]), '↑');
  assert.equal(bearing(origin, [10, 0, 0]), '→');
  assert.equal(bearing(origin, [0, 0, 10]), '↓');
  assert.equal(bearing(origin, [-10, 0, 0]), '←');
  assert.equal(bearing(origin, [-10, 0, 0], Math.PI / 2), '↑');
});

test('fallen-body geometry remains finite at both quality levels', () => {
  const models = JSON.parse(readFileSync(new URL('../assets/models.json', import.meta.url)));
  for (const quality of [.5, 1]) {
    const renderer = { models, characters: new CharacterMeshes(models), quality }, vertices = [];
    Renderer.prototype.actor.call(renderer, vertices, { id: 'body', model: 'humanoid', race: 'human', position: [0, 0, 32], corpse: true }, 0);
    assert.ok(vertices.length > 1000);
    assert.ok(vertices.every(Number.isFinite));
  }
});

// Exercise application wiring in memory; this is not a browser/WebGL acceptance test.
function application(c) {
  const nodes = new Map(), sent = [];
  const node = selector => {
    if (!nodes.has(selector)) {
      const classes = new Set();
      nodes.set(selector, { hidden: true, open: false, textContent: '', innerHTML: '', scrollTop: 0,
        classList: { toggle: (key, on) => on ? classes.add(key) : classes.delete(key), remove: key => classes.delete(key) },
        focus() {}, showModal() { this.open = true; }, close() { this.open = false; }, setAttribute() {},
      });
    }
    return nodes.get(selector);
  };
  const simulation = new Prediction(data, world, c);
  const context = { fixtureData: data, fixtureWorld: world, fixtureSimulation: simulation, sent,
    document: { querySelector: node, querySelectorAll: () => [], exitPointerLock() {} },
    matchMedia: () => ({ matches: true }), WorldClock: class { now() { return 18000; } sync() {} },
    distance, mix3, clamp, isSpirit, recoveryView, bearing, openingGuide, questView, questDestination, objectiveText,
    worldEventViews, incidentTargets, esc: escapeHtml,
  };
  let source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8').replace(/^import .*;$/gm, '');
  source = source.slice(0, source.lastIndexOf('boot().catch'));
  runInNewContext(source + `\ndata=fixtureData;world=fixtureWorld;simulation=fixtureSimulation;audio={stopVoice(){},speak(){}};input={clear(){}};connection={send(action){sent.push(action);}};cityLife={actors:[],neighborhoods:new Map()};state='playing';globalThis.harness={perform,findNearest,updateRecoveryUI,onSnapshot,panel,closePanel};`, context);
  return { ...context.harness, node, sent, simulation };
}

test('application enables spirit recovery, body interaction, and a controller-accessible recovery menu', () => {
  const c = { ...character(), faction: 'relay', activeQuests: {}, completed: [] }, app = application(c);
  app.updateRecoveryUI();
  assert.equal(app.node('#death-screen').hidden, false);
  assert.equal(app.node('#respawn').disabled, false);
  c.death.released = true;
  app.updateRecoveryUI();
  assert.equal(app.node('#death-screen').hidden, true);
  assert.equal(app.node('#recovery-panel').hidden, false);
  app.perform('interact');
  assert.equal(app.node('#panel-dialog').open, true);
  assert.match(app.node('#dialog-content').innerHTML, /Resurrection sickness/);
  assert.match(app.node('#dialog-content').innerHTML, /10 ¤/);
  app.closePanel();
  c.position = [...c.death.corpse];
  app.perform('interact');
  assert.equal(app.sent.at(-1).type, 'reclaimCorpse');
  app.perform('escape');
  assert.match(app.node('#dialog-content').innerHTML, /data-do="return-graveyard"/);
});

test('guided evidence remains readable when a live incident shares its terminal', () => {
  const c = { ...character(), health: 100, death: undefined, faction: 'relay', position: [36, 0, 40], activeQuests: { 'neighborhood-market-01': 0 }, questStages: { 'neighborhood-market-01': { index: 0, progress: 0 } }, completed: ['relay-00', 'human-00', 'neighborhood-market-00'] };
  const app = application(c);
  app.simulation.worldEvents = worldEventViews(data, [{ id: 'water-lockout', state: { phase: 'active', cycle: 1, repaired: [], hold: 0, deadline: 150 } }]);
  assert.equal(app.findNearest().kind, 'terminal');
  assert.equal(app.findNearest().object.id, 'commons-water');
  c.questStages['neighborhood-market-01'].index = 1;
  assert.equal(app.findNearest().kind, 'incident');
});

test('death snapshots close stale quest panels and recovery teleports reset predicted motion', () => {
  const c = { ...character(), health: 100, death: undefined, faction: 'relay', activeQuests: {}, completed: [], position: [0, 0, 32] };
  const app = application(c);
  app.panel('Journal', '', '', 'journal');
  app.simulation.velocity = [2, 0, 3];
  const dead = { ...c, health: 0, death: character().death, activeQuests: { 'relay-00': 0 } };
  app.onSnapshot({ character: dead, time: 1, worldEvents: [] });
  assert.equal(app.node('#panel-dialog').open, false, 'a changed quest cursor must not reopen the dialog after death');
  assert.equal(app.simulation.velocity.join(','), '0,0,0');
  const spirit = { ...dead, death: { ...dead.death, released: true }, position: [0, 0, 33] };
  app.onSnapshot({ character: spirit, time: 2, worldEvents: [] });
  assert.equal(app.simulation.character.position[2], 33, 'release must not blend with corpse position');
  app.simulation.velocity = [2, 0, 3];
  app.onSnapshot({ character: { ...spirit, position: [0, 0, 64] }, time: 3, worldEvents: [] });
  assert.equal(app.simulation.velocity.join(','), '0,0,0');
});
