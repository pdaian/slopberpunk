// In-memory wardrobe, identity, interaction, and rendering regressions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { World } from '../src/world.js';
import { CityLife, createRoutine } from '../src/citylife.js';
import { CharacterMeshes, motionPose, activityPose } from '../src/character.js';
import { NPC_WARDROBE, npcIdentity, outfitKey, outfitParts, identityHash } from '../src/npc-style.js';
import { StreetSocial, encounterFor, residentMood } from '../src/street-social.js';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const world = new World(read('../data/world.json')), content = read('../data/citylife.json'), models = read('../assets/models.json');
const epoch = Date.UTC(2026, 9, 21, 12);
const clearWorld = { lineOfSight: () => true };
function actor(id, role = 'neighbor', position = [0, 0, 0], options = {}) {
  const identity = npcIdentity(id, role);
  return { id, name: id, role, position, velocity: [0, 0, 0], activity: 'talk', socialAvailable: true, stopStarted: 0, stopEnds: 40, ...identity,
    personality: { ...identity.personality, sociability: .8, patience: .7, care: .8, assertiveness: .3 }, ...options };
}
const startFor = (a, b) => Math.max(a.stopStarted, b.stopStarted) + 1 + identityHash([a.id, b.id].sort().join('|')) % 3;
const durationFor = (a, b) => Math.min(a.stopEnds, b.stopEnds, startFor(a, b) + 11 + Math.round(Math.min(a.personality.patience, b.personality.patience) * 5 + Math.min(a.personality.sociability, b.personality.sociability) * 2)) - startFor(a, b);
const during = (a, b, progress) => (startFor(a, b) + durationFor(a, b) * progress) * 1000;

test('768 garment combinations change actual geometry at both detail levels before paint or accessories', () => {
  const base = npcIdentity('wardrobe-proof').outfit;
  for (const detail of [false, true]) {
    const shapes = new Set();
    for (const upper of NPC_WARDROBE.upper) for (const lower of NPC_WARDROBE.lower) for (const shoes of NPC_WARDROBE.shoes) {
      const parts = outfitParts({ ...base, upper, lower, shoes }).filter(p => detail || !p.detailOnly);
      shapes.add(JSON.stringify(parts.map(p => [p.joint, p.center, p.size, p.roll || 0, p.pitch || 0, detail ? p.taper || 1 : 1])));
      assert.ok(parts.length <= 90, 'keep the crowd geometry bounded');
    }
    assert.equal(shapes.size, 768);
  }
});

test('every resident and fixed contact in the current world has a distinct, stable outfit and personality', () => {
  const life = new CityLife(world, content);
  const residents = [...life.locals, ...life.travellers, ...world.buildings.flatMap(b => life.blockResidents(b)), ...life.streetBlocks.flatMap(b => life.streetResidents(b))];
  const contacts = read('../data/npcs.json').map(n => ({ ...n, ...npcIdentity(n.id) }));
  const outfits = new Set(), renderedOutfits = new Set(), personalities = new Set();
  for (const npc of [...residents, ...contacts]) {
    outfits.add(outfitKey(npc.outfit));personalities.add(JSON.stringify(npc.personality));
    const visible = outfitParts(npc.outfit, npc.race).filter(p => !p.detailOnly).map(p => [p.joint, p.center, p.size, p.color, p.emissive, p.yaw || 0, p.pitch || 0, p.roll || 0]);
    renderedOutfits.add(createHash('sha256').update(JSON.stringify(visible)).digest('hex'));
    assert.deepEqual(npcIdentity(npc.id, npc.role).outfit, npc.outfit);
    assert.deepEqual(npcIdentity(npc.id, npc.role).personality, npc.personality);
  }
  assert.ok(residents.length > 4500);
  assert.equal(outfits.size, residents.length + contacts.length);
  assert.equal(renderedOutfits.size, outfits.size, 'uniqueness must survive removal of hidden details and box LOD taper');
  assert.equal(personalities.size, outfits.size);
  const block = world.buildings.find(b => b.interior), original = life.blockResidents(block);
  life.blocks.delete(block);
  assert.deepEqual(life.blockResidents(block).map(n => [n.outfit, n.personality]), original.map(n => [n.outfit, n.personality]));
});

