// Bounded, local encounters at existing routine stops. GPL-3.0-or-later.
import { distance } from './math.js';
import { identityHash } from './npc-style.js';

export function residentMood(personality, epoch, role, incident) {
  if (incident?.phase === 'active' || incident?.phase === 'warning') return 'concerned';
  if (incident?.phase === 'recovery') return 'relieved';
  const hour = ((epoch / 3600000 % 24) + 24) % 24;
  if (hour < 6 || hour >= 22) return 'tired';
  if (role === 'courier' || role === 'commuter') return personality.patience < .5 ? 'in a hurry' : 'watchful';
  return personality.sociability > .7 ? 'sociable' : personality.patience < .4 ? 'preoccupied' : 'unhurried';
}

// Role checks decide who needs something and who can actually offer it.
// An exchange is social presentation; it never moves inventory or currency.
export function encounterFor(a, b, context = {}) {
  const pair = (one, two) => a.role === one && b.role === two ? [a, b] : b.role === one && a.role === two ? [b, a] : null;
  let roles;
  if ((roles = pair('cook', 'customer'))) return { kind: 'meal', lead: roles[1].id, title: 'Checking a meal order', lines: [
    'Is that the mild batch? I am taking half upstairs.', 'This pot is mild. Keep the lid loose until it cools.', 'Thanks. I will bring the bowl down on my next break.'
  ] };
  if ((roles = pair('medic', 'patient'))) return { kind: 'care', lead: roles[1].id, title: 'Checking in quietly', lines: [
    'I can wait. I just need to know if I should call my shift.', 'Call them. I cannot promise a time, but you have not lost your place.', 'All right. I would rather tell them now.'
  ] };
  if ((roles = pair('technician', 'courier'))) return { kind: 'delivery', lead: roles[1].id, title: 'Checking a parts delivery', lines: [
    'Two seals, same size, different batch. Can you check before I go?', 'The blue mark is the newer one. Leave the older seal in its wrapper.', 'I will mark that on the return slip. Saves the next shift guessing.'
  ] };
  if (a.role === 'technician' && b.role === 'technician') return { kind: 'repair', lead: a.id, title: 'Comparing a repair', lines: [
    context.recovery ? 'It is running again. Shall we check the joints before everyone leaves?' : 'Hear that rattle? It stops when the load drops.', 'Then check the mounting before you replace the motor.', 'Good catch. I will note the test for the night crew.'
  ] };
  if ((roles = pair('gardener', 'neighbor')) || (roles = pair('gardener', 'customer'))) return { kind: 'garden', lead: roles[1].id, title: 'Sharing plant advice', lines: [
    'The leaves curled again. I watered it this morning.', 'Feel the soil underneath. The surface dries first up here.', 'Still wet. I will leave it alone for a day.'
  ] };
  // People carrying out unrelated work do not abandon it for idle chatter.
  if ([a, b].some(actor => !['talk', 'wait', 'eat'].includes(actor.activity))) return null;
  if (context.recovery) return { kind: 'help', lead: a.personality.care > b.personality.care ? a.id : b.id, title: 'Checking on a neighbor', lines: [
    'Did everyone from your floor get back safely?', 'We are still waiting on one person. Their shift runs late.', 'I will stay a little. You should not have to wait alone.'
  ] };
  if (a.role === 'commuter' || b.role === 'commuter') return { kind: 'connection', lead: a.role === 'commuter' ? a.id : b.id, title: 'Comparing connections', lines: [
    'The board changed again. Did I miss the last connection?', 'The service passes use the other column. Check that before you walk.', 'There it is. I nearly took the stairs all the way down.'
  ] };
  if (Math.min(a.personality.patience, b.personality.patience) < .35 && a.personality.assertiveness + b.personality.assertiveness > 1) return { kind: 'disagreement', lead: a.personality.patience < b.personality.patience ? a.id : b.id, title: 'Working out a misunderstanding', lines: [
    'I thought you were holding my place. I have been here since shift change.', 'I was leaving a gap for the delivery. I did not know you were waiting.', a.personality.care + b.personality.care > 1 ? 'Sorry. Long shift. Let us leave the passage clear and work it out.' : 'All right. Tell me next time. I will wait over here.'
  ] };
  const seed = identityHash(`${[a.id, b.id].sort().join(':')}:${context.cycle || 0}`);
  const [lead, reply] = seed % 2 ? [a, b] : [b, a];
  if (seed % 3 === 0) return { kind: 'style', lead: lead.id, title: 'Talking clothes', lines: [
    `That ${reply.outfit.upper} catches every sign on this street. Did you alter it?`,
    reply.personality.assertiveness > .5 ? 'The lining and cuffs. The outside gets all the credit.' : 'Only the pockets. I need to actually use them.',
    lead.personality.interest.name === 'repairing vintage clothes' ? 'Bring it by sometime. I have thread that would match.' : 'It suits you. I would have kept the old pockets too.'
  ] };
  if (seed % 3 === 1) return { kind: 'favor', lead: lead.id, title: 'Making a small arrangement', lines: [
    'Could you hold a parcel for me tomorrow? I might miss the courier.',
    reply.personality.care > .6 ? 'After my shift, yes. Put my name on it so it reaches the right door.' : 'I cannot promise tomorrow. Ask the counter before it closes.',
    reply.personality.care > .6 ? 'Thank you. I will come by before it gets late.' : 'Fair enough. I will go and ask while it is open.'
  ] };
  return { kind: 'interest', lead: lead.id, title: `Talking about ${lead.personality.interest.name}`, lines: [
    lead.personality.interest.line, lead.personality.interest.reply,
    lead.personality.sociability > .6 ? 'I will tell you how it goes when I see you again.' : 'Anyway. Good to talk for a minute.'
  ] };
}

