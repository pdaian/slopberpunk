// Authoritative street incident presentation. GPL-3.0-or-later.
import { box } from './geometry.js';
import { distance } from './math.js';

export function validateWorldEvents(catalog, data, world) {
  const fail = () => { throw new Error('Invalid world incident content.'); };
  if (catalog?.format !== 'sloperberpunk-world-events' || catalog.version !== 1 || !catalog.entries?.length || catalog.entries.length > 12) fail();
  const r = catalog.rules;
  if (!r || ['warningSeconds', 'activeSeconds', 'recoverySeconds', 'retrySeconds', 'holdSeconds', 'radius', 'triggerRadius', 'hazardRadius', 'hazardWarningSeconds', 'hazardEverySeconds'].some(k => !Number.isFinite(r[k]) || r[k] <= 0 || r[k] > 600)
      || r.activeSeconds <= r.holdSeconds + r.warningSeconds || r.hazardWarningSeconds >= r.hazardEverySeconds || r.hazardRadius >= r.radius || r.radius >= r.triggerRadius || !Number.isFinite(r.hazardDamageFraction) || r.hazardDamageFraction < 0 || r.hazardDamageFraction > .25) fail();
  const ids = new Set();
  for (const e of catalog.entries) {
    const anchor = data.world.landmarks.find(l => l.id === e.anchor);
    if (!anchor || ids.has(e.id) || !e.id || !e.name || !e.warning || !e.success || !e.failure || !/^#[0-9a-f]{6}$/i.test(e.color)
        || !data.citylife.neighborhoods.some(n => n.id === e.neighborhood) || !['serve', 'work', 'eat', 'tend', 'carry'].includes(e.activity)
        || !Number.isInteger(e.level) || e.level < 0 || e.level > 60 || e.controls.length !== 2 || new Set(e.controls).size !== 2 || !e.controls.includes(e.anchor)
        || (e.enemy && !data.enemies.some(v => v.id === e.enemy)) || e.spawns.length !== (e.enemy ? 2 : 0)) fail();
    ids.add(e.id);
    const controls = e.controls.map(id => data.world.landmarks.find(l => l.id === id));
    if (controls.some(l => !l)) fail();
    for (const p of [...e.spawns, ...controls.map(l => l.position)]) {
      if (p.length !== 3 || !p.every(Number.isFinite) || distance(p, anchor.position) > 120 || Math.abs(p[1] - anchor.position[1]) > .1 || world.collides(...p, .65) || Math.abs(world.floorAt(p[0], p[2], p[1] + .1, p[1] - .2) - p[1]) > .1) fail();
    }
  }
  for (const q of data.quests) {
    if (!q.steps) continue;
    if (q.steps.length < 2 || q.steps.length > 8) fail();
    for (const s of q.steps) {
      const valid = s.type === 'event' ? ids.has(s.target) : s.type === 'kill' ? data.enemies.some(e => e.id === s.target) : ['explore', 'interact', 'hold'].includes(s.type) && data.world.landmarks.some(l => l.id === s.target);
      if (!valid || !s.text || !Number.isInteger(s.count) || s.count < 1 || s.count > 60 || (['explore', 'interact', 'event'].includes(s.type) && s.count !== 1)) fail();
    }
  }
}

export function worldEventViews(data, snapshots = []) {
  return snapshots.flatMap(({ id, state }) => {
    const definition = data.events.entries.find(e => e.id === id);
    if (!definition || !state) return [];
    return [{ ...definition, ...state, position: data.world.landmarks.find(l => l.id === definition.anchor).position,
      controls: definition.controls.map(id => data.world.landmarks.find(l => l.id === id)) }];
  });
}

export function incidentStatus(event, rules, time) {
  const seconds = Math.max(0, Math.ceil(event.deadline - time));
  if (event.phase === 'warning') return `Incoming · ${seconds}s · ${event.enemy ? 'Enemy machines approaching' : 'Stay out of marked danger areas'}`;
  if (event.phase === 'recovery') return `Service restored · ${seconds}s until the next incident can begin`;
  if (event.phase === 'failed') return `Service interrupted · retry in ${seconds}s`;
  if (event.phase === 'idle') return 'Go closer to start this emergency';
  if (event.repaired.length < event.controls.length) return `Repair both controls · ${event.repaired.length}/${event.controls.length} · ${seconds}s left`;
  return `Stay near ${event.controls.find(s => s.id === event.anchor).name} (${rules.radius} m)${event.enemy ? ' · defeat enemy machines' : ' · avoid striped danger areas'} · ${Math.floor(event.hold)}/${rules.holdSeconds}s · ${seconds}s left`;
}

export function incidentTargets(events) {
  return events.filter(e => e.phase === 'active').flatMap(e => e.controls.filter(s => !e.repaired.includes(s.id)).map(s => ({
    kind: 'incident', object: { ...s, name: `Restore ${s.name}`, event: e.id, cycle: e.cycle }
  })));
}

export function incidentGeometry(vertices, events, rules, eye, time, reducedMotion = false) {
  const ring = (p, radius, color, width = .22) => {
    for (let i = 0; i < 48; i++) {
      const angle = i / 48 * Math.PI * 2;
      box(vertices, [p[0] + Math.sin(angle) * radius, p[1] + .08, p[2] + Math.cos(angle) * radius], [width, .08, radius * .12], color, .9, angle + Math.PI / 2);
    }
  };
  for (const e of events) {
    if (e.phase === 'idle' || distance(eye, e.position) > 220) continue;
    const color = e.phase === 'recovery' ? '#9be7a1' : e.phase === 'failed' ? '#e98b7b' : e.color;
    ring(e.position, rules.radius, color);
    // Status lights stay on the control panels; only gameplay areas need rings.
    for (const site of e.controls) {
      const repaired = e.repaired.includes(site.id), p = site.position;
      box(vertices, [p[0], p[1] + 2.2, p[2] + .67], [.35, .12, .06], repaired ? '#9be7a1' : color, .8);
    }
    if (e.hazard && e.hazard.hitsAt >= time) {
      const h = e.hazard;
      ring(h.position, h.radius, '#ff9c67', .5);
      // Stripes show the full damaging footprint, not just its edge.
      for (let offset = -h.radius + .5; offset < h.radius; offset += 1) {
        const length = Math.sqrt(h.radius * h.radius - offset * offset) * 2;
        box(vertices, [h.position[0] + offset, h.position[1] + .1, h.position[2]], [.28, .06, length], '#ff9c67', .8);
      }
    }
  }
}
