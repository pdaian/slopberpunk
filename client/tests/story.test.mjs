// In-memory narrative regression checks; no saves, snapshots, or output files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { campaignView, campaignLead, campaignPanel, questThread, storyDialogue, validateStory } from '../src/story.js';
import { openingGuide } from '../src/quests.js';
import { worldEventViews } from '../src/events.js';
import { dungeonPanel } from '../src/dungeons.js';

const data = Object.fromEntries(['rules', 'world', 'races', 'factions', 'quests', 'npcs', 'lore', 'dungeons', 'citylife', 'events'].map(n => [n, JSON.parse(readFileSync(new URL(`../data/${n}.json`, import.meta.url)))]));
const character = (faction = 'relay', race = 'human') => ({ faction, race, level: 0, health: 120, position: [0, 0, 32], activeQuests: {}, completed: [] });
const finish = (c, q) => { c.completed.push(q.id); delete c.activeQuests[q.id]; delete c.questStages?.[q.id]; };
const opening = c => { for (const id of [`${c.faction}-00`, `${c.race}-00`, 'neighborhood-market-00', 'neighborhood-market-01', 'neighborhood-market-02']) finish(c, data.quests.find(q => q.id === id)); };

test('all contracts have a story thread and chapter references work for every origin', () => {
  validateStory(data);
  for (const q of data.quests) {
    const thread = questThread(q, data);
    assert.ok(thread.title && thread.question, q.id);
  }
  for (const mutate of [
    d => { d.lore.campaign.chapters[0].records[0] = 'missing'; },
    d => { d.lore.campaign.chapters[1].records[0] = 'relay-14'; },
    d => { d.lore.campaign.chapters[1].level = 0; },
    d => { delete d.lore.campaign.threads.bloom.orders; },
    d => { delete d.lore.campaign.places['brine-bloom']; },
    d => { d.lore.campaign.places.missing = { title: 'Missing', question: 'No contracts.' }; },
    d => { delete d.dungeons.entries[0].record; }
  ]) {
    const broken = structuredClone(data); mutate(broken);
    assert.throws(() => validateStory(broken), /Invalid Living Record/);
  }
});

test('all sixteen origins can finish the story through reachable contracts without expeditions', () => {
  for (const faction of data.factions) for (const race of data.races) {
    let c = character(faction.id, race.id), previousChapter = 0;
    const seen = new Set();
    for (let i = 0; i < 60; i++) {
      const before = structuredClone(c), state = campaignView(c, data);
      assert.deepEqual(c, before, 'reading the story cannot award or mutate progress');
      assert.ok(state.index >= previousChapter); previousChapter = state.index;
      if (state.complete) break;
      const { quest: q } = state.next;
      assert.ok(!seen.has(q.id), 'the guide must not loop'); seen.add(q.id);
      assert.ok(q.requires.every(id => c.completed.includes(id)), q.id);
      assert.ok(!q.faction || q.faction === c.faction);
      assert.ok(!q.race || q.race === c.race);
      const guide = openingGuide(c, data);
      if (guide) assert.equal(q.id, guide.quest.id, 'journal and opening marker agree');
      c.level = Math.max(c.level, q.level);
      c.activeQuests[q.id] = 0;
      assert.equal(campaignView(c, data).next.quest.id, openingGuide(c, data)?.quest.id || q.id);
      c.activeQuests[q.id] = q.objective.count;
      // Turn-in is still required before a record can be filed.
      assert.ok(!c.completed.includes(q.id));
      finish(c, q);
      c = JSON.parse(JSON.stringify(c));
    }
    assert.equal(campaignView(c, data).complete, true, `${faction.id}/${race.id}`);
    assert.equal(seen.size, 47, '31 faction + 13 lineage + 3 kitchen contracts');
    assert.equal(c.dungeonHistory, undefined, 'group activities never gate the account');
    assert.ok(campaignPanel(c, data).includes(data.lore.campaign.ending));
  }
});

test('level gaps name the next lead without sending players to a locked objective', () => {
  const c = character(); opening(c);
  const lead = campaignLead(c, data);
  assert.equal(lead.next.quest.id, 'relay-01');
  assert.equal(lead.next.locked, true);
  assert.match(lead.instruction, /level 2/);
  assert.match(campaignPanel(c, data), /AVAILABLE QUESTS/);
  assert.doesNotMatch(campaignPanel(c, data), /SHOW NEXT DESTINATION/);
  c.level = 2;
  assert.equal(campaignLead(c, data).next.locked, false);
  assert.match(campaignPanel(c, data), /SHOW NEXT DESTINATION/);
});

test('intermediate contracts leave field notes before a chapter’s milestone reports', () => {
  const c = character(); opening(c); c.level = 5;
  c.completed.push('relay-01', 'human-01');
  const html = campaignPanel(c, data);
  assert.ok(html.includes(data.quests.find(q => q.id === 'relay-01').completion));
  assert.ok(html.includes(data.quests.find(q => q.id === 'human-01').completion));
  assert.ok(!html.includes(data.lore.campaign.chapters[1].resolution));
  assert.equal(campaignView(c, data).chapters[1].complete, false);
});

