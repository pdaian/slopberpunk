// One selection for combat, conversations, services, and recovery.
// GPL-3.0-or-later. See LICENSE.
import { distance } from './math.js';
import { isSpirit } from './death.js';
import { dungeonPosition } from './dungeons.js';
import { openingGuide } from './quests.js';
import { incidentTargets } from './events.js';

export function collectTargets(data, simulation, residents = [], players = []) {
  const c = simulation.character, targets = [];
  if (c.health <= 0 && !isSpirit(c)) return targets;
  const add = (kind, object, action, range = data.rules.interactionRadius, key = `${kind}:${object.id}`) => {
    targets.push({ key, kind, object, position: object.position, action, range });
  };
  const lifts = () => {
    for (const lift of data.world.lifts) {
      const y = lift.stops.reduce((a, b) => Math.abs(a - c.position[1]) <= Math.abs(b - c.position[1]) ? a : b);
      add('lift', { ...lift, position: [lift.position[0], y, lift.position[2]] }, 'Ride');
    }
  };
  if (isSpirit(c)) {
    add('corpse', { id: c.id, name: 'Your body', position: c.death.corpse }, 'Return to life', data.rules.death.reclaimRadius);
    const graveyard = data.world.graveyards.find(g => g.id === c.death.graveyard);
    if (graveyard) add('healer', { ...graveyard, name: 'Graveyard healer' }, 'Talk');
    lifts();
  } else {
    for (const enemy of simulation.enemies) if (enemy.health > 0) add('enemy', enemy, 'Attack', data.abilities.find(a => a.id === 'arc').range);
    const run = simulation.inDungeon ? simulation.dungeon.run : null;
    for (const player of players) {
      if (player.id === c.id) continue;
      if (player.health > 0) add('player', player, null);
      else if (run?.phase === 'active' && run.members.some(m => m.id === player.id)) {
        add('revive', player, 'Revive', 4, `player:${player.id}`);
        if (run.revivesLeft <= 0) targets.at(-1).unavailable = 'No revives left';
      }
    }
    if (run) {
      if (run.phase === 'active') {
        const dungeon = data.dungeons.entries.find(d => d.id === run.dungeon), rules = data.dungeons.rules;
        for (const evidence of dungeon.chapters[run.chapter].evidence) add('evidence', { ...evidence, position: dungeonPosition(rules, evidence.position) }, 'Inspect', 4);
        add('recover', { id: 'aid', name: 'Recovery station', position: rules.recoveryPosition }, 'Recover', 4);
        if (simulation.time < run.recoveryReady) targets.at(-1).unavailable = `Ready in ${Math.ceil(run.recoveryReady - simulation.time)}s`;
      }
    } else {
      for (const npc of data.npcs) add('npc', npc, 'Talk');
      for (const resident of residents) {
        add('resident', resident, 'Talk');
        if (resident.activity === 'flee') targets.at(-1).unavailable = 'Taking cover';
      }
      const incidents = new Map(incidentTargets(simulation.worldEvents).map(t => [t.object.id, t]));
      const guide = openingGuide(c, data, simulation.worldEvents);
      // Keep a guided record readable when a live incident shares its terminal.
      const record = guide?.view.accepted && !guide.view.ready && guide.view.step.type === 'interact' ? guide.destination?.id : null;
      for (const terminal of data.world.landmarks) {
        if (terminal.id === data.world.tutorial?.target) {
          add('practice', terminal, 'Shoot', data.abilities.find(a => a.id === 'arc').range);
          continue;
        }
        const incident = terminal.id !== record && incidents.get(terminal.id);
        add(incident ? 'incident' : 'terminal', incident ? { ...incident.object, name: terminal.name } : terminal, incident ? 'Restore' : terminal.id === data.world.tutorial?.exit ? 'Leave tutorial' : 'Inspect', data.rules.interactionRadius, `terminal:${terminal.id}`);
      }
      lifts();
    }
  }
  return targets.filter(t => distance(c.position, t.position) <= 80);
}

export function targetProblem(target, character, world) {
  if (!target) return 'Select a target first';
  if (!target.action) return 'No action available';
  if (target.unavailable) return target.unavailable;
  if (target.kind === 'practice' && !world.inTutorial(character.position)) return 'Enter the training courtyard';
  const d = distance(character.position, target.position);
  const inclusive = ['enemy', 'practice', 'corpse', 'healer'].includes(target.kind);
  if (inclusive ? d > target.range : d >= target.range) return `Move within ${target.range} m`;
  if (!world.lineOfSight(character.position, target.position)) return 'Something is blocking your view';
  return null;
}

// Match the visible body or service, with a small minimum hit area for touch.
export function targetBounds(target, project) {
  const p = target.position, low = ['corpse', 'revive'].includes(target.kind);
  const height = low ? .8 : target.kind === 'practice' ? 3.3 : target.kind === 'enemy' && target.object.model === 'warden' ? 3.4 : 2.8;
  const foot = project(p), head = project([p[0], p[1] + height, p[2]]);
  if (!foot || !head || foot[2] < -1 || foot[2] > 1 || head[2] < -1 || head[2] > 1) return null;
  const width = Math.max(12, Math.abs(foot[1] - head[1]) * (low ? 1.2 : .3));
  return { left: Math.min(foot[0], head[0]) - width, right: Math.max(foot[0], head[0]) + width,
    top: Math.min(foot[1], head[1]) - 6, bottom: Math.max(foot[1], head[1]) + 6, depth: Math.min(foot[2], head[2]) };
}

export function visibleTargets(targets, character, world, renderer) {
  return targets.filter(t => {
    const bounds = targetBounds(t, p => renderer.project(p));
    return bounds && bounds.right >= 0 && bounds.left <= renderer.canvas.clientWidth && bounds.bottom >= 0 && bounds.top <= renderer.canvas.clientHeight
      && world.lineOfSight(character.position, t.position)
      // lineOfSight expects feet; convert the camera's eye to that convention.
      && (!renderer.eye || world.lineOfSight([renderer.eye[0], renderer.eye[1] - 1.05, renderer.eye[2]], t.position));
  });
}

export function pickTarget(targets, renderer, x, y) {
  let best = null, depth = Infinity;
  for (const target of targets) {
    const b = targetBounds(target, p => renderer.project(p));
    if (b && x >= b.left && x <= b.right && y >= b.top && y <= b.bottom && b.depth < depth) { best = target; depth = b.depth; }
  }
  return best;
}

export function cycleTarget(targets, key, position) {
  const ordered = [...targets].sort((a, b) => distance(position, a.position) - distance(position, b.position) || a.key.localeCompare(b.key));
  return ordered.length ? ordered[(ordered.findIndex(t => t.key === key) + 1) % ordered.length] : null;
}
