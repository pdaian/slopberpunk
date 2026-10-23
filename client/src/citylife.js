// Local civilian presentation; contracts and lasting progress remain server-authoritative.
// GPL-3.0-or-later. See LICENSE.
import { distance, mix3 } from './math.js';
import { routeHeight } from './world.js';
import { residentTreatment, neighborhoodOutcome } from './morality.js';

const mod = (n, d) => ((n % d) + d) % d;
const races = ['human', 'lattice', 'revenant', 'bloom'];
export const CITY_ACTIVITIES = ['walk', 'carry', 'serve', 'repair', 'work', 'talk', 'eat', 'tend', 'wait', 'flee'];

export function cityStage(neighborhood, completed = []) {
  return neighborhood.stages.reduce((stage, next) => !next.quest || completed.includes(next.quest) ? next : stage, neighborhood.stages[0]);
}

export function cityEvent(neighborhood, epoch) {
  // All clients use the server's UTC clock. Each block has its own offset.
  const offset = neighborhood.id.split('').reduce((n, c) => n + c.charCodeAt(0), 0);
  return neighborhood.events[mod(Math.floor(epoch / 180000) + offset, neighborhood.events.length)];
}

export function createRoutine(stops, speed = 1.45) {
  const segments = [];
  let duration = 0;
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i], next = stops[(i + 1) % stops.length];
    if (stop.seconds > 0) {
      segments.push({ start: duration, end: duration + stop.seconds, from: stop.position, to: stop.position, activity: stop.activity || 'wait', yaw: stop.yaw || 0 });
      duration += stop.seconds;
    }
    const travel = distance(stop.position, next.position) / speed;
    if (travel > 0) {
      segments.push({ start: duration, end: duration + travel, from: stop.position, to: next.position, route: stop.route, activity: 'walk', yaw: Math.atan2(next.position[0] - stop.position[0], next.position[2] - stop.position[2]) });
      duration += travel;
    }
  }
  if (!duration) throw new Error('A civilian routine needs time to pass.');
  return { segments, duration, speed };
}

export function routineAt(routine, seconds) {
  const t = mod(seconds, routine.duration);
  const segment = routine.segments.find(s => t < s.end) || routine.segments.at(-1);
  const position = mix3(segment.from, segment.to, (t - segment.start) / (segment.end - segment.start));
  if(segment.route)position[1]=routeHeight(segment.route,position[0],position[2])??position[1];
  const velocity = segment.to.map((n, i) => (n - segment.from[i]) / (segment.end - segment.start));
  return { position, velocity, yaw: segment.yaw, activity: segment.activity };
}