test('accepted, ready, staged, and legacy records retain authoritative destinations', () => {
  const c = character(), q = data.quests.find(q => q.id === 'relay-00');
  c.completed.push('human-00'); c.activeQuests[q.id] = 0;
  assert.equal(campaignView(c, data).next.destination.id, 'market');
  assert.equal(campaignView(c, data).next.view.staged, false);
  c.questStages = { [q.id]: { index: 1, progress: 0 } };
  const events = worldEventViews(data, [{ id: 'water-lockout', state: { phase: 'active', cycle: 2, deadline: 150, repaired: ['commons-water'], hold: 0, hazard: null } }]);
  assert.equal(campaignView(c, data, events).next.destination.id, 'lantern-kitchen');
  c.activeQuests[q.id] = q.objective.count;
  assert.equal(campaignView(c, data, events).next.destination.id, q.giver);
  assert.equal(campaignView(c, data).chapters[0].complete, false);
  assert.ok(!campaignPanel(c, data).includes(q.completion), 'ready is not completed');
});

test('current field destinations select the basin map even for faction contracts', () => {
  const c = character(); c.level = 60;
  c.completed = data.quests.filter(q => q.faction === c.faction || q.race === c.race || q.neighborhood === 'market').map(q => q.id).filter(id => id !== 'relay-30');
  c.activeQuests['relay-30'] = 0;
  assert.equal(campaignView(c, data).next.region, 'basin');
  assert.match(campaignPanel(c, data), /data-do="map-region" data-id="basin"/);
  c.activeQuests['relay-30'] = 1;
  assert.equal(campaignView(c, data).next.region, 'city', 'turn in at the Commons contact');
});

test('unearned revelations and other characters’ records stay out of the story', () => {
  const c = character(), intro = campaignPanel(c, data);
  for (const chapter of data.lore.campaign.chapters) assert.ok(!intro.includes(chapter.resolution));
  for (const chapter of data.lore.campaign.chapters.slice(1)) assert.ok(!intro.includes(chapter.question));
  for (const d of data.dungeons.entries) assert.ok(!intro.includes(d.record));
  c.completed.push('neighborhood-archive-00');
  let panel = campaignPanel(c, data);
  assert.ok(panel.includes(data.quests.find(q => q.id === 'neighborhood-archive-00').completion));
  assert.ok(!panel.includes(data.quests.find(q => q.id === 'neighborhood-archive-02').completion));
  const d = data.dungeons.entries[0];
  c.dungeonHistory = { [d.id]: { clears: 1, ending: 'repair' } };
  panel = campaignPanel(c, data);
  assert.ok(panel.includes(d.record));
  assert.ok(panel.includes(d.decision.choices.find(choice => choice.id === 'repair').ending));
  assert.ok(!panel.includes(d.decision.choices.find(choice => choice.id === 'name').ending));
  c.dungeonHistory[d.id].ending = 'defer';
  assert.ok(campaignPanel(c, data).includes(d.decision.deferred));
  assert.ok(!campaignPanel(character('choir', 'bloom'), data).includes(d.record));
});

test('NPCs acknowledge saved findings instead of repeating the opening emergency', () => {
  const c = character(), iri = data.npcs.find(n => n.id === 'iri'), oru = data.npcs.find(n => n.id === 'archivist'), nella = data.npcs.find(n => n.id === 'nella');
  assert.equal(storyDialogue(iri, c, data), iri.dialogue);
  c.completed.push('relay-14', 'relay-00', 'human-05', 'lattice-12', 'neighborhood-market-02');
  assert.equal(storyDialogue(iri, c, data), data.quests.find(q => q.id === 'relay-14').completion);
  assert.equal(storyDialogue(oru, c, data), data.quests.find(q => q.id === 'human-05').completion);
  assert.equal(storyDialogue(nella, c, data), data.citylife.neighborhoods[0].stages[3].contactLine);
  assert.equal(storyDialogue(iri, character(), data), iri.dialogue);
});

test('other factions acknowledge the kitchen and the final return reaches Nella and Oru', () => {
  const c = character(), sera = data.npcs.find(n => n.id === 'sera'); opening(c);
  assert.equal(storyDialogue(sera, c, data), sera.afterKitchen);
  const nella = data.npcs.find(n => n.id === 'nella'), oru = data.npcs.find(n => n.id === 'archivist');
  assert.notEqual(storyDialogue(nella, c, data), data.lore.campaign.returnDialogue.nella);
  c.level = 60;
  c.completed = data.quests.filter(q => q.faction === c.faction || q.race === c.race || q.neighborhood === 'market').map(q => q.id);
  const restored = JSON.parse(JSON.stringify(c));
  assert.equal(storyDialogue(nella, restored, data), data.lore.campaign.returnDialogue.nella);
  assert.equal(storyDialogue(oru, restored, data), data.lore.campaign.returnDialogue.archivist);
});

test('expedition findings are hidden before completion and readable with saved endings', () => {
  const c = character(), d = data.dungeons.entries[0];
  assert.ok(!dungeonPanel(data, c, null, 0).includes(d.record));
  c.dungeonHistory = { [d.id]: { clears: 1, ending: 'defer' } };
  const html = dungeonPanel(data, c, null, 0);
  assert.ok(html.includes(d.record)); assert.ok(html.includes(d.decision.deferred));
  const run = { id: 1, dungeon: d.id, chapter: 2, phase: 'complete', ending: 'name', members: [], evidence: [], signed: [] };
  assert.ok(dungeonPanel(data, c, { run }, 0).includes(d.record));
});

test('story presentation escapes content and never renders raw markup from a record', () => {
  const custom = structuredClone(data), c = character(); opening(c);
  custom.lore.campaign.premise = '<img src=x onerror=alert(1)>';
  custom.quests.find(q => q.id === 'neighborhood-market-02').completion = '<script>bad()</script>';
  const html = campaignPanel(c, custom);
  assert.ok(html.includes('&lt;img')); assert.ok(html.includes('&lt;script&gt;'));
  assert.doesNotMatch(html, /<img|<script>/);
});