test('all clothing families, materials, accessories, hair and lineages draw finite articulated meshes', () => {
  const rigs = new CharacterMeshes(models), base = npcIdentity('mesh-proof').outfit;
  const variants = Object.entries(NPC_WARDROBE).flatMap(([key, values]) => values.map((value, index) => ({ ...base, [key === 'palettes' ? 'palette' : key]: key === 'palettes' ? index : value })));
  for (const [i, outfit] of variants.entries()) for (const detail of [false, true]) {
    const v = [], race = ['human', 'lattice', 'revenant', 'bloom'][i % 4];
    rigs.draw(v, { outfit, race, position: [3, 2, 1], yaw: .8, color: '#123456' }, motionPose(1.5, 1.2), detail);
    assert.ok(v.length && v.length % 30 === 0 && v.every(Number.isFinite));
    assert.ok(v.length < (detail ? 150000 : 30000), `${outfit.upper} exceeds its vertex budget`);
    assert.ok(v.some((value, j) => j % 10 === 9 && value >= 8 && value <= 12), 'opaque clothing material reaches the renderer');
  }
  for (const finish of NPC_WARDROBE.finish) {
    const part = outfitParts({ ...base, finish }).find(p => p.joint === 'body' && p.color === NPC_WARDROBE.palettes[base.palette].primary);
    assert.equal(part.emissive, 8 + NPC_WARDROBE.finish.indexOf(finish));
  }
});

test('outfit mesh retention is bounded and recently used meshes survive eviction', () => {
  const rigs = new CharacterMeshes(models), first = npcIdentity('retained').outfit;
  const cached = rigs.outfit(first, 'human', true);
  for (let i = 0; i < 200; i++) { rigs.outfit(npcIdentity(`stream-${i}`).outfit, 'human', false);assert.equal(rigs.outfit(first, 'human', true), cached); }
  assert.equal(rigs.outfitMeshes.size, 160);
  assert.deepEqual(rigs.outfit(first, 'human', false), new CharacterMeshes(models).outfit(first, 'human', false));
});

test('new social poses remain articulated and reduced motion freezes their animation', () => {
  for (const activity of ['listen', 'check', 'adjust', 'stretch', 'reassure', 'argue']) {
    const pose = activityPose(motionPose(0, 0), activity, 2);
    assert.notDeepEqual(pose, motionPose(0, 0));
    assert.ok(Object.values(pose).every(p => p.position.every(Number.isFinite) && Number.isFinite(p.pitch)));
    const rigs = new CharacterMeshes(models);rigs.reducedMotion = true;
    const npc = { ...actor(activity), socialPose: activity, position: [0, 0, 0], yaw: 0 };
    assert.deepEqual(rigs.pose(npc, 10), rigs.pose(npc, 20));
  }
});

test('paired conversations have one speaker, reciprocal attention, replies, resolution and departure', () => {
  const a = actor('cook', 'cook', [0, 0, 0], { activity: 'serve' }), b = actor('customer', 'customer', [2, 0, 0], { activity: 'eat' });
  const social = new StreetSocial(), phases = [];
  for (const progress of [.06, .25, .5, .75, .94]) {
    const actors = social.update(structuredClone([a, b]), during(a, b, progress), clearWorld);
    assert.equal(actors.filter(p => p.interaction?.speaking).length, 1);
    assert.equal(actors.filter(p => p.speech).length, 1);
    assert.equal(actors[0].interaction.partner, b.id);assert.equal(actors[1].interaction.partner, a.id);
    assert.equal(actors[0].interaction.kind, 'meal');assert.equal(actors[0].activity, 'serve');
    assert.equal(actors[0].yaw, Math.PI / 2);assert.equal(actors[1].yaw, -Math.PI / 2);
    assert.deepEqual(actors.map(p => p.position), [a.position, b.position]);
    phases.push(actors[0].interaction.phase);
  }
  assert.deepEqual(phases, ['greeting', 'opening', 'reply', 'resolution', 'goodbye']);
  const departed = social.update(structuredClone([a, b]), during(a, b, 1), clearWorld);
  assert.ok(departed.every(p => !p.interaction));
  assert.equal(social.memory.values().next().value.meetings, 1);
  assert.equal(social.memory.values().next().value.rapport, 1);
});

