// Display the server's saved objective cursor, including older single-objective saves.
// GPL-3.0-or-later.
import { distance } from './math.js';
import { inputText } from './input-prompts.js';

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
  if (!view.accepted || view.ready) return data.npcs.find(n => n.id === q.giver);
  if (view.step.type === 'event') {
    const event = events.find(e => e.id === view.step.target);
    const definition = data.events.entries.find(e => e.id === view.step.target);
    const controls = event?.phase === 'active' ? event.controls.filter(s => !event.repaired.includes(s.id)) : [];
    return controls.sort((a, b) => distance(c.position, a.position) - distance(c.position, b.position))[0]
      || data.world.landmarks.find(l => l.id === definition?.anchor);
  }
  if (view.step.type === 'kill') {
    const level = Math.min(q.level, c.level ?? q.level);
    const spawn = data.world.enemySpawns.filter(s => s.type === view.step.target && s.level <= level)
      .sort((a, b) => b.level - a.level || distance(c.position, a.position) - distance(c.position, b.position))[0];
    if (spawn) return { ...spawn, name: `${enemyName(view.step.target, data)} patrols` };
  }
  return data.world.landmarks.find(l => l.id === view.step.target);
}

const enemyName = (id, data) => data.enemies?.find(e => e.id === id)?.name || ({ drone: 'Orphaned surveyor', warden: 'Debt warden', scavenger: 'Wirejack' })[id] || id;

export function objectiveText(step, data) {
  if (step.text) return step.text;
  if (step.type === 'kill') return `Defeat ${step.count} ${enemyName(step.target, data)}${step.count === 1 ? '' : 's'}.`;
  const target = data.world.landmarks.find(l => l.id === step.target)?.name || step.target;
  return `${step.type === 'explore' ? 'Visit' : 'Use'} ${target}.`;
}

// Place descriptions work in the journal, tracker and map without a quest pin.
export function placeInfo(place, data) {
  if (!place) return null;
  const p = place.position, world = data.world;
  const flatDistance = center => Math.hypot(p[0] - center[0], p[2] - center[2]);
  const training = world.tutorial && p[1] < 5 && flatDistance(world.tutorial.center) <= world.tutorial.radius;
  const biome = world.biomes.find(b => flatDistance(b.center) <= b.radius);
  const district = world.districts.find(d => d.id !== 'basin' && flatDistance(d.center) <= d.radius);
  const region = Math.max(Math.abs(p[0]), Math.abs(p[2])) > world.cityRadius ? 'basin' : 'city';
  const area = training ? world.tutorial.name : biome?.name || district?.name || (region === 'city' ? 'Vesper' : 'Pale Basin');
  const center = training ? world.tutorial.center : biome?.center || district?.center || [0, 0, 0];
  const directions = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  const direction = directions[(Math.round(Math.atan2(p[0] - center[0], center[2] - p[2]) / (Math.PI / 4)) + 8) % 8];
  const vicinity = flatDistance(center) < 20 ? 'Near the center' : `On the ${direction} side`;
  const access = p[1] === 24 && district?.id === 'skybridge'
    ? 'On the lower skyway, 24 m above the street. Take the Transit lift to its first upper stop, or walk up the Night crew ramp from the north.'
    : p[1] > 5 ? `${Math.round(p[1])} m above street level; use the nearby stairs or lift.` : 'At street level.';
  return { area, region, description: place.location || `${vicinity} of ${area}.`, access };
}

export function questProgressText(view) {
  if (!view?.accepted || view.ready || !(view.step.count > 1)) return '';
  return `${view.progress}/${view.step.count}${view.step.type === 'hold' ? ' seconds' : ' defeated'}`;
}

