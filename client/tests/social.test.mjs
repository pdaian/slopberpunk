// In-memory checks; no browser profile, build output, or saved test files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LiveSocial, SocialFeed, parseChat, gestures } from '../src/live-social.js';
import { gesturePose, motionPose, CharacterMeshes } from '../src/character.js';
import { socialLesson, openingGuide } from '../src/quests.js';
import { Connection } from '../src/network.js';

const context = { id: 'market', name: 'Afterlight Commons', instance: null, nearbyRadius: 35 };
const event = (extra = {}) => ({ type: 'social', id: 'runner:1', requestId: '1', author: 'runner', name: 'Neighbor', channel: 'nearby', body: 'Hello!', gesture: '', zone: 'market', instance: null, created: 1000, ...extra });

test('IME composition does not publish an unfinished message or suppress native composition keys', () => {
  const nodes = new Map(), sent = [];
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, { listeners: new Map(), addEventListener(name, fn) { this.listeners.set(name, fn); } });
    return nodes.get(key);
  };
  const c = new LiveSocial({ root: { querySelector: node, addEventListener() {} } });
  c.submit = action => sent.push(action); c.field.value = 'こんにちは';
  c.field.listeners.get('compositionstart')();
  c.form.listeners.get('submit')({ preventDefault() {} }); assert.equal(sent.length, 0);
  assert.equal(c.field.listeners.has('keydown'), false);
  c.field.listeners.get('compositionend')();
  c.form.listeners.get('submit')({ preventDefault() {} }); assert.equal(sent[0].body, 'こんにちは');
});

test('chat commands validate text and only accept supported audiences and gestures', () => {
  assert.deepEqual(parseChat('  Hello, neighbors!  '), { type: 'chat', channel: 'nearby', body: 'Hello, neighbors!' });
  for (const command of ['s', 'say', 'nearby']) assert.equal(parseChat(`/${command} Hello`, 'zone').channel, 'nearby');
  for (const command of ['z', 'zone', 'ZONE']) assert.equal(parseChat(`/${command} Help at the kitchen!`).channel, 'zone');
  for (const g of gestures) assert.deepEqual(parseChat(`/${g.id}`), { type: 'emote', gesture: g.id });
  assert.equal([...parseChat('🚀'.repeat(280)).body].length, 280);
  for (const text of ['', '   ', 'x'.repeat(281), '🚀'.repeat(281), 'a\nb', 'a\u0000b', 'a\u0085b', '/dance', '/wave someone', '/zone', '/']) assert.throws(() => parseChat(text));
  assert.throws(() => parseChat('Hello', 'guild:123'));
});

test('history and bubbles are bounded, deduplicated, scoped, and expire without replay', () => {
  const feed = new SocialFeed(); feed.setContext(context);
  assert.equal(feed.receive(event(), 1000), true); assert.equal(feed.receive(event(), 2000), false);
  assert.equal(feed.bubble('runner', 8999).body, 'Hello!'); assert.equal(feed.bubble('runner', 9000), null);
  feed.receive(event({ id: 'wave', gesture: 'wave', created: 10000 }), 10000);
  assert.equal(feed.gesture('runner', 13999), 'wave'); assert.equal(feed.gesture('runner', 14000), undefined);
  assert.ok(feed.bubble('runner', 15000), 'gesture text remains readable after the animation');
  feed.receive(event({ id: 'zone', channel: 'zone', created: 16000 }), 16000);
  assert.equal(feed.visible('zone').length, 1);
  assert.equal(feed.bubble('runner', 16000).id, 'wave', 'zone messages never appear over a nearby player');
  feed.setContext({ ...context, id: 'archive' }); assert.equal(feed.visible('zone').length, 0);
  feed.setContext(context); assert.equal(feed.visible('zone').length, 1);
  feed.setContext({ ...context, id: 'expedition', instance: 2 });
  assert.equal(feed.messages.length, 0); assert.equal(feed.bubbles.size, 0);
  feed.receive(event({ id: 'late', instance: 1 }), 20000);
  assert.equal(feed.visible('nearby').length, 0); assert.equal(feed.bubble('runner', 20000), null);
  for (let i = 0; i < 500; i++) feed.receive(event({ id: String(i), author: String(i), created: 30000, instance: 2 }), 30000);
  assert.equal(feed.messages.length, 80); assert.equal(feed.bubbles.size, 64); assert.equal(feed.seen.size, 256);
  feed.reset(); assert.equal(feed.messages.length, 0); assert.equal(feed.seen.size, 0);
});