test('social phases are independent of actor order and rendering frame rate', () => {
  const a = actor('alpha'), b = actor('beta', 'neighbor', [2, 0, 0]), fast = new StreetSocial();
  const end = during(a, b, .5);
  for (let time = 0; time < end; time += 1000 / 60) fast.update(structuredClone([a, b]), time, clearWorld);
  const first = fast.update(structuredClone([a, b]), end, clearWorld);
  const second = new StreetSocial().update(structuredClone([b, a]), end, clearWorld).reverse();
  assert.deepEqual(first, second);
});

test('work, personality, consent to favors, and neighborhood recovery select coherent exchanges', () => {
  for (const [one, two, kind] of [['cook', 'customer', 'meal'], ['medic', 'patient', 'care'], ['technician', 'courier', 'delivery'], ['technician', 'technician', 'repair'], ['gardener', 'neighbor', 'garden'], ['commuter', 'neighbor', 'connection']]) {
    const a = actor('one', one), b = actor('two', two);
    assert.equal(encounterFor(a, b).kind, kind);assert.equal(encounterFor(b, a).kind, kind);
  }
  const a = actor('one'), b = actor('two');
  assert.equal(encounterFor(a, b, { recovery: true }).kind, 'help');
  assert.equal(encounterFor({ ...a, activity: 'repair' }, b), null, 'unrelated chatter does not interrupt work');
  a.personality.patience = .1;a.personality.assertiveness = .9;b.personality.assertiveness = .8;
  assert.equal(encounterFor(a, b).kind, 'disagreement');
  assert.match(encounterFor(a, b).lines[2], /Sorry/);
  a.personality.care = .1;b.personality.care = .1;
  assert.doesNotMatch(encounterFor(a, b).lines[2], /Sorry/);
  const seen = new Set();
  for (let i = 0; i < 80; i++) {
    const x = actor(`speaker-${i}`), y = actor('listener');
    const exchange = encounterFor(x, y);seen.add(exchange.kind);
    if (exchange.kind === 'favor') {
      assert.match(exchange.lines[1], /yes/);
      const responder = exchange.lead === x.id ? y : x;
      responder.personality.care = .2;assert.match(encounterFor(x, y).lines[1], /cannot promise/);
    }
  }
  for (const kind of ['favor', 'style', 'interest']) assert.ok(seen.has(kind));
  const revisits = Array.from({ length: 20 }, (_, cycle) => encounterFor(actor('regular-a'), actor('regular-b'), { cycle }));
  assert.ok(new Set(revisits.map(e => e.kind)).size > 1, 'later visits vary the subject');
  assert.equal(new Set(revisits.map(e => e.lead)).size, 2, 'both neighbors initiate subjects');
  assert.equal(residentMood(a.personality, epoch + 12 * 3600000, 'neighbor'), 'tired');
  assert.equal(residentMood(a.personality, epoch, 'courier'), 'in a hurry');
  assert.equal(residentMood(a.personality, epoch, 'neighbor', { phase: 'active' }), 'concerned');
});

test('danger, player focus, walls, floors, personal space, movement and short stops prevent pairings', () => {
  const a = actor('a'), b = actor('b', 'neighbor', [2, 0, 0]);
  for (const change of [
    p => p.socialAvailable = false, p => p.velocity = [1, 0, 0],
    p => p.position[1] = 1, p => p.position[0] = .5, p => p.position[0] = 8,
    p => p.stopEnds = 5
  ]) {
    const actors = structuredClone([a, b]);change(actors[1]);
    new StreetSocial().update(actors, during(a, b, .5), clearWorld);
    assert.ok(actors.every(p => !p.interaction));
  }
  for (const focus of ['a', 'b']) assert.ok(new StreetSocial().update(structuredClone([a, b]), during(a, b, .5), clearWorld, focus).every(p => !p.interaction));
  assert.ok(new StreetSocial().update(structuredClone([a, b]), during(a, b, .5), { lineOfSight: () => false }).every(p => !p.interaction));
  const social = new StreetSocial();social.update(structuredClone([a, b]), during(a, b, .5), clearWorld);
  const interrupted = structuredClone([a, b]);interrupted[0].socialAvailable = false;interrupted[0].activity = 'flee';
  social.update(interrupted, during(a, b, .51), clearWorld);
  assert.ok(interrupted.every(p => !p.interaction));assert.equal(interrupted[0].activity, 'flee');
  assert.equal(social.memory.values().next().value.rapport, 0, 'an interrupted exchange does not resolve');
});

