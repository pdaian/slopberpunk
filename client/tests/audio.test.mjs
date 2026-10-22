import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AudioEngine } from '../src/audio.js';

const score = JSON.parse(readFileSync(new URL('../data/audio.json', import.meta.url)));
const voice = (name, lang = 'en-US', localService = true) => ({ name, voiceURI: name, lang, localService });
function setup(t, initial = []) {
  const saved = { speech: globalThis.speechSynthesis, utterance: globalThis.SpeechSynthesisUtterance };
  const spoken = [], listeners = new Map(); let voices = initial;
  globalThis.speechSynthesis = {
    getVoices: () => voices, speak: u => spoken.push(u), cancel: () => {},
    addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key),
  };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  const audio = new AudioEngine(score), captions = [];
  audio.onCaption = value => captions.push(value);
  t.after(() => { audio.destroy(); globalThis.speechSynthesis = saved.speech; globalThis.SpeechSynthesisUtterance = saved.utterance; });
  return { audio, spoken, captions, load: value => { voices = value; listeners.get('voiceschanged')?.(); } };
}

test('opening characters have distinct, stable performances even with one installed voice', t => {
  const { audio, spoken } = setup(t, [voice('Local')]);
  const ids = ['iri', 'sera', 'bram', 'ves', 'archivist', 'nella'];
  for (const id of ids) assert.equal(audio.speak('The kitchen needs water.', id), true);
  assert.equal(new Set(spoken.map(u => `${u.rate}:${u.pitch}`)).size, ids.length);
  for (const u of spoken) assert.equal(u.voice.name, 'Local');
});

test('voice selection is local, English, and stable when the browser reorders voices', t => {
  const a = voice('Alpha'), b = voice('Beta');
  const { audio, spoken, load } = setup(t, [voice('Cloud', 'en-US', false), b, voice('French', 'fr-FR'), a]);
  audio.speak('Hello.', 'iri');
  load([a, b]); audio.speak('Hello again.', 'iri');
  assert.equal(spoken[0].voice, spoken[1].voice);
  assert.equal(spoken[0].voice, b);
});

test('missing local voices retain captions and late discovery speaks only the current line', t => {
  const { audio, spoken, captions, load } = setup(t, [voice('Remote', 'en-US', false)]);
  assert.equal(audio.speak('First.', 'iri'), false);
  assert.equal(audio.speak('Current.', 'bram'), false);
  assert.deepEqual(captions.at(-1), { speaker: 'Bram Cinder', text: 'Current.' });
  load([voice('Installed')]);
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, 'Current.');
});

test('muting or dismissing speech prevents late discovery from replaying dismissed dialogue', t => {
  const { audio, spoken, captions, load } = setup(t);
  audio.speak('Dismissed.', 'sera'); audio.stopVoice();
  load([voice('Installed')]);
  assert.equal(spoken.length, 0);
  audio.narration = false;
  assert.equal(audio.speak('Still readable.', 'ves'), false);
  assert.equal(spoken.length, 0);
  assert.equal(captions.at(-1).text, 'Still readable.');
});

test('ending an interrupted utterance cannot clear the current speaker', t => {
  const { audio, spoken, captions } = setup(t, [voice('Installed')]);
  audio.speak('First.', 'iri'); audio.speak('Second.', 'archivist');
  spoken[0].onend();
  assert.equal(audio.utterance, spoken[1]);
  assert.equal(captions.at(-1).speaker, 'Oru');
});

test('browsers without speech synthesis still display attributed captions', t => {
  const { audio, captions } = setup(t);
  delete globalThis.speechSynthesis;
  delete globalThis.SpeechSynthesisUtterance;
  assert.equal(audio.speak('You have a place here.', 'ves'), false);
  assert.deepEqual(captions.at(-1), { speaker: 'Ves of the Quiet', text: 'You have a place here.' });
});