test('speech bubbles escape player text and respect range, walls, and the camera', () => {
  const feed = new SocialFeed(); feed.setContext(context);
  feed.receive(event({ name: '<img src=x>', body: '<script>bad()</script>' }), 1000);
  const me = { id: 'me', position: [0,0,0] }, other = { id: 'runner', position: [35,0,0] };
  let visible = true, projection = [40,50,.5];
  const world = { lineOfSight: () => visible }, renderer = { project: () => projection };
  const html = () => feed.labels(me, [other], world, renderer, 1000);
  assert.match(html(), /&lt;img/); assert.match(html(), /&lt;script/); assert.doesNotMatch(html(), /<script>|<img/);
  other.position[0] = 35.01; assert.equal(html(), ''); other.position[0] = 20;
  visible = false; assert.equal(html(), ''); visible = true;
  projection = null; assert.equal(html(), ''); projection = [40,50,1.01]; assert.equal(html(), '');
});

test('all gestures produce finite articulated meshes without changing walking legs', () => {
  const models = JSON.parse(readFileSync(new URL('../assets/models.json', import.meta.url)));
  const rig = new CharacterMeshes(models);
  for (const reduced of [false, true]) for (const g of gestures) {
    rig.reducedMotion = reduced;
    const actor = { id: g.id, model: 'humanoid', race: 'human', position: [0,0,0], velocity: [1,0,0], gesture: g.id };
    const pose = rig.pose(actor, 1), vertices = []; rig.draw(vertices, actor, pose, true);
    assert.ok(vertices.length); assert.ok(vertices.every(Number.isFinite));
    const base = motionPose(3, 1, true, 0, 2), original = structuredClone(base);
    gesturePose(base, g.id, reduced ? 0 : 2);
    for (const bone of ['leftThigh','rightThigh','leftShin','rightShin','leftFoot','rightFoot','body']) assert.deepEqual(base[bone], original[bone]);
    assert.notDeepEqual(base, original);
  }
});

function composer(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { activeElement: null } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fields = new Map(), modes = [], sent = [], notices = [];
  const node = key => { if (!fields.has(key)) fields.set(key, { hidden: false, focus() {} }); return fields.get(key); };
  const c = Object.create(LiveSocial.prototype);
  Object.assign(c, { root: { dataset: {}, contains: () => false, querySelector: node }, field: { value: '', focus() {} },
    owner: 'me', character: () => ({ id: c.owner }), drafts: { nearby: '', zone: '' }, channel: 'nearby', pending: null, expanded: false,
    unread: { nearby: 0, zone: 0 }, feed: new SocialFeed(), now: () => 1000, status: { textContent: '' },
    render() {}, onMode: mode => modes.push(mode), toast: text => notices.push(text), send: request => { sent.push(request); return true; } });
  c.feed.setContext(context);
  return { c, sent, modes, notices };
}

test('drafts survive closing and channel switches; confirmation clears only the submitted draft', t => {
  const { c, sent, modes } = composer(t);
  c.open(); c.field.value = 'Hello'; c.open('zone'); c.field.value = 'Kitchen help?'; c.close();
  assert.equal(c.root.querySelector('[data-chat-action="open"]').hidden, false);
  assert.equal(c.root.querySelector('[data-chat-action="close"]').hidden, true);
  c.open('nearby'); assert.equal(c.field.value, 'Hello');
  c.submit(parseChat(c.field.value), true); assert.equal(c.field.value, 'Hello');
  c.receive(event({ author: 'other', requestId: sent[0].requestId })); assert.ok(c.pending, 'another player cannot acknowledge this draft');
  c.receive(event({ id: 'me:ack', author: 'me', requestId: sent[0].requestId }));
  assert.equal(c.pending, null); assert.equal(c.field.value, ''); assert.equal(c.expanded, false);
  c.open('zone'); assert.equal(c.field.value, 'Kitchen help?'); assert.deepEqual(modes.slice(-2), [false, true]);
  c.reset('someone-else'); assert.deepEqual(c.drafts, { nearby: '', zone: '' }); assert.equal(c.feed.messages.length, 0);
});