export class StreetSocial {
  constructor() { this.memory = new Map();this.lastTime = null; }
  clear() { this.memory.clear();this.lastTime = null; }
  update(actors, epoch, world, focus) {
    const now = epoch / 1000;
    if (this.lastTime !== null && now < this.lastTime) this.clear();
    this.lastTime = now;
    for (const [key, record] of this.memory) if (now - record.seen > 600) this.memory.delete(key);
    const eligible = actors.filter(a => a.socialAvailable && a.id !== focus && Math.hypot(a.velocity[0], a.velocity[2]) < .1).sort((a, b) => a.id.localeCompare(b.id));
    const used = new Set(), meetings = [];
    for (let i = 0; i < eligible.length; i++) {
      const a = eligible[i];
      for (const b of eligible.slice(i + 1)) {
        const separation = distance(a.position, b.position);
        if (Math.abs(a.position[1] - b.position[1]) >= .6 || separation < .8 || separation >= 4.6) continue;
        const key = [a.id, b.id].sort().join('|'), seed = identityHash(key);
        const start = Math.max(a.stopStarted, b.stopStarted) + 1 + seed % 3;
        const duration = 11 + Math.round(Math.min(a.personality.patience, b.personality.patience) * 5 + Math.min(a.personality.sociability, b.personality.sociability) * 2);
        const end = Math.min(a.stopEnds, b.stopEnds, start + duration);
        // One finite conversation per overlapping stop, including a goodbye.
        // Routes never wait on this system, so a streamed-out partner cannot trap anyone.
        if (end - start < 10 || now < start || now >= end) continue;
        const encounter = encounterFor(a, b, { recovery: a.incidentPhase === 'recovery' || b.incidentPhase === 'recovery', cycle: Math.floor(start / 60) });
        if (!encounter) continue;
        if (['style', 'favor', 'interest'].includes(encounter.kind) && Math.max(a.personality.sociability, b.personality.sociability) < .35 && seed % 3 !== 0) continue;
        meetings.push({ a, b, key, start, end, separation, encounter });
      }
    }
    // Earlier exchanges have priority over new arrivals, without depending on
    // how many frames a client has observed. People finish addressing a partner.
    meetings.sort((a, b) => a.start - b.start || a.separation - b.separation || a.key.localeCompare(b.key));
    for (const { a, b, key, start, end, encounter } of meetings) {
      if (used.has(a.id) || used.has(b.id) || !world.lineOfSight(a.position, b.position)) continue;
      let memory = this.memory.get(key);
      if (!memory || Math.abs(memory.start - start) > .01) {
        memory = { start, seen: now, meetings: Math.min(9, (memory?.meetings || 0) + 1), familiar: Boolean(memory), rapport: memory?.rapport || 0, resolved: false, kind: encounter.kind };
        this.memory.delete(key);this.memory.set(key, memory);
        if (this.memory.size > 256) this.memory.delete(this.memory.keys().next().value);
      }
      memory.seen = now;
      const lead = encounter.lead === a.id ? a : b, other = lead === a ? b : a;
      const progress = (now - start) / (end - start);
      const turn = progress < .12 ? 0 : progress < .38 ? 1 : progress < .64 ? 2 : progress < .87 ? 3 : 4;
      const speaker = turn === 2 || turn === 4 ? other : lead;
      const familiar = memory.familiar || (a.building && a.building.name === b.building?.name);
      if (turn >= 3 && !memory.resolved) {
        const change = encounter.kind === 'disagreement' && a.personality.care + b.personality.care <= 1 ? -1 : encounter.kind === 'favor' && other.personality.care <= .6 ? 0 : 1;
        memory.rapport = Math.max(-3, Math.min(3, memory.rapport + change));memory.resolved = true;
      }
      const greeting = memory.rapport < 0 ? 'Can we try that conversation again?' : familiar ? 'Good to see you again. Got a moment?' : lead.mood === 'tired' ? 'Long shift? I can keep this brief.' : lead.personality.sociability < .4 ? 'Can I ask you something?' : 'Hey. Have you got a moment?';
      const line = turn === 0 ? greeting : turn === 4 ? speaker.mood === 'in a hurry' ? 'I have to catch my connection. See you.' : 'Take care. I will let you get back to it.' : encounter.lines[turn - 1];
      for (const actor of [a, b]) {
        const partner = actor === a ? b : a, speaking = actor === speaker;
        actor.interaction = { kind: encounter.kind, partner: partner.id, partnerName: partner.name, phase: ['greeting', 'opening', 'reply', 'resolution', 'goodbye'][turn], speaking, familiar: Boolean(familiar), meetings: memory.meetings, relationship: memory.rapport < 0 ? 'strained' : memory.rapport >= 2 ? 'friendly' : familiar ? 'familiar' : 'new acquaintance' };
        actor.speech = speaking ? line : '';
        actor.title = `${encounter.title} · ${speaking ? 'speaking to' : 'listening to'} ${partner.name}`;
        actor.yaw = Math.atan2(partner.position[0] - actor.position[0], partner.position[2] - actor.position[2]);
        actor.gesture = '';
        const busy = ['carry', 'serve', 'repair', 'tend'].includes(actor.activity);
        actor.socialPose = busy ? actor.activity : !speaking ? 'listen' : encounter.kind === 'care' || encounter.kind === 'help' ? 'reassure' : encounter.kind === 'disagreement' && turn < 3 ? 'argue' : 'talk';
        actor.socialGesture = (turn === 0 || turn === 4) ? 'nod' : encounter.kind === 'connection' && turn === 2 && speaking ? 'point' : '';
      }
      used.add(a.id);used.add(b.id);
    }
    for (const actor of actors) {
      if (actor.interaction || actor.id === focus) continue;
      if (actor.activity === 'talk') { actor.activity = 'wait';actor.title = 'Waiting for a neighbor'; }
      if (!actor.socialAvailable || !['wait', 'eat'].includes(actor.activity)) continue;
      const idle = (now + identityHash(actor.id) % 31) % 24;
      if (actor.activity === 'wait' && idle < 5) actor.socialPose = actor.mood === 'in a hurry' ? 'check' : ['check', 'adjust', 'stretch', 'listen'][identityHash(actor.personality.habit) % 4];
    }
    return actors;
  }
}
