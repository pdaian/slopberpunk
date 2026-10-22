// Display the server's saved objective cursor, including older single-objective saves.
// GPL-3.0-or-later.
import { distance } from './math.js';

export function questView(q, c) {
  const accepted = c.activeQuests[q.id] !== undefined;
  const ready = accepted && c.activeQuests[q.id] >= q.objective.count;
  const stage = c.questStages?.[q.id];
  const staged = Boolean(q.steps?.length && (!accepted || stage));
  const index = stage?.index || 0;
  const step = staged ? q.steps[Math.min(index, q.steps.length - 1)] : q.objective;
  return { accepted, ready, staged, index, step, progress: ready ? step.count : staged ? stage?.progress || 0 : c.activeQuests[q.id] || 0, total: staged ? q.steps.length : 1 };
}

export function questDestination(q, c, data, events = []) {
  const view = questView(q, c);
  if (view.ready) return data.npcs.find(n => n.id === q.giver);
  if (view.step.type === 'event') {
    const event = events.find(e => e.id === view.step.target);
    const definition = data.events.entries.find(e => e.id === view.step.target);
    const controls = event?.phase === 'active' ? event.controls.filter(s => !event.repaired.includes(s.id)) : [];
    return controls.sort((a, b) => distance(c.position, a.position) - distance(c.position, b.position))[0]
      || data.world.landmarks.find(l => l.id === definition?.anchor);
  }
  return data.world.landmarks.find(l => l.id === view.step.target);
}

export function objectiveText(step, data) {
  if (step.text) return step.text;
  const names = { drone: 'orphaned surveyors', warden: 'debt wardens', scavenger: 'wirejacks' };
  const target = data.world.landmarks.find(l => l.id === step.target)?.name || names[step.target] || step.target;
  return `${step.type === 'kill' ? 'Disable' : step.type === 'explore' ? 'Visit' : 'Connect to'} ${target}${step.count > 1 ? ' × ' + step.count : ''}`;
}

// Derive the tutorial from saved progress: reconnecting never resets a chapter.
export function openingGuide(c, data, events = []) {
  const origins = [`${c.faction}-00`, `${c.race}-00`].map(id => data.quests.find(q => q.id === id)).filter(Boolean);
  const unfinished = q => !c.completed.includes(q.id);
  const missing = origins.find(q => unfinished(q) && c.activeQuests[q.id] === undefined);
  const active = origins.filter(unfinished);
  const neighborhood = ['00', '01', '02'].map(n => data.quests.find(q => q.id === `neighborhood-market-${n}`)).filter(Boolean);
  const q = missing || active.find(q => !questView(q, c).ready) || active[0] || neighborhood.find(unfinished);
  if (!q || q.level > c.level || !q.requires.every(id => c.completed.includes(id))) return null;
  const view = questView(q, c), npc = data.npcs.find(n => n.id === q.giver);
  const phase = !view.accepted ? 'offer' : view.ready ? 'return' : `step-${view.staged ? view.index : 'legacy'}`;
  const destination = !view.accepted ? npc : questDestination(q, c, data, events);
  let instruction = !view.accepted ? `Talk to ${npc.name} and accept “${q.title}”.` : view.ready ? `Return to ${npc.name} and complete the contract.` : objectiveText(view.step, data);
  let hint = 'Move with WASD or the left stick. Talk / use: E, controller X, or USE. M opens the map.';
  if (view.accepted && !view.ready) {
    if (view.step.type === 'event') {
      const event = events.find(e => e.id === view.step.target);
      if (!event || ['idle', 'warning', 'failed', 'recovery'].includes(event.phase)) {
        instruction = 'Approach the water meter and wait for the next shutoff response.';
        hint = 'Stay nearby. The response repeats; a missed or failed attempt does not erase your quest steps.';
      } else if (event.controls.some(s => !event.repaired.includes(s.id))) {
        instruction = `Restore ${destination.name} (${event.repaired.length}/${event.controls.length} controls).`;
        hint = 'Follow the marker. E / X / USE restores the control when you are close enough.';
      } else {
        instruction = 'Clear enforcement, then hold the water meter’s 14 m ring for 12 seconds.';
        hint = 'TAB / Y / TARGET selects a machine; 1 / RT fires. H / D-pad up uses a medkit. Other runners can help.';
      }
    } else if (view.step.type === 'hold') hint = `Stay within ${data.rules.interactionRadius} m of the marker for ${view.step.count} seconds. Your progress is saved.`;
    else if (view.step.type === 'explore') hint = 'Walk up to the marked record. The next destination appears as soon as this step is complete.';
    else hint = 'Approach the marker, then press E / X / USE. Complete each step in order; the marker will update.';
  }
  const line = !view.accepted
    ? q.story?.invitation || `Come find me at the marker. I am ${npc.name}; I have work for you.`
    : view.ready ? `That part is done. Come back to me to hand in “${q.title}”.` : view.step.voice || instruction;
  return { key: `${q.id}:${phase}`, quest: q, view, destination, instruction, hint, line, speaker: q.giver, phase };
}
