// The Living Record is a reading of saved contracts, never a second progression system.
// GPL-3.0-or-later.
import { escapeHtml as esc } from './icons.js';
import { questView, questDestination, objectiveText, openingGuide } from './quests.js';
import { decisionOutcome, moralRecord, moralNpcDialogue, moralClosing } from './morality.js';

const resolve = (id, c) => id.replace('{faction}', c.faction).replace('{race}', c.race);
const belongs = (q, c) => (!q.faction || q.faction === c.faction) && (!q.race || q.race === c.race);

export function questThread(q, data) {
  const story = data.lore.campaign;
  if (q.neighborhood || q.biome) return story.places[q.neighborhood || q.biome];
  const chapter = story.chapters.find(ch => q.level <= ch.level);
  return { title: chapter.title, question: story.threads[q.faction || q.race][chapter.id] };
}

export function campaignView(c, data, events = []) {
  const story = data.lore.campaign, completed = new Set(c.completed);
  const chapters = story.chapters.map(ch => {
    const records = ch.records.map(id => data.quests.find(q => q.id === resolve(id, c)));
    return { ...ch, records, complete: records.every(q => completed.has(q.id)) };
  });
  const pending = chapters.findIndex(ch => !ch.complete), complete = pending === -1;
  const index = complete ? chapters.length - 1 : pending, chapter = chapters[index];
  // Follow prerequisite chains so a returning or older character is always sent to
  // a reachable contract. An active legacy objective retains its saved meaning.
  const needed = new Set();
  const visit = q => {
    if (!q || completed.has(q.id) || needed.has(q.id) || !belongs(q, c)) return;
    needed.add(q.id);
    for (const id of q.requires) visit(data.quests.find(entry => entry.id === id));
  };
  if (!complete) chapter.records.forEach(visit);
  const candidates = data.quests.filter(q => needed.has(q.id) && (c.activeQuests[q.id] !== undefined || q.requires.every(id => completed.has(id))));
  const rank = q => questView(q, c).ready ? 0 : c.activeQuests[q.id] !== undefined ? 1 : q.level <= c.level ? 2 : 3;
  candidates.sort((a, b) => rank(a) - rank(b) || a.level - b.level || a.id.localeCompare(b.id));
  const q = openingGuide(c, data, events)?.quest || candidates[0], view = q && questView(q, c), npc = q && data.npcs.find(n => n.id === q.giver);
  const next = q ? { quest: q, view, npc, locked: !view.accepted && q.level > c.level, destination: view.accepted ? questDestination(q, c, data, events) : npc } : null;
  if (next) next.region = next.destination && Math.max(Math.abs(next.destination.position[0]), Math.abs(next.destination.position[2])) > data.world.cityRadius ? 'basin' : 'city';
  return { story, chapters, chapter, index, complete, next };
}

export function campaignLead(c, data, events = []) {
  const state = campaignView(c, data, events), next = state.next;
  if (!next) return { ...state, instruction: 'Main story complete. Press J and open Story to read the ending. Nella and Oru have your report at the kitchen.' };
  const { quest: q, view, npc, locked } = next;
  const instruction = locked ? `Continue at level ${q.level}: ${q.title}. Earn XP from available quests, enemies, or Patch’s repeatable jobs to reach that level.`
    : !view.accepted ? `Talk to ${npc.name} and accept “${q.title}”.`
    : view.ready ? `Return to ${npc.name}. Choose an ending for “${q.title}” to collect your reward.`
    : `${q.title} · ${objectiveText(view.step, data)} (${view.progress}/${view.step.count}${view.step.type === 'hold' ? 's' : ''})`;
  return { ...state, instruction };
}

