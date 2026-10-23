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
  return `${step.type === 'kill' ? 'Defeat' : step.type === 'explore' ? 'Visit' : 'Use'} ${target}${step.count > 1 ? ' × ' + step.count : ''}`;
}

export function socialLesson(c) {
  const learned = c.socialTutorial || {};
  if (!learned.gesture) return { id: 'gesture', channel: 'nearby', label: 'TRY A WAVE · B', hint: 'Press B and choose Wave to greet nearby players. You can complete this step even when nobody else is nearby.' };
  if (!learned.nearby) return { id: 'nearby', channel: 'nearby', label: 'SAY HELLO · ENTER', hint: 'Press Enter, choose Nearby, and send a greeting. Players within 35 m can see it above your character.' };
  if (!learned.zone) return { id: 'zone', channel: 'zone', label: 'OPEN ZONE CHAT', hint: 'Choose Zone chat and send “Can someone help me restore the kitchen water?” Players in this area and copy of the world can see it. You do not need a reply to finish this step.' };
  return null;
}

// Derive the tutorial from saved progress: reconnecting never resets a chapter.
export function openingGuide(c, data, events = []) {
  const area = data.world.tutorial;
  const stages = ['move', 'interact', 'combat', 'exit'], index = stages.indexOf(c.tutorialStage);
  if (area && index >= 0) {
    const lessons = [
      { target: area.beacon, type: 'explore', instruction: 'Walk onto the glowing movement marker.', hint: 'Move with WASD, the controller’s left stick, or the touch pad. Hold right mouse and drag, use the right stick, or drag the world to look around.' },
      { target: area.terminal, type: 'interact', instruction: 'Select the training terminal, then use it.', hint: `Click the terminal and press E. Controller: Y selects, X uses. Touch: tap the terminal, then USE. Move within ${data.rules.interactionRadius} m with a clear view.` },
      { target: area.target, type: 'practice', instruction: 'Select the practice target and use Shoot.', hint: 'Click the orange target and press 1. Controller: Y selects, RT shoots. Touch: tap the target, then SHOOT. Shoot costs no energy. This target cannot fight back and gives no rewards.' },
      { target: area.exit, type: 'interact', instruction: 'Use the Commons gate to begin your first quest.', hint: 'Select the green gate and press E. Controller: Y, then X. Touch: tap the gate, then USE. In the Commons, follow the marker to your faction contact. Press J for your story or M for the map.' },
    ];
    const lesson = lessons[index];
    return { key: `tutorial:${c.tutorialStage}`, tutorial: true, chapter: area.name,
      view: { accepted: true, ready: false, index, total: stages.length, step: lesson, progress: 0 },
      destination: data.world.landmarks.find(l => l.id === lesson.target), instruction: lesson.instruction,
      hint: `${lesson.hint} You can leave training at any time through the Commons gate.`,
      line: `${lesson.instruction} ${lesson.hint}`, speaker: 'archivist', phase: c.tutorialStage, social: null };
  }
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
  let instruction = !view.accepted ? `Talk to ${npc.name} and accept “${q.title}”.` : view.ready ? `Return to ${npc.name}. Choose an ending to finish the quest and collect your reward.` : objectiveText(view.step, data);
  let hint = 'Click a person or object, then press E to use it. Controller: Y selects, X uses. Touch: tap a target, then USE. Press M for the map.';
  if (view.accepted && !view.ready) {
    if (view.step.type === 'event') {
      const event = events.find(e => e.id === view.step.target);
      if (!event || ['idle', 'warning', 'failed', 'recovery'].includes(event.phase)) {
        instruction = 'Go to the water meter. Wait there for the water shutoff emergency to start again.';
        hint = 'Stay nearby until the repair controls appear. If you missed or failed the last attempt, you can try again. Completed steps stay saved.';
      } else if (event.controls.some(s => !event.repaired.includes(s.id))) {
        instruction = `Repair ${destination.name}. Controls fixed: ${event.repaired.length}/${event.controls.length}.`;
        hint = 'Go to the marked control and select it. Press E to repair it. Controller: X. Touch: USE.';
      } else {
        instruction = 'Defeat the enemy machines. Stay within the water meter’s marked ring (14 m) for 12 seconds.';
        hint = 'Select a machine and press 1 to shoot; press H for a medkit. Controller: RT shoots, D-pad up heals. Other players can help.';
      }
    } else if (view.step.type === 'hold') hint = `Stay less than ${data.rules.interactionRadius} m from the marker for ${view.step.count} seconds. You do not need to press a button. Your progress is saved.`;
    else if (view.step.type === 'explore') hint = 'Walk up to the marked record. The next destination appears as soon as this step is complete.';
    else hint = 'Go to the marked object and select it. Press E to use it. Controller: X. Touch: USE. The marker then shows your next step.';
  }
  const line = !view.accepted
    ? q.story?.invitation || `Come find me at the marker. I am ${npc.name}; I have work for you.`
    : view.ready ? `The steps are done. Come back to me, choose an ending for “${q.title}”, and collect your reward.` : view.step.voice || instruction;
  const social = socialLesson(c);
  return { key: `${q.id}:${phase}`, quest: q, view, destination, instruction, hint, line, speaker: q.giver, phase, social };
}
