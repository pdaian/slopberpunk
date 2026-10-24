// In-memory browser API checks. No profiles, caches or output files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { AudioEngine } from '../src/audio.js';
import { escapeHtml } from '../src/icons.js';
import { storyDialogue } from '../src/story.js';
import { inputPrompt, updateInputPrompts } from '../src/input-prompts.js';

const score = JSON.parse(readFileSync(new URL('../data/audio.json', import.meta.url)));
const voice = (name, lang = 'en-US', localService = true) => ({ name, voiceURI: name, lang, localService });
function setup(t, initial = [], options = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const keys = ['speechSynthesis', 'SpeechSynthesisUtterance', 'document', 'AudioContext', 'webkitAudioContext'];
  const saved = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const spoken = [], listeners = new Map(), gestures = new Map();
  let voices = initial, cancels = 0, resumes = 0;
  const synthesis = {
    getVoices: () => voices,
    speak: u => { spoken.push(u); options.speak?.(u); },
    cancel: () => { cancels++; if (options.cancelEvents) spoken.at(-1)?.onerror?.({ error: 'canceled' }); },
    resume: () => { resumes++; synthesis.paused = false; },
    addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key),
    ...options.synthesis,
  };
  const document = {
    hidden: false,
    addEventListener: (key, fn, capture) => { assert.equal(capture, true); gestures.set(key, fn); },
    removeEventListener: (key, fn, capture) => { assert.equal(capture, true); assert.equal(gestures.get(key), fn); gestures.delete(key); },
  };
  const values = {
    speechSynthesis: options.unsupported ? undefined : synthesis,
    SpeechSynthesisUtterance: options.utterance || class { constructor(text) { this.text = text; } },
    document, AudioContext: options.AudioContext, webkitAudioContext: undefined,
  };
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  const audio = new AudioEngine(score), captions = [], statuses = [];
  audio.onCaption = value => captions.push(value); audio.onVoiceStatus = value => statuses.push(value);
  t.after(() => {
    audio.destroy();
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return {
    audio, spoken, captions, statuses, synthesis, listeners, gestures, document,
    get cancels() { return cancels; }, get resumes() { return resumes; },
    load(value, notify = true) { voices = value; if (notify) (listeners.get('voiceschanged') || synthesis.onvoiceschanged)?.(); },
    gesture(type = 'click', event = {}) { gestures.get(type)?.({ isTrusted: true, ...event }); },
  };
}

function reject(fixture, t, error = 'voice-unavailable') {
  fixture.spoken.at(-1).onerror({ error }); t.mock.timers.tick(0);
}

test('opening characters retain distinct performances with one installed voice', t => {
  const { audio, spoken } = setup(t, [voice('Local')]);
  for (const id of ['iri', 'sera', 'bram', 'ves', 'archivist', 'nella']) assert.equal(audio.speak('The kitchen needs water.', id), true);
  assert.equal(new Set(spoken.map(u => `${u.rate}:${u.pitch}`)).size, 6);
  for (const u of spoken) assert.equal(u.voice.name, 'Local');
});

test('local English voices are preferred and slots survive browser reordering', t => {
  const a = voice('Alpha'), b = voice('Beta');
  const { audio, spoken, load } = setup(t, [voice('Cloud', 'en-US', false), b, voice('French', 'fr-FR'), a]);
  audio.speak('Hello.', 'iri'); load([a, b]); audio.speak('Hello again.', 'iri');
  assert.equal(spoken[0].voice, spoken[1].voice); assert.equal(spoken[0].voice, b);
});

test('remote English voices work when no local English voice is exposed', t => {
  const remote = voice('Browser English', 'en-GB', false);
  const { audio, spoken } = setup(t, [voice('French', 'fr-FR'), remote]);
  assert.equal(audio.speak('Welcome.', 'ves'), true);
  assert.equal(spoken[0].voice, remote); assert.equal(spoken[0].lang, 'en-GB');
  spoken[0].onstart(); assert.equal(audio.voiceStatus, 'speaking');
});

test('empty enumeration still tries the browser English default', t => {
  const { audio, spoken } = setup(t);
  assert.equal(audio.speak('Welcome.'), true);
  assert.equal(spoken[0].voice, undefined); assert.equal(spoken[0].lang, 'en-US');
  spoken[0].onstart(); spoken[0].onend(); assert.equal(audio.voiceStatus, 'ready');
});

test('a non-English list or throwing getVoices does not prevent an English default attempt', t => {
  const { audio, spoken, synthesis } = setup(t, [voice('French', 'fr-FR')]);
  audio.speak('First.'); synthesis.getVoices = () => { throw new Error('Unavailable'); };
  assert.doesNotThrow(() => audio.speak('Second.'));
  assert.ok(spoken.every(u => !u.voice && u.lang === 'en-US'));
});

test('delayed discovery speaks only the current line and keeps its full caption', t => {
  const f = setup(t);
  f.audio.speak('First.', 'iri'); reject(f, t);
  f.audio.speak('Current.', 'bram'); reject(f, t);
  assert.equal(f.audio.voiceStatus, 'loading'); f.load([voice('Installed')]);
  assert.equal(f.spoken.length, 3); assert.equal(f.spoken[2].text, 'Current.');
  assert.equal(f.spoken[2].voice.name, 'Installed');
  assert.deepEqual(f.captions.at(-1), { speaker: 'Bram Cinder', text: 'Current.' });
});

test('bounded polling finds voices even without a voiceschanged event', t => {
  const f = setup(t); f.audio.speak('Hello.'); reject(f, t, 'synthesis-unavailable');
  f.load([voice('Installed')], false); t.mock.timers.tick(250);
  assert.equal(f.spoken.length, 2); assert.equal(f.spoken[1].voice.name, 'Installed');
});

test('voice discovery stops after five seconds and cannot resurrect expired dialogue', t => {
  const f = setup(t); f.audio.speak('Hello.'); reject(f, t);
  for (let i = 0; i < 20; i++) t.mock.timers.tick(250);
  assert.equal(f.audio.voiceStatus, 'unavailable'); assert.equal(f.audio.line, null);
  f.load([voice('Too late')]); t.mock.timers.tick(60000); assert.equal(f.spoken.length, 1);
});

test('legacy voice events preserve and restore the previous handler', t => {
  let calls = 0; const previous = () => calls++;
  const f = setup(t, [], { synthesis: { addEventListener: undefined, removeEventListener: undefined, onvoiceschanged: previous } });
  f.audio.speak('Hello.'); reject(f, t); f.load([voice('Installed')]);
  assert.equal(calls, 1); assert.equal(f.spoken.length, 2);
  f.audio.destroy(); assert.equal(f.synthesis.onvoiceschanged, previous);
});

test('voice discovery never interrupts an utterance already playing', t => {
  const remote = voice('Cloud', 'en-US', false), f = setup(t, [remote]);
  f.audio.speak('The kitchen needs water. '.repeat(12)); f.spoken[0].onstart(); f.load([voice('Local'), remote]);
  assert.equal(f.spoken.length, 1); assert.equal(f.audio.utterance, f.spoken[0]);
  f.spoken[0].onend(); assert.equal(f.spoken[1].voice, remote, 'the same voice continues across chunks');
});

test('trusted click, touch and key gestures unlock speech before Web Audio resumes', t => {
  const context = { state: 'suspended', resume: () => new Promise(() => {}), close() {} };
  const f = setup(t, [voice('Local')], { AudioContext: class { constructor() { return context; } } });
  f.gesture('click', { isTrusted: false }); f.gesture('keydown', { repeat: true }); assert.equal(f.spoken.length, 0);
  for (const type of ['click', 'touchend', 'keydown']) {
    f.gesture(type); assert.equal(f.spoken.at(-1).volume, 0); assert.equal(f.spoken.at(-1).voice.name, 'Local');
    f.spoken.at(-1).onerror();
  }
  assert.equal(f.spoken.length, 3); assert.equal(f.audio.context, context);
});

test('Web Audio failure does not prevent speech unlocking or narration', async t => {
  const f = setup(t, [voice('Local')], { AudioContext: class { constructor() { throw new Error('Denied'); } } });
  await assert.rejects(f.audio.unlock(), /Denied/); assert.equal(f.spoken.length, 1);
  f.audio.speak('Still available.'); assert.equal(f.spoken[1].text, 'Still available.');
});

test('autoplay denial waits for a real gesture instead of retrying on timers', t => {
  const f = setup(t, [voice('Local')]); f.audio.speak('Current.', 'bram'); reject(f, t, 'not-allowed');
  assert.equal(f.audio.voiceStatus, 'blocked'); assert.equal(f.audio.speaking, false);
  t.mock.timers.tick(1000); f.gesture('click', { isTrusted: false });
  f.document.hidden = true; f.gesture(); f.document.hidden = false; assert.equal(f.spoken.length, 1);
  f.gesture('touchend'); assert.equal(f.spoken.length, 2); assert.equal(f.spoken[1].text, 'Current.');
  f.spoken[1].onstart(); assert.equal(f.audio.voiceStatus, 'speaking');
});

test('expired autoplay-blocked lines are not replayed on a later gesture', t => {
  const f = setup(t, [voice('Local')]); f.audio.speak('Expired.'); reject(f, t, 'not-allowed');
  t.mock.timers.tick(8000); f.gesture();
  assert.equal(f.spoken.filter(u => u.text === 'Expired.').length, 1);
});

test('muting cancels speech and retries while retaining readable captions', t => {
  const f = setup(t); f.audio.speak('Still readable.', 'ves'); reject(f, t);
  f.audio.narration = false; f.load([voice('Installed')]); f.gesture(); t.mock.timers.tick(250);
  assert.equal(f.spoken.length, 1); assert.equal(f.audio.voiceStatus, 'muted');
  assert.equal(f.captions.at(-1).text, 'Still readable.');
  assert.equal(f.audio.speak('Muted dialogue.', 'ves'), false); assert.equal(f.captions.at(-1).text, 'Muted dialogue.');
});

test('dismissing a line cancels discovery, queued retries and stale callbacks', t => {
  const f = setup(t); f.audio.speak('Dismissed.'); reject(f, t);
  f.audio.stopVoice(); f.load([voice('Installed')]); t.mock.timers.tick(10000);
  f.spoken[0].onstart(); f.spoken[0].onend(); f.spoken[0].onerror({ error: 'not-allowed' });
  assert.equal(f.spoken.length, 1); assert.equal(f.captions.at(-1), null); assert.equal(f.audio.voiceStatus, 'ready');
});

test('hiding the page cancels narration and ignores new background dialogue', t => {
  const f = setup(t, [voice('Local')]); f.audio.speak('Visible.'); f.spoken[0].onstart();
  f.document.hidden = true; f.gestures.get('visibilitychange')();
  assert.equal(f.audio.utterance, null); assert.equal(f.cancels, 1);
  assert.equal(f.audio.speak('Background.'), false); f.load([voice('Another')]);
  f.document.hidden = false; f.gestures.get('visibilitychange')(); t.mock.timers.tick(10000);
  assert.equal(f.spoken.length, 1);
});

test('synchronous cancellation events and old utterances cannot change the current line', t => {
  const f = setup(t, [voice('Local')], { cancelEvents: true });
  f.audio.speak('First.', 'iri'); f.audio.speak('Second.', 'archivist'); f.spoken[1].onstart();
  f.spoken[0].onend(); f.spoken[0].onstart(); f.spoken[0].onerror({ error: 'not-allowed' }); t.mock.timers.tick(5000);
  assert.equal(f.audio.utterance, f.spoken[1]); assert.equal(f.audio.voiceStatus, 'speaking');
  assert.equal(f.captions.at(-1).speaker, 'Oru'); assert.equal(f.spoken.length, 2);
});

test('long dialogue plays all chunks in order with a complete, persistent caption', t => {
  const f = setup(t, [voice('Local')]);
  const text = 'The kitchen needs water. Follow the marked route and bring the records home. '.repeat(8).trim();
  f.audio.speak(text, 'bram'); let index = 0;
  while (f.audio.utterance) {
    const u = f.spoken[index++]; assert.ok(u.text.length <= 180);
    u.onstart(); t.mock.timers.tick(9000); assert.equal(f.captions.at(-1).text, text); u.onend();
    assert.ok(index < 20, 'playback must finish');
  }
  assert.equal(f.spoken.map(u => u.text).join(' '), text);
  assert.ok(f.spoken.length > 1); assert.equal(f.audio.voiceStatus, 'ready');
  t.mock.timers.tick(1500); assert.equal(f.captions.at(-1), null);
});

test('long words are bounded without splitting surrogate pairs or losing text', t => {
  const f = setup(t, [voice('Local')]); const text = 'a'.repeat(179) + '🌆' + 'b'.repeat(190);
  f.audio.speak(text); while (f.audio.utterance) f.audio.utterance.onend();
  assert.equal(f.spoken.map(u => u.text).join(''), text);
  assert.ok(f.spoken.every(u => u.text.length <= 180 && !/[\uD800-\uDBFF]$/.test(u.text)));
});

test('paused native speech resumes without pausing Android voices', t => {
  const f = setup(t, [voice('Local')], { synthesis: { paused: true } });
  f.audio.speak('Hello.'); assert.equal(f.resumes, 1); assert.equal(f.spoken.length, 1);
});

test('a failing local voice falls back to a browser voice, then the English default', t => {
  const f = setup(t, [voice('Alpha'), voice('Beta'), voice('Gamma'), voice('Cloud', 'en-GB', false)]);
  f.audio.speak('Hello.'); reject(f, t); assert.equal(f.spoken[1].voice.name, 'Cloud');
  reject(f, t, 'network'); assert.equal(f.spoken[2].voice, undefined); assert.equal(f.spoken[2].lang, 'en-US');
  f.spoken[2].onstart(); f.spoken[2].onend(); assert.equal(f.audio.voiceStatus, 'ready');
});

test('a silent native engine has bounded startup retries and cannot lock guidance', t => {
  const f = setup(t, [voice('Alpha'), voice('Beta')]); f.audio.speak('Hello.');
  for (let i = 0; i < 3; i++) { t.mock.timers.tick(5000); t.mock.timers.tick(0); }
  assert.equal(f.spoken.length, 3); assert.equal(f.audio.speaking, false); assert.equal(f.audio.voiceStatus, 'error');
  t.mock.timers.tick(60000); assert.equal(f.spoken.length, 3);
});

test('a missing end event times out instead of leaving the story guide busy forever', t => {
  const f = setup(t, [voice('Local')]); f.audio.speak('Hello.'); f.spoken[0].onstart();
  t.mock.timers.tick(30000); t.mock.timers.tick(0); assert.equal(f.spoken.length, 2); assert.equal(f.spoken[1].voice, undefined);
  f.spoken[1].onstart(); f.spoken[1].onend(); assert.equal(f.audio.speaking, false);
});

test('throwing native speak is bounded and leaves captions visible', t => {
  const f = setup(t, [voice('Alpha'), voice('Beta')], { speak() { throw new Error('Unavailable'); } });
  assert.doesNotThrow(() => f.audio.speak('Still readable.')); t.mock.timers.tick(0);
  assert.equal(f.spoken.length, 3); assert.equal(f.audio.voiceStatus, 'error'); assert.equal(f.captions.at(-1).text, 'Still readable.');
});

test('throwing utterance constructors cannot cause an unbounded retry loop', t => {
  let attempts = 0;
  const f = setup(t, [voice('Alpha'), voice('Beta')], { utterance: class { constructor() { attempts++; throw new Error('Unavailable'); } } });
  assert.doesNotThrow(() => f.audio.speak('Still readable.')); t.mock.timers.tick(0);
  assert.equal(attempts, 3); assert.equal(f.audio.voiceStatus, 'error');
});

test('browsers without speech retain captions and report the actual limitation', t => {
  const f = setup(t, [], { unsupported: true }); assert.equal(f.audio.speak('You have a place here.', 'ves'), false);
  assert.equal(f.audio.voiceStatus, 'unsupported'); assert.match(f.audio.voiceMessage, /does not provide speech/);
  assert.deepEqual(f.captions.at(-1), { speaker: 'Ves of the Quiet', text: 'You have a place here.' });
});

test('destroy removes every listener and timer and forbids later playback', async t => {
  const f = setup(t); f.audio.speak('Disposed.'); reject(f, t);
  f.audio.destroy(); f.audio.destroy(); f.load([voice('Too late')]); t.mock.timers.tick(60000);
  await f.audio.unlock(); assert.equal(f.audio.speak('Too late.'), false);
  assert.equal(f.spoken.length, 1); assert.equal(f.listeners.size, 0); assert.equal(f.gestures.size, 0);
});

// Exercise the real application handlers without creating a browser profile.
function application(audio) {
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      listeners: new Map(), open: false, checked: true, textContent: '', innerHTML: '', dataset: {}, querySelectorAll: () => [],
      addEventListener(key, fn) { this.listeners.set(key, fn); }, setAttribute() {},
      showModal() { this.open = true; }, close() { this.open = false; }, focus() { context.document.activeElement = this; },
    });
    return nodes.get(selector);
  };
  const context = {
    fixtureAudio: audio, esc: escapeHtml, storyDialogue, inputPrompt, updateInputPrompts, setTimeout, clearTimeout,
    document: { querySelector: node, querySelectorAll: () => [], addEventListener() {}, exitPointerLock() {} },
    window: { addEventListener() {} }, matchMedia: () => ({ matches: false }), WorldClock: class {},
  };
  let source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8').replace(/^import .*;$/gm, '');
  source = source.slice(0, source.lastIndexOf('boot().catch'));
  runInNewContext(source + `
    audio=fixtureAudio;input={clear(){}};renderer={quality:1,volumetric:true};
    simulation={character:{completed:[]}};state='playing';cityLife={neighborhoods:new Map()};
    data={citylife:{neighborhoods:[]},quests:[{id:'quest',briefing:'Read the record.',completion:'The record is safe.',giver:'iri'}],npcs:[{id:'iri',dialogue:'Welcome to the kitchen.'}]};
    currentGuide={line:'Follow the marker.',speaker:'bram'};
    wireEvents();audio.onVoiceStatus=()=>updateVoiceButton();
    globalThis.harness={showSettings,closePanel};`, context);
  return {
    ...context.harness, node,
    click(action, id) { return node('#dialog-content').listeners.get('click')({ target: { closest: () => ({ dataset: { do: action, id } }) } }); },
    change(target) { return node('#dialog-content').listeners.get('change')({ target }); },
  };
}