export function validateCityLife(content, data, world) {
  const fail = message => { throw new Error(`Invalid city life: ${message}`); };
  if (content?.format !== 'sloperberpunk-city-life' || content.version !== 1 || !content.neighborhoods?.length) fail('schema');
  if (!content.names?.first?.length || !content.names?.last?.length) fail('resident names');
  const ids = new Set();
  for (const role of Object.values(content.roles)) {
    if (!CITY_ACTIVITIES.includes(role.activity) || (role.nightActivity && !CITY_ACTIVITIES.includes(role.nightActivity)) || !role.title || !role.work || !role.rest || !role.line) fail('resident role');
  }
  for(const b of world.rooftops)if(!content.roles[b.rooftop.role]||!CITY_ACTIVITIES.includes(b.rooftop.activity)||!b.rooftop.line)fail(`rooftop residents in ${b.id}`);
  for (const n of content.neighborhoods) {
    if (ids.has(n.id) || !data.world.districts.some(d => d.id === n.id)) fail('district');
    ids.add(n.id);
    const contact = data.npcs.find(p => p.id === n.contact && p.neighborhood === n.id);
    if (!contact || world.collides(...contact.position)) fail(`contact in ${n.id}`);
    if (!/^#[0-9a-f]{6}$/i.test(n.color) || !['market', 'archive', 'workshop', 'garden', 'transit'].includes(n.motif)) fail(`appearance in ${n.id}`);
    if (n.sites.length !== 3 || new Set(n.sites).size !== 3 || n.stages.length !== 4 || n.stages[0].quest) fail(`story in ${n.id}`);
    for (const id of n.sites) {
      const site = data.world.landmarks.find(l => l.id === id && l.neighborhood === n.id);
      if (!site || world.collides(...site.position) || !site.evidence) fail(`site ${id}`);
    }
    for (const [index, stage] of n.stages.entries()) {
      if (!stage.status || !stage.line || !CITY_ACTIVITIES.includes(stage.activity)) fail(`stage in ${n.id}`);
      if (!index) continue;
      const q = data.quests.find(q => q.id === stage.quest);
      if (!stage.contactLine || !q || q.giver !== n.contact || q.neighborhood !== n.id || q.faction || q.race || q.objective.target !== n.sites[index - 1] || q.objective.count !== 1 || q.requires.length !== (index > 1 ? 1 : 0) || (index > 1 && q.requires[0] !== n.stages[index - 1].quest)) fail(`contract ${stage.quest}`);
    }
    if (!n.events.length || n.events.some(e => !e.name || !e.detail || !CITY_ACTIVITIES.includes(e.activity))) fail(`events in ${n.id}`);
    if (!n.residents.length || new Set(n.residents.map(r => r.name)).size !== n.residents.length || n.residents.some(r => !r.name || !content.roles[r.role])) fail(`residents in ${n.id}`);
  }
}

export class CityLife {
  constructor(world, content, data = null) {
    this.world = world;
    this.content = content;
    this.data = data;
    this.morality = null;
    this.outcomes = new Map();
    this.neighborhoods = new Map(content.neighborhoods.map(n => [n.id, n]));
    this.locals = [];
    this.blocks = new Map();
    this.states = new Map();
    this.actors = [];
    this.lastTime = null;
    this.completed = [];
    this.incidents = [];
    const stop = (position, activity = 'wait', seconds = 0, yaw = 0) => ({ position, activity, seconds, yaw });
    for (const n of content.neighborhoods) {
      const center = world.data.districts.find(d => d.id === n.id).center;
      n.residents.forEach((resident, index) => {
        const lane = (index % 3 - 1) * 1.25, stops = [];
        for (let j = 0; j < n.sites.length; j++) {
          const site = world.data.landmarks.find(l => l.id === n.sites[(j + index) % n.sites.length]);
          // Turn at the intersection before approaching a station; never cut a building corner.
          const p = [site.position[0] + lane, site.position[1], site.position[2] + 2.8];
          stops.push(stop([center[0] + lane, center[1], center[2] + 2.8]), stop([center[0] + lane, center[1], p[2]]));
          stops.push(stop(p, j === 0 ? 'duty' : j === 1 ? 'story' : 'talk', 14 + index % 4 * 5, Math.PI));
          stops.push(stop([center[0] + lane, center[1], p[2]]));
        }
        const actor=this.resident(`local-${n.id}-${index}`, resident.name, resident.role, n.id, index * 83 + center[0] * 7 + 1234, createRoutine(stops, 1.3 + index % 3 * .15), true);
        actor.personal=resident.line;
        if(index%3===0)actor.scenes=n.events.map((event,i)=>{
          const site=world.data.landmarks.find(l=>l.id===n.sites[i%n.sites.length]),home=[center[0]+lane,center[1],center[2]+2.8];
          const corner=[home[0],home[1],site.position[2]+2.8],work=[site.position[0]+lane,site.position[1],site.position[2]+2.8];
          const seconds=180-2*(distance(home,corner)+distance(corner,work))/1.45;
          return createRoutine([stop(home),stop(corner),stop(work,'scene',seconds,Math.PI),stop(corner)],1.45);
        });
        this.locals.push(actor);
      });
    }
    this.travellers=(world.data.routes||[]).filter(r=>r.kind!=='hill'||r.start[1]!==r.end[1]).map((route,i)=>{
      const resident=this.resident(`route-${route.id}`,`${content.names.first[i%content.names.first.length]} ${content.names.last[(i+4)%content.names.last.length]}`,'courier',world.district(route.start).id,3300+i*53,createRoutine([{...stop(route.start,'carry',8),route},{...stop(route.end,'work',16),route}],1.35));
      resident.personal=`I carry supplies along ${route.name.toLowerCase()}. ${route.kind==='street'?'The marked edge lanes keep us clear of the freight route.':'The handrails help when the steps are wet.'}`;return resident;
    });
  }
  resident(id, name, role, neighborhood, seed, routine, local = false) {
    return { id, name, role, neighborhood, seed: Math.abs(seed), routine, local, model: 'humanoid', race: races[mod(seed, races.length)], color: this.neighborhoods.get(neighborhood)?.color || '#95aab6' };
  }
  blockResidents(b) {
    if (this.blocks.has(b)) return this.blocks.get(b);
    const n = this.world.district([b.x, 0, b.z]).id;
    const first = this.content.names.first, last = this.content.names.last;
    const point = (x, z, activity = 'wait', seconds = 0, yaw = 0) => ({ position: [x, 0, z], activity, seconds, yaw });
    const x0 = b.x - b.w / 2 - 3.5, x1 = b.x + b.w / 2 + 3.5, z0 = b.z - b.d / 2 - 3.5, z1 = b.z + b.d / 2 + 3.5;
    const routes = [
      ['courier', [point(x0, z0, 'carry', 7), point(x1, z0, 'carry', 5), point(x1, z1), point(b.x, z1, 'carry', 12), point(x0, z1)]],
      ['neighbor', [point(x0 + .6, z0, 'talk', 16), point(x0 + .6, z1, 'wait', 18), point(x0 + 1.8, z1), point(x0 + 1.8, z0)]]
    ];
    if (b.interior) {
      const role = b.identity.role || 'commuter';
      routes.push([role, [point(b.x - 1.2, b.z - 3, 'duty', 32, -Math.PI / 2), point(b.x - 1.2, b.z + 3, 'work', 12, -Math.PI / 2)]]);
      const visitor = role === 'medic' ? 'patient' : role === 'commuter' ? 'commuter' : 'customer';
      routes.push([visitor, [point(b.x + 1.1, z1, 'wait', 9, Math.PI), point(b.x + 1.1, b.z + 2, role === 'cook' ? 'eat' : role === 'technician' ? 'work' : 'wait', 26, -Math.PI / 2), point(b.x + 1.1, z0, 'wait', 8), point(x1 + 1.4, z0), point(x1 + 1.4, z1)]]);
    } else routes.push(['technician', [point(x0, b.z + 5, 'repair', 35, Math.PI / 2), point(x0, z1, 'wait', 12)]]);
    const residents = routes.map(([role, stops], index) => this.resident(`block-${b.seed}-${b.x}-${b.z}-${index}`, `${first[(b.seed + index * 3) % first.length]} ${last[(Math.floor(b.seed / 13) + index) % last.length]}`, role, n, b.seed + index * 137, createRoutine(stops, 1.25 + index * .12)));
    if(b.interior){
      const [a,c]=b.routes,h=this.world.data.interiors.height;
      const at=(position,activity='walk',seconds=0,route)=>({position,activity,seconds,route});
      const lobby=[b.x,0,a.start[2]],upstairs=[b.x,h*2,c.end[2]];
      const stops=[at(lobby,'carry',10),at(a.start,'walk',0,a),at(a.end),at(c.start,'walk',0,c),at(c.end),at(upstairs,'work',24),at(c.end,'walk',0,c),at(c.start),at(a.end,'walk',0,a),at(a.start)];
      residents.push(this.resident(`upstairs-${b.id}`,`${first[b.seed%first.length]} ${last[(b.seed+7)%last.length]}`,'courier',n,b.seed+431,createRoutine(stops,1.3)));
      residents.push(this.resident(`tenant-${b.id}`,`${first[(b.seed+5)%first.length]} ${last[(b.seed+3)%last.length]}`,'neighbor',n,b.seed+167,createRoutine([at([b.x-1,h*2,b.z-2],'work',27),at([b.x-1,h*2,b.z+2],'talk',20)],1.2)));
    }
    for(const resident of residents){resident.building=b.identity;resident.personal=b.identity.purpose;}
    if(b.rooftop){
      const at=(position,activity='walk',seconds=0,route,yaw=0)=>({position,activity,seconds,route,yaw});
      const add=(id,role,stops)=>{
        const index=residents.length,resident=this.resident(`${id}-${b.id}`,`${first[(b.seed+index*3)%first.length]} ${last[(b.seed+index*7)%last.length]}`,role,n,b.seed+index*173,createRoutine(stops,1.3));
        resident.building=b.identity;resident.personal=b.rooftop.line;residents.push(resident);
      };
      const front=b.z+b.d/2+2.8,roofCenter=[b.x,b.h,b.z];
      add('street-host',b.rooftop.role,[at([b.x-6,0,front],'duty',35,undefined,Math.PI),at([b.x+6,0,front],'talk',20,undefined,Math.PI)]);
      add('street-visitor','customer',[at([b.x+6,0,front+1.5],'talk',23,undefined,Math.PI),at([b.x-6,0,front+1.5],b.rooftop.activity,18,undefined,Math.PI)]);
      add('roof-host',b.rooftop.role,[at([b.x-6,b.h,b.z+2.5],'duty',32),at([b.x+6,b.h,b.z+2.5],'duty',24)]);
      add('roof-neighbor','neighbor',[at([b.x-6,b.h,b.z-2.5],b.rooftop.activity,25,undefined,Math.PI),at([b.x+6,b.h,b.z-2.5],'talk',28,undefined,Math.PI)]);
      const stops=[at([b.x,0,front],'carry',8),at([b.x,0,b.routes[0].start[2]])];
      for(const route of b.routes)stops.push(at(route.start,'walk',0,route),at(route.end));
      const lastRoute=b.routes.at(-1);
      stops.push(at([b.x,b.h,lastRoute.end[2]]),at(roofCenter,'carry',12),at([b.x,b.h,lastRoute.end[2]]));
      for(const route of [...b.routes].reverse())stops.push(at(route.end,'walk',0,route),at(route.start));
      stops.push(at([b.x,0,b.routes[0].start[2]]));
      add('roof-courier','courier',stops);
    }
    this.blocks.set(b, residents);
    return residents;
  }
  clear() {
    this.states.clear();
    this.actors = [];
    this.lastTime = null;
    this.incidents = [];
    this.morality = null;
    this.outcomes.clear();
  }
  update(epoch, origin, { enemies = [], incidents = [], completed = [], morality = null, quality = 1, focus = null } = {}) {
    const seconds = epoch / 1000, dt = Math.max(0, Math.min(.1, seconds - (this.lastTime ?? seconds)));
    this.lastTime = seconds;
    this.completed = completed;
    if (this.morality !== morality) {
      this.morality = morality;
      this.outcomes = new Map(this.content.neighborhoods.map(n => [n.id,neighborhoodOutcome(n.id,{completed,morality},this.data)]));
    }
    this.incidents = incidents;
    const hazards = incidents.filter(e => e.phase === 'active' && e.hazard).map(e => ({ health: 1, position: e.hazard.position, radius: e.hazard.radius + 3 }));
    const threats = [...enemies, ...hazards];
    const hour = mod(epoch, 86400000) / 3600000, working = hour >= 6 && hour < 20;
    const radius = quality <= .5 ? 78 : 115, limit = quality <= .5 ? 30 : 64;
    const candidates = this.locals.filter(r => distance(origin, this.world.data.districts.find(d => d.id === r.neighborhood).center) < radius + 50);
    candidates.push(...this.travellers.filter(r=>r.routine.segments.some(s=>distance(origin,s.from)<radius+50)));
    const spacing = this.world.data.buildingGrid.spacing, cx = Math.floor(origin[0] / spacing), cz = Math.floor(origin[2] / spacing), used = new Set();
    for (let x = cx - 2; x <= cx + 2; x++) for (let z = cz - 2; z <= cz + 2; z++) {
      const b = this.world.cells.get(`${x},${z}`);
      if (b && (origin[1] < 60 || b.rooftop) && Math.hypot(b.x - origin[0], b.z - origin[2]) < radius + 40) {
        used.add(b);candidates.push(...this.blockResidents(b));
      }
    }
    for (const b of this.blocks.keys()) if (!used.has(b)) this.blocks.delete(b);
    const actors = [];
    for (const resident of candidates) {
      let state = this.states.get(resident.id);
      if (!state) { state = { delay: 0, until: 0, trail: [], seen: seconds, updated: seconds };this.states.set(resident.id, state); }
      const n = this.neighborhoods.get(resident.neighborhood), event = n && cityEvent(n, epoch);
      const scene=resident.scenes?.[n.events.indexOf(cityEvent(n,epoch-state.delay*1000))];
      const base = routineAt(scene||resident.routine, scene?mod(seconds-state.delay,180):seconds + resident.seed - state.delay);
      let position = state.position || base.position;
      if (distance(origin, position) > radius) continue;
      const elapsed = Math.max(0, seconds - state.updated), interrupted = Boolean(state.position);
      state.seen = seconds;state.updated = seconds;
      const role = this.content.roles[resident.role];
      const stage = n && cityStage(n, completed);
      const incident = incidents.find(e => e.neighborhood === n?.id && e.phase !== 'idle');
      let activity = base.activity === 'scene' ? event.activity : base.activity === 'duty' ? role.activity : base.activity === 'story' ? stage?.activity || 'talk' : base.activity;
      if (!working && base.activity === 'duty') activity = role.nightActivity || role.activity;
      // The first worker hosts the block's rotating street scene.
      if (resident.local && resident.id.endsWith('-0') && base.activity === 'duty') activity = event.activity;
      if (incident && ['duty', 'story','scene'].includes(base.activity)) activity = incident.phase === 'recovery' ? incident.activity : incident.phase === 'active' ? 'repair' : 'wait';
      let velocity = base.velocity, yaw = base.yaw;
      const threat = threats.filter(e => e.health > 0 && distance(position, e.position) < (e.radius || 13) && this.world.lineOfSight(position, e.position)).sort((a, b) => distance(position, a.position) - distance(position, b.position))[0];
      if (threat) {
        if (!state.position) state.position = [...position];
        state.until = seconds + 5;
      }
      if (state.position) {
        if (interrupted) state.delay += elapsed;
        const before = [...state.position];
        if (seconds < state.until) {
          if (threat && state.trail.length < 640) {
            const dx = position[0] - threat.position[0], dz = position[2] - threat.position[2], length = Math.hypot(dx, dz) || 1;
            const step = [dx / length * 4.2 * dt, 0, dz / length * 4.2 * dt];
            for (let part = 0; part < 2; part++) for (const axis of [0, 2]) {
              const next = [...state.position];next[axis] += step[axis] / 2;
              if (distance(next, state.position) > .001 && !this.world.collides(...next, .55) && this.world.floorAt(next[0], next[2], next[1] + .1, next[1] - .2) >= next[1] - .1) {
                state.trail.push(state.position);state.position = next;
              }
            }
          }
          activity = 'flee';
        } else if (state.trail.length) {
          // Retrace the safe escape path before resuming the paused routine.
          let remaining = 2.2 * dt;
          while (remaining > 0 && state.trail.length) {
            const target = state.trail.at(-1), length = distance(state.position, target);
            if (length <= remaining) { state.position = state.trail.pop();remaining -= length; }
            else { state.position = mix3(state.position, target, remaining / length);remaining = 0; }
          }
          activity = 'walk';
        } else { delete state.position;activity = 'wait'; }
        position = state.position || before;
        velocity = dt ? position.map((n, i) => (n - before[i]) / dt) : [0, 0, 0];
        if (Math.hypot(velocity[0], velocity[2]) > .01) yaw = Math.atan2(velocity[0], velocity[2]);
      } else if (focus === resident.id) {
        state.delay += elapsed;position = routineAt(scene||resident.routine,scene?mod(seconds-state.delay,180):seconds + resident.seed - state.delay).position;
        velocity = [0, 0, 0];activity = 'talk';yaw = Math.atan2(origin[0] - position[0], origin[2] - position[2]);
      }
      if (activity === 'walk' && resident.role === 'courier') activity = 'carry';
      const title = activity === 'flee' ? 'Taking cover' : activity === 'walk' ? 'Walking to the next stop' : activity === 'carry' ? 'Carrying neighborhood supplies' : activity === 'talk' ? 'Talking with a neighbor' : working ? role.work : role.rest;
      const incidentLine = incident && (incident.phase === 'recovery' ? incident.success : incident.phase === 'failed' ? incident.failure : incident.warning);
      const treatment = residentTreatment(morality,resident.neighborhood,resident.role);
      const nearby = distance(origin,position) < 6, stopped = Math.hypot(velocity[0],velocity[2]) < .1;
      let greeting = '';
      if (!incident && activity !== 'flee' && nearby && stopped) {
        if (treatment.wary) { if (activity === 'talk') activity = 'wait';yaw = Math.atan2(position[0]-origin[0],position[2]-origin[2]); }
        else if (treatment.warm) { greeting = 'nod';yaw = Math.atan2(origin[0]-position[0],origin[2]-position[2]); }
      }
      actors.push({ ...resident, position, velocity, yaw, activity, title: treatment.wary && nearby && stopped ? 'Keeping their distance' : title, gesture: greeting, treatment, line: activity === 'flee' ? incident?.hazard ? 'Get out of the marked circle. The line is about to discharge!' : 'Keep back from the machines. Get behind a wall!' : incidentLine || (nearby && treatment.line) || this.outcomes.get(resident.neighborhood) || (base.activity==='scene'?event.detail:resident.local?stage?.line:resident.personal) || role.line });
    }
    for (const [id, state] of this.states) if (seconds - state.seen > 20 || seconds < state.seen) this.states.delete(id);
    // Keep authored residents and the open conversation present when density is reduced.
    actors.sort((a, b) => Number(b.id === focus) - Number(a.id === focus) || Number(b.local) - Number(a.local) || distance(origin, a.position) - distance(origin, b.position) || a.id.localeCompare(b.id));
    this.actors = actors.slice(0, limit);
    for (const actor of this.actors) if (actor.activity === 'talk' && actor.id !== focus && !actor.gesture) {
      const partner = this.actors.find(other => other.id !== actor.id && other.activity !== 'flee' && Math.hypot(other.velocity[0], other.velocity[2]) < .1 && distance(actor.position, other.position) < 5 && this.world.lineOfSight(actor.position, other.position));
      if (partner) actor.yaw = Math.atan2(partner.position[0] - actor.position[0], partner.position[2] - actor.position[2]);
      else { actor.activity = 'wait';actor.title = 'Waiting for a neighbor'; }
    }
    return this.actors;
  }
  conversation(actor, epoch) {
    const n = this.neighborhoods.get(actor.neighborhood), role = this.content.roles[actor.role];
    const incident = this.incidents.find(e => e.neighborhood === n?.id && e.phase !== 'idle');
    const treatment = residentTreatment(this.morality,actor.neighborhood,actor.role), stage = n && cityStage(n,this.completed);
    return { role: role.title, treatment, personal: treatment.wary ? treatment.line : [treatment.line,actor.personal||role.line].filter(Boolean).join(' '), building: treatment.wary ? null : actor.building, neighborhood: n, stage: stage && this.outcomes.get(n.id) ? { ...stage,line: this.outcomes.get(n.id) } : stage, event: incident ? { name: incident.name, detail: actor.line } : n && cityEvent(n, epoch) };
  }
  overheard(origin, epoch) {
    const seconds = epoch / 1000;
    return this.actors.filter(a => distance(origin, a.position) < 24 && Math.hypot(a.velocity[0], a.velocity[2]) < .1 && mod(seconds + a.seed, 23) < 5 && this.world.lineOfSight(origin, a.position)).sort((a, b) => distance(origin, a.position) - distance(origin, b.position))[0] || null;
  }
}