export function campaignPanel(c, data, events = []) {
  const state = campaignLead(c, data, events), { story, chapter, index, complete, next } = state;
  const record = q => `<article class="info-card"><small class="story-chapter">${esc(data.npcs.find(n => n.id === q.giver).name)} · ${esc(q.title)}</small><p>${esc(decisionOutcome(q,c,data))}</p></article>`;
  const chapters = state.chapters.map((ch, i) => {
    if (i > index) return `<p class="muted">CHAPTER ${i + 1} · Finish the current story quests to unlock this chapter.</p>`;
    const filed = ch.records.filter(q => c.completed.includes(q.id));
    const notes = [c.faction, c.race].map(route => data.quests.filter(q => (q.faction === route || q.race === route) && q.level > (state.chapters[i - 1]?.level ?? -1) && q.level <= ch.level && c.completed.includes(q.id)).sort((a, b) => a.level - b.level).at(-1)).filter(q => q && !filed.includes(q));
    return `<details class="neighborhood-entry" data-story-section="chapter:${esc(ch.id)}" ${i === index ? 'open' : ''}><summary tabindex="0">CHAPTER ${i + 1} · ${esc(ch.title)} · ${ch.complete ? 'COMPLETE' : `${filed.length}/${ch.records.length} QUESTS`}</summary><p>${esc(ch.question)}</p>${filed.map(record).join('')}${notes.length ? `<p class="tag">LATEST COMPLETED QUESTS</p>${notes.map(record).join('')}` : ''}${ch.complete ? `<p class="npc-quote">${esc(ch.records.some(q => moralRecord(c,q.id) && moralRecord(c,q.id).choice !== 'uphold') ? 'Your quest choices are saved here, including who benefited, who was hurt, and which promises you made.' : ch.resolution)}</p>` : ch.records.filter(q => !c.completed.includes(q.id)).map(q => `<p class="muted">Awaiting ${esc(data.npcs.find(n => n.id === q.giver).name)}’s report · level ${q.level}+</p>`).join('')}</details>`;
  }).join('');
  const places = Object.entries(story.places).map(([id, place]) => {
    const quests = data.quests.filter(q => q.neighborhood === id || q.biome === id), filed = quests.filter(q => c.completed.includes(q.id)), last = filed.at(-1);
    return `<details class="neighborhood-entry" data-story-section="place:${esc(id)}"><summary tabindex="0">${esc(place.title)} · ${filed.length}/${quests.length}</summary><p>${esc(place.question)}</p>${last ? record(last) : '<p class="muted">No quests completed here yet.</p>'}<button class="small-button" data-do="journal-filter" data-id="${quests[0].biome ? 'basin' : 'neighborhoods'}">FOLLOW THIS LOCAL STORY ↗</button></details>`;
  }).join('');
  const expeditions = data.dungeons.entries.filter(d => c.dungeonHistory?.[d.id]?.clears > 0).map(d => {
    const history = c.dungeonHistory[d.id], ending = d.decision.choices.find(choice => choice.id === history.ending);
    return `<article class="info-card"><h3>${esc(d.name)}</h3><p>${esc(d.record)}</p><p class="npc-quote">${esc(ending?.ending || d.decision.deferred)}</p></article>`;
  }).join('');
  return `<p class="dialog-intro">${esc(story.premise)}</p><article class="info-card"><small class="story-chapter">${complete ? 'MAIN STORY COMPLETE' : `CHAPTER ${index + 1} / ${state.chapters.length}`} · ${esc(chapter.title)}</small><p>${esc(state.instruction)}</p>${next && !next.locked && next.destination ? `<button class="small-button" data-do="map-region" data-id="${next.region}">SHOW NEXT DESTINATION ↗</button>` : next ? `<button class="small-button" data-do="journal-filter" data-id="${next.locked ? 'available' : 'active'}">${next.locked ? 'AVAILABLE QUESTS' : 'ACTIVE QUESTS'} ↗</button>` : ''}</article>${complete ? `<p class="npc-quote">${esc(moralClosing(c,data) || story.ending)}</p>` : ''}<h3>Your investigation</h3>${chapters}<h3>Local stories</h3><p>The kitchen quests are part of the main story. Other local quests and all dungeons are optional. You can finish the main story alone.</p>${places}<h3>Dungeon stories</h3>${expeditions || '<p class="muted">Complete a dungeon to save its story and your group’s latest ending here.</p>'}<button class="small-button" data-do="dungeons">OPEN DUNGEONS ↗</button><p class="panel-description">This page shows your character’s completed quests and dungeon endings. Street emergencies can happen again, but completed quest steps stay saved.</p>`;
}