test('settings test and all replay controls enable speech even after muting', async t => {
  const f = setup(t, [voice('Local')]), app = application(f.audio);
  f.audio.speak('Previous scene.'); f.spoken[0].onstart();
  app.showSettings(); assert.match(app.node('#dialog-content').innerHTML, /data-do="test-voice"/);
  assert.match(app.node('#dialog-content').innerHTML, /id="voice-status" role="status"/);
  assert.equal(f.audio.utterance, null); assert.equal(app.node('#voice-status').textContent, f.audio.voiceMessage);
  for (const [action, id, expected] of [
    ['test-voice', undefined, 'Welcome to Vesper. Character voices are ready.'],
    ['quest-voice', 'quest', 'Read the record.'], ['speak', 'iri', 'Welcome to the kitchen.'],
  ]) {
    f.audio.narration = false; await app.click(action, id);
    assert.equal(f.audio.narration, true); assert.equal(f.spoken.at(-1).text, expected);
    assert.equal(app.node('#setting-voice').checked, true);
    f.spoken.at(-1).onstart(); assert.equal(app.node('#voice-status').textContent, 'Playing character voice.');
  }
  f.audio.narration = false; app.node('#repeat-guidance').onclick();
  assert.equal(f.spoken.at(-1).text, 'Follow the marker.'); assert.equal(f.audio.narration, true);
});

test('gesture-time status updates do not undo the settings checkbox before change fires', async t => {
  const f = setup(t, [voice('Local')]), app = application(f.audio);
  f.audio.speak('Playing.'); f.spoken[0].onstart();
  const checkbox = app.node('#setting-voice'); checkbox.id = 'setting-voice'; checkbox.checked = false;
  f.gesture(); assert.equal(checkbox.checked, false);
  await app.change(checkbox);
  assert.equal(f.audio.narration, false); assert.equal(f.audio.utterance, null);
  assert.equal(app.node('#voice-status').textContent, 'Character voices are muted. Captions remain available.');
});

test('closing a dialogue cancels pending replay and keeps later voices from restarting it', async t => {
  const f = setup(t), app = application(f.audio);
  await app.click('quest-voice', 'quest'); reject(f, t);
  const attempts = f.spoken.length; app.closePanel(); f.load([voice('Installed')]); t.mock.timers.tick(10000);
  assert.equal(f.spoken.length, attempts); assert.equal(f.audio.line, null);
});