export function questGuide(q, c, data, events = [], device = 'keyboard') {
  const view = questView(q, c), npc = data.npcs.find(n => n.id === q.giver);
  const missing = q.requires.filter(id => !c.completed.includes(id));
  const locked = !view.accepted && (q.level > c.level || missing.length > 0);
  const phase = locked ? 'locked' : !view.accepted ? 'offer' : view.ready ? 'return' : `step-${view.staged ? view.index : 'legacy'}`;
  const destination = locked ? null : questDestination(q, c, data, events);
  const use = inputText(device, 'Click it, then press E.', 'Press Y to select it, then X.', 'Tap it, then USE.');
  const shoot = inputText(device, 'Select an enemy and press 1 to shoot.', 'Press Y to select an enemy, then RT to shoot.', 'Tap an enemy, then SHOOT.');
  let instruction = locked
    ? `${q.level > c.level ? `Reach level ${q.level}` : ''}${q.level > c.level && missing.length ? ' and finish ' : missing.length ? 'Finish ' : ''}${missing.map(id => data.quests.find(prior => prior.id === id)?.title || id).join(', ')} to continue.`
    : !view.accepted ? `Talk to ${npc.name} about “${q.title}”.`
    : view.ready ? `Return to ${npc.name} and choose an ending to collect your reward.` : objectiveText(view.step, data);
  let hint = locked ? missing.length ? 'Complete the earlier quests in this story first. Find them in the journal.' : 'Find available quests or take a repeatable job from Patch to earn XP.'
    : !view.accepted || view.ready ? inputText(device, 'Click the contact, then press E to talk.', 'Press Y to select the contact, then X to talk.', 'Tap the contact, then USE to talk.') + (!view.accepted ? ' Choose ACCEPT QUEST to begin.' : ' Each ending gives the full quest XP; gold and consequences depend on your choice.')
    : `Get within ${data.rules.interactionRadius} m with a clear view. ${use}`;
  if (view.accepted && !view.ready) {
    if (view.step.type === 'event') {
      const event = events.find(e => e.id === view.step.target);
      const definition = data.events.entries.find(e => e.id === view.step.target);
      const anchor = data.world.landmarks.find(l => l.id === definition.anchor);
      if (event?.phase !== 'active') {
        instruction = event?.phase === 'warning' ? `Prepare to restore service at ${anchor.name}.`
          : event?.phase === 'failed' || event?.phase === 'recovery' ? `Wait near ${anchor.name} for the next repair attempt.` : `Go to ${anchor.name} to help restore service.`;
        hint = `Approach within ${data.events.rules.triggerRadius} m and wait for the controls to become available. Completed steps stay saved.`;
      } else if (event.controls.some(s => !event.repaired.includes(s.id))) {
        instruction = `Repair ${destination.name}. ${event.repaired.length}/${event.controls.length} controls restored.`;
        hint = `${use} Repair both controls, then stay near ${anchor.name}.`;
      } else {
        instruction = `${definition.enemy ? 'Defeat the enemy machines, then stay' : 'Stay'} near ${anchor.name} until service returns.`;
        hint = `Stay within ${data.events.rules.radius} m for ${data.events.rules.holdSeconds} seconds (${Math.floor(event.hold || 0)}/${data.events.rules.holdSeconds}). ${definition.enemy ? shoot + ' ' : ''}Avoid striped danger areas. Other players can help.`;
      }
    } else if (view.step.type === 'hold') hint = `Stay within ${data.rules.interactionRadius} m of ${destination.name} with a clear view for ${view.step.count} seconds. Progress is automatic and stays saved.`;
    else if (view.step.type === 'explore') hint = `Walk within ${data.rules.interactionRadius} m of ${destination.name} with a clear view. This step completes automatically.`;
    else if (view.step.type === 'kill') hint = `${shoot} Any ${enemyName(view.step.target, data)} counts. If the area is clear, patrols return after a short wait.`;
  }
  return { key: `${q.id}:${phase}`, quest: q, view, locked, destination, instruction, hint,
    line: `${instruction} ${destination ? placeInfo(destination, data).description : hint}`, speaker: q.giver, phase };
}

// Following a local story continues into its next contract after handover.
export function followedQuest(id, c, data) {
  let q = data.quests.find(q => q.id === id);
  const seen = new Set();
  while (q && c.completed.includes(q.id) && !seen.has(q.id)) {
    seen.add(q.id);
    q = data.quests.find(next => next.requires.includes(q.id) && (!next.faction || next.faction === c.faction) && (!next.race || next.race === c.race));
  }
  return q && !seen.has(q.id) && (!q.faction || q.faction === c.faction) && (!q.race || q.race === c.race) ? q : null;
}

export function socialLesson(c, device = 'keyboard') {
  const learned = c.socialTutorial || {};
  if (!learned.gesture) return { id: 'gesture', channel: 'nearby', label: inputText(device,'TRY A WAVE · B','TRY A WAVE','TRY A WAVE'), hint: inputText(device,'Press B and choose Wave','Choose TRY A WAVE, then Wave','Tap TRY A WAVE, then Wave')+' to greet nearby players. You can complete this step even when nobody else is nearby.' };
  if (!learned.nearby) return { id: 'nearby', channel: 'nearby', label: inputText(device,'SAY HELLO · ENTER','SAY HELLO','SAY HELLO'), hint: inputText(device,'Press Enter','Choose SAY HELLO','Tap SAY HELLO')+', choose Nearby, and send a greeting. Players within 35 m can see it above your character.' };
  if (!learned.zone) return { id: 'zone', channel: 'zone', label: 'OPEN ZONE CHAT', hint: 'Choose Zone chat and send “Can someone help me restore the kitchen water?” Players in this area and copy of the world can see it. You do not need a reply to finish this step.' };
  return null;
}

// Derive the tutorial from saved progress: reconnecting never resets a chapter.
export function openingGuide(c, data, events = [], device = 'keyboard') {
  const prompt=(keyboard,gamepad,touch)=>inputText(device,keyboard,gamepad,touch);
  const area = data.world.tutorial;
  const stages = ['move', 'interact', 'combat', 'exit'], index = stages.indexOf(c.tutorialStage);
  if (area && index >= 0) {
    const lessons = [
      { target: area.beacon, type: 'explore', instruction: 'Walk to the cyan square in the courtyard.', hint: prompt('Move with WASD. Hold right mouse and drag to look around.','Move with the left stick. Use the right stick to look around.','Move with the touch pad. Drag the world to look around.') },
      { target: area.terminal, type: 'interact', instruction: 'Select the training terminal, then use it.', hint: prompt('Click the terminal and press E.','Press Y to select the terminal, then X to use it.','Tap the terminal, then USE.')+` Move within ${data.rules.interactionRadius} m with a clear view.` },
      { target: area.target, type: 'practice', instruction: 'Select the practice target and use Shoot.', hint: prompt('Click the orange target and press 1.','Press Y to select the orange target, then RT to shoot.','Tap the orange target, then SHOOT.')+' Shoot costs no energy. This target cannot fight back and gives no rewards.' },
      { target: area.exit, type: 'interact', instruction: 'Use the Commons gate to begin your first quest.', hint: prompt('Click the green gate and press E.','Press Y to select the green gate, then X to use it.','Tap the green gate, then USE.')+' Your contact is beside the Commons exchange. '+prompt('Press J for your story or M for the map.','Press View for your story or D-pad down for the map.','Tap QUESTS for your story or MAP for the map.') },
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
  return { ...questGuide(q, c, data, events, device), social: socialLesson(c, device) };
}