export function storyDialogue(npc, c, data) {
  const personal = moralNpcDialogue(npc,c,data);
  const closing = data.lore?.campaign?.returnDialogue?.[npc.id];
  if (closing && campaignView(c, data).complete) return [moralClosing(c,data) || closing,personal].filter(Boolean).join(' ');
  const remembered = [...c.completed].reverse().map(id => data.quests.find(q => q.id === id)).find(q => q?.giver === npc.id && moralRecord(c,q.id));
  if (remembered) return [decisionOutcome(remembered,c,data),personal].filter(Boolean).join(' ');
  const neighborhood = data.citylife.neighborhoods.find(n => n.id === npc.neighborhood);
  const stage = neighborhood?.stages.filter(s => s.quest && c.completed.includes(s.quest)).at(-1);
  if (stage) return [stage.contactLine,personal].filter(Boolean).join(' ');
  const latest = data.quests.filter(q => q.giver === npc.id && belongs(q, c) && c.completed.includes(q.id)).sort((a, b) => a.level - b.level || a.id.localeCompare(b.id)).at(-1);
  return [latest?.completion || (c.completed.includes('neighborhood-market-02') && npc.afterKitchen) || npc.dialogue,personal].filter(Boolean).join(' ');
}

export function validateStory(data) {
  const story = data.lore?.campaign, prose = s => typeof s === 'string' && s.trim().length > 0;
  const fail = () => { throw new Error('Invalid Living Record content. Check lore.json and its contract references.'); };
  if (!story || ![story.title, story.premise, story.ending].every(prose) || !Array.isArray(story.chapters) || story.chapters.length !== 5) fail();
  if (![story.returnDialogue?.nella, story.returnDialogue?.archivist].every(prose)) fail();
  for (const faction of data.factions) if (!prose(data.npcs.find(n => n.id === faction.giver)?.afterKitchen)) fail();
  const ids = new Set();
  for (const [i, ch] of story.chapters.entries()) {
    if (!prose(ch.id) || ids.has(ch.id) || ![ch.title, ch.question, ch.resolution].every(prose) || !Number.isInteger(ch.level) || ch.level < 0 || ch.level > data.rules.levelCap || i > 0 && ch.level <= story.chapters[i - 1].level || !Array.isArray(ch.records) || !ch.records.length || ch.records.some(id => !prose(id))) fail();
    ids.add(ch.id);
    for (const faction of data.factions) for (const race of data.races) {
      const c = { faction: faction.id, race: race.id }, resolved = ch.records.map(id => resolve(id, c));
      if (new Set(resolved).size !== resolved.length) fail();
      for (const id of resolved) {
        const q = data.quests.find(q => q.id === id);
        if (!q || !belongs(q, c) || q.level > ch.level) fail();
      }
    }
  }
  if (story.chapters.at(-1).level !== data.rules.levelCap) fail();
  for (const route of [...data.factions, ...data.races]) for (const ch of story.chapters) if (!prose(story.threads?.[route.id]?.[ch.id])) fail();
  for (const id of Object.keys(story.places || {})) if (!data.quests.some(q => q.neighborhood === id || q.biome === id)) fail();
  for (const q of data.quests) {
    if (q.neighborhood || q.biome) {
      const place = story.places?.[q.neighborhood || q.biome];
      if (!place || ![place.title, place.question].every(prose)) fail();
    } else if (!story.threads[q.faction || q.race]) fail();
  }
  for (const d of data.dungeons.entries) if (!prose(d.record)) fail();
  return story;
}