test('rejections keep drafts and timed-out retries reuse the request instead of duplicating it', t => {
  const { c, sent } = composer(t); c.open(); c.field.value = 'Help!';
  c.submit(parseChat(c.field.value), true); const first = sent[0];
  c.submit(parseChat('Another')); assert.equal(sent.length, 1);
  c.open('zone'); assert.equal(c.channel, 'nearby');
  t.mock.timers.tick(8000); assert.equal(c.retryReady, true);
  c.retry(); assert.strictEqual(sent[1], first); assert.equal(c.retryReady, false);
  c.receive({ type: 'socialError', requestId: first.requestId, text: 'Wait two seconds.' });
  assert.equal(c.pending, null); assert.equal(c.field.value, 'Help!'); assert.equal(c.expanded, true);
  assert.equal(c.status.textContent, 'Wait two seconds.');
  c.send = () => false; c.submit(parseChat(c.field.value), true);
  assert.equal(c.pending, null); assert.equal(c.field.value, 'Help!'); assert.match(c.status.textContent, /disconnected/);
});

test('gesture buttons preserve typed drafts, slash gestures clear them, and zone commands show their destination', t => {
  const { c, sent } = composer(t);
  c.open(); c.field.value = '/zone A draft for later'; c.submit({ type: 'emote', gesture: 'wave' });
  c.receive(event({ id: 'first', author: 'me', gesture: 'wave', requestId: sent.at(-1).requestId }));
  assert.equal(c.field.value, '/zone A draft for later');
  c.open(); c.field.value = '/wave'; c.submit(parseChat(c.field.value), true);
  c.receive(event({ id: 'second', author: 'me', gesture: 'wave', requestId: sent.at(-1).requestId })); assert.equal(c.field.value, '');
  c.open(); c.field.value = '/zone Anyone nearby?'; c.submit(parseChat(c.field.value), true);
  c.receive(event({ id: 'third', author: 'me', channel: 'zone', requestId: sent.at(-1).requestId })); assert.equal(c.channel, 'zone');
  c.receive(event({ id: 'neighbor', channel: 'nearby' })); assert.equal(c.unread.nearby, 1);
  c.open('zone'); assert.equal(c.unread.nearby, 1); c.open('nearby'); assert.equal(c.unread.nearby, 0);
});

test('the optional tutorial resumes saved social lessons without changing contract progression', () => {
  const data = Object.fromEntries(['world','rules','events','quests','npcs'].map(n => [n, JSON.parse(readFileSync(new URL(`../data/${n}.json`, import.meta.url)))]));
  const c = { faction: 'relay', race: 'human', level: 0, position: [0,0,32], activeQuests: {}, completed: [] };
  const initial = openingGuide(c, data);
  assert.equal(initial.social.id, 'gesture');
  c.socialTutorial = { gesture: true }; assert.equal(socialLesson(c).id, 'nearby');
  c.socialTutorial.nearby = true; assert.equal(socialLesson(JSON.parse(JSON.stringify(c))).id, 'zone');
  c.socialTutorial.zone = true;
  const done = openingGuide(c, data); assert.equal(done.social, null);
  assert.equal(initial.quest.id, done.quest.id); assert.equal(initial.key, done.key); assert.equal(initial.destination.id, done.destination.id);
});

test('transport reports unavailable and congested sockets without claiming a send', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: { OPEN: 1 } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'WebSocket', previous); else delete globalThis.WebSocket; });
  const sent = [], c = new Connection('me');
  assert.equal(c.send({ type: 'chat' }), false);
  c.open = true; c.socket = { readyState: 1, bufferedAmount: 32768, send: value => sent.push(JSON.parse(value)) };
  assert.equal(c.send({ type: 'chat' }), false); c.socket.bufferedAmount = 0;
  assert.equal(c.send({ type: 'chat' }), true); assert.equal(sent[0].version, 2);
});