test('groups cannot claim the same partner, and only the current speaker is overheard', () => {
  const actors = [actor('a'), actor('b', 'neighbor', [1.5, 0, 0]), actor('c', 'neighbor', [3, 0, 0])];
  const social = new StreetSocial();social.update(actors, 8000, clearWorld);
  assert.equal(actors.filter(a => a.interaction).length, 2);
  const life = new CityLife(world, content);life.actors = actors.filter(a => a.interaction);
  life.world = clearWorld;
  const speaker = life.overheard([0, 0, 0], 8000);
  assert.ok(speaker.interaction.speaking);assert.ok(speaker.speech);
});

test('a closer new arrival does not steal an ongoing conversation', () => {
  const a = actor('original-a'), b = actor('original-b', 'neighbor', [3, 0, 0]);
  const newcomer = actor('arrives-first-alphabetically', 'neighbor', [1, 0, 0], { stopStarted: 5, stopEnds: 40 });
  const actors = new StreetSocial().update([newcomer, a, b], 9000, clearWorld);
  assert.equal(a.interaction.partner, b.id);assert.equal(b.interaction.partner, a.id);
  assert.equal(actors[0].interaction, undefined);
});

test('repeated encounters remember rapport, but streaming, clock resets and logout bound local memory', () => {
  const social = new StreetSocial(), a = actor('a'), b = actor('b', 'neighbor', [2, 0, 0]);
  social.update(structuredClone([a, b]), during(a, b, .75), clearWorld);
  a.stopStarted = b.stopStarted = 60;a.stopEnds = b.stopEnds = 100;
  const again = social.update(structuredClone([a, b]), during(a, b, .75), clearWorld);
  assert.equal(again[0].interaction.meetings, 2);assert.equal(again[0].interaction.relationship, 'friendly');
  for (let i = 0; i < 300; i++) {
    const x = actor(`x-${i}`, 'neighbor', [0, 0, 0], { stopStarted: 60, stopEnds: 100 }), y = actor(`y-${i}`, 'neighbor', [2, 0, 0], { stopStarted: 60, stopEnds: 100 });
    social.update([x, y], 70000, clearWorld);
  }
  assert.equal(social.memory.size, 256);
  social.update([], 701000, clearWorld);assert.equal(social.memory.size, 0);
  social.update([a, b], 70000, clearWorld);assert.equal(social.memory.size, 1);
  social.update([], 1000, clearWorld);assert.equal(social.memory.size, 0);
  social.clear();assert.equal(social.lastTime, null);
});

test('live CityLife integration preserves routes and focus while producing real paired exchanges', () => {
  const life = new CityLife(world, content), origin = [0, 0, 32];
  const make = (id, role, position, activity) => life.resident(id, id, role, 'market', 1, createRoutine([{ position, seconds: 40, activity }]));
  life.locals = [make('test-cook', 'cook', origin, 'serve'), make('test-customer', 'customer', [2, 0, 32], 'eat')];
  // Restrict this integration fixture to the pair without constructing city blocks.
  life.travellers = [];life.streetBlocks = [];life.blockResidents = () => [];
  let paired;
  for (let i = 0; i < 40; i++) {
    const actors = life.update(epoch + i * 1000, origin);
    if (actors.some(a => a.interaction)) { paired = actors;break; }
  }
  assert.ok(paired);assert.ok(paired.every(a => a.interaction.kind === 'meal'));
  assert.deepEqual(paired.map(a => a.position).sort(), [origin, [2, 0, 32]].sort());
  const focus = paired[0].id, held = life.update(life.lastTime * 1000 + 50, origin, { focus });
  assert.ok(held.every(a => !a.interaction));assert.equal(held.find(a => a.id === focus).activity, 'talk');
  const detail = life.conversation(held[0], epoch);
  assert.ok(detail.style && detail.demeanor && detail.interest);
  life.clear();assert.equal(life.social.memory.size, 0);
});
