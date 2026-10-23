// Live nearby/zone chat and gestures. GPL-3.0-or-later.
import { escapeHtml as esc } from './icons.js';
import { distance } from './math.js';

export const gestures = [
  { id: 'wave', name: 'Wave', description: 'Say hello' },
  { id: 'nod', name: 'Nod', description: 'Agree or thank someone' },
  { id: 'cheer', name: 'Cheer', description: 'Celebrate together' },
  { id: 'point', name: 'Point', description: 'Show the way you face' }
];

export function parseChat(value, channel = 'nearby') {
  let body = value.trim();
  if (body.startsWith('/')) {
    const [, command, rest = ''] = body.match(/^\/(\S+)\s*(.*)$/s) || [];
    const gesture = gestures.find(g => g.id === command?.toLowerCase());
    if (gesture && !rest.trim()) return { type: 'emote', gesture: gesture.id };
    const channels = { s: 'nearby', say: 'nearby', nearby: 'nearby', z: 'zone', zone: 'zone' };
    if (!channels[command?.toLowerCase()]) throw new Error('Use /say, /zone, /wave, /nod, /cheer, or /point.');
    channel = channels[command.toLowerCase()]; body = rest.trim();
  }
  if (!['nearby', 'zone'].includes(channel)) throw new Error('Choose Nearby or Zone.');
  if (!body || [...body].length > 280 || /[\u0000-\u001f\u007f-\u009f]/u.test(body)) throw new Error('Use 1–280 characters on a single line.');
  return { type: 'chat', channel, body };
}

export class SocialFeed {
  constructor() { this.reset(); }
  reset() { this.messages = []; this.seen = new Set(); this.bubbles = new Map(); this.context = null; }
  setContext(context) {
    if (!context) return false;
    const changed = this.context?.id !== context.id || this.context?.instance !== context.instance;
    if (this.context && this.context.instance !== context.instance) { this.messages = []; this.bubbles.clear(); }
    this.context = context;
    return changed;
  }
  receive(event, now) {
    if (event.type !== 'social' || this.seen.has(event.id)) return false;
    this.seen.add(event.id);
    if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value);
    this.messages.push(event); this.messages = this.messages.slice(-80);
    if (event.channel === 'nearby' && now - event.created < 8000) this.bubbles.set(event.author, event);
    while (this.bubbles.size > 64) this.bubbles.delete(this.bubbles.keys().next().value);
    return true;
  }
  visible(channel) {
    return this.messages.filter(m => m.instance === this.context?.instance && m.channel === channel && (channel !== 'zone' || m.zone === this.context?.id));
  }
  bubble(id, now) {
    const event = this.bubbles.get(id);
    if (event && (now - event.created >= 8000 || event.instance !== this.context?.instance)) { this.bubbles.delete(id); return null; }
    return event || null;
  }
  gesture(id, now) {
    const event = this.bubble(id, now);
    return event?.gesture && now - event.created < 4000 ? event.gesture : undefined;
  }
  labels(character, players, world, renderer, now) {
    let html = '';
    for (const actor of [character, ...players]) {
      const event = this.bubble(actor.id, now);
      if (!event || distance(character.position, actor.position) > (this.context?.nearbyRadius || 35) || !world.lineOfSight(character.position, actor.position)) continue;
      const p = renderer.project([actor.position[0], actor.position[1] + 3.5, actor.position[2]]);
      if (!p || p[2] > 1) continue;
      html += `<div class="world-label player-speech${event.gesture ? ' gesture-speech' : ''}" style="left:${p[0]}px;top:${p[1]}px"><small>${esc(event.name)} · ${event.gesture ? 'GESTURE' : 'NEARBY'}</small><span>${esc(event.body)}</span></div>`;
    }
    return html;
  }
}

export class LiveSocial {
  constructor({ root, character, send, onMode, toast, community, now = () => Date.now() }) {
    Object.assign(this, { root, character, send, onMode, toast, community, now });
    this.feed = new SocialFeed(); this.channel = 'nearby'; this.drafts = { nearby: '', zone: '' }; this.owner = null;
    this.pending = null; this.expanded = false; this.unread = { nearby: 0, zone: 0 };
    this.field = root.querySelector('[name="body"]'); this.stream = root.querySelector('[data-chat-stream]');
    this.form = root.querySelector('form'); this.status = root.querySelector('[data-chat-status]');
    root.querySelector('[data-gestures]').innerHTML = gestures.map(g => `<button type="button" data-gesture="${g.id}" title="${g.description}">${g.name}<small>/${g.id}</small></button>`).join('');
    root.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.chatChannel) this.open(b.dataset.chatChannel);
      else if (b.dataset.gesture) this.submit({ type: 'emote', gesture: b.dataset.gesture });
      else if (b.dataset.chatDraft) { this.open(this.channel); if (!this.pending) { this.field.value = b.dataset.chatDraft; this.saveDraft(); } }
      else if (b.dataset.chatAction === 'close') this.close();
      else if (b.dataset.chatAction === 'open') this.open();
      else if (b.dataset.chatAction === 'gestures') this.open(this.channel, true);
      else if (b.dataset.chatAction === 'community') this.community();
      else if (b.dataset.chatAction === 'retry') this.retry();
    });
    this.field.addEventListener('input', () => { this.saveDraft(); this.setStatus(''); });
    this.field.addEventListener('compositionstart', () => { this.composing = true; });
    this.field.addEventListener('compositionend', () => { this.composing = false; });
    this.form.addEventListener('submit', e => { e.preventDefault(); if (!this.pending && !this.composing) { try { this.submit(parseChat(this.field.value, this.channel), true); } catch (error) { this.setStatus(error.message); } } });
  }
  reset(owner) {
    this.saveDraft(); this.close(); clearTimeout(this.timer); this.pending = null;
    if (owner !== this.owner) this.drafts = { nearby: '', zone: '' };
    this.owner = owner; this.feed.reset(); this.unread = { nearby: 0, zone: 0 }; this.field.value = this.drafts[this.channel]; this.setStatus(''); this.render();
  }
  saveDraft() { if (this.owner === this.character()?.id) this.drafts[this.channel] = this.field.value; }
  open(channel = this.channel, gestureMenu = false) {
    if (this.pending && channel !== this.channel) return this.setStatus('Wait for your message to send, or choose Retry, before switching chats.');
    this.saveDraft(); this.channel = channel; this.field.value = this.drafts[channel];
    this.expanded = true; this.unread[channel] = 0; this.root.dataset.expanded = 'true';
    this.root.querySelector('[data-chat-compose]').hidden = false;
    this.root.querySelector('[data-gestures]').hidden = !gestureMenu;
    this.onMode(true); this.render();
    if (gestureMenu) this.root.querySelector('[data-gesture]')?.focus(); else this.field.focus();
  }
  close() {
    this.saveDraft(); this.expanded = false; this.root.dataset.expanded = 'false';
    this.root.querySelector('[data-chat-compose]').hidden = true;
    this.root.querySelector('[data-chat-action="close"]').hidden = true;
    this.root.querySelector('[data-chat-action="open"]').hidden = false;
    if (this.root.contains(document.activeElement)) document.activeElement.blur();
    this.onMode(false);
  }
  submit(action, fromComposer = false) {
    if (this.pending) return;
    const request = { ...action, requestId: crypto.randomUUID() };
    if (!this.send(request)) return this.setStatus('You are disconnected. Your unsent message is still here.');
    this.pending = { request, clearDraft: action.type === 'chat' || fromComposer, channel: this.channel };
    this.waitForReceipt();
  }
  waitForReceipt() {
    clearTimeout(this.timer); this.retryReady = false; this.setStatus('Sending…'); this.render();
    this.timer = setTimeout(() => { this.retryReady = true; this.setStatus('The server has not confirmed your message. Retry checks it without sending it twice.'); this.render(); }, 8000);
  }
  retry() {
    if (!this.pending) return;
    if (!this.send(this.pending.request)) return this.setStatus('You are disconnected. Your unsent message is still here.');
    this.waitForReceipt();
  }
  receive(event) {
    if (!['social', 'socialError'].includes(event.type)) return;
    const mine = this.pending?.request.requestId === event.requestId && (event.type === 'socialError' || event.author === this.owner);
    if (mine) {
      const pending = this.pending; clearTimeout(this.timer); this.pending = null;
      if (event.type === 'socialError') { this.setStatus(event.text); if (!this.expanded) this.toast(event.text); }
      else {
        if (pending.clearDraft) {
          this.drafts[pending.channel] = '';
          if (this.channel === pending.channel) this.field.value = '';
        }
        this.saveDraft(); this.channel = event.channel; this.field.value = this.drafts[this.channel]; this.unread[this.channel] = 0;
        this.setStatus(''); this.close();
      }
    }
    if (this.feed.receive(event, this.now())) {
      if ((!this.expanded || event.channel !== this.channel) && event.author !== this.owner) this.unread[event.channel] = Math.min(99, this.unread[event.channel] + 1);
      this.render();
    } else if (mine) this.render();
  }
  setContext(context) {
    const previous = this.feed.context;
    if (this.feed.setContext(context)) {
      if (previous?.instance !== context.instance) this.unread.nearby = 0;
      this.unread.zone = 0; this.render();
    }
  }
  setStatus(text) { this.status.textContent = text; }
  render() {
    const context = this.feed.context;
    this.root.querySelector('[data-chat-location]').textContent = this.channel === 'zone' ? `${context?.name || 'Current zone'} · ${context?.instance == null ? 'players in this copy of the world' : 'your dungeon group'}` : `Within ${context?.nearbyRadius || 35} m · speech bubbles`;
    for (const b of this.root.querySelectorAll('[data-chat-channel]')) {
      const channel = b.dataset.chatChannel, unread = this.unread[channel];
      b.setAttribute('aria-pressed', String(channel === this.channel)); b.textContent = channel.toUpperCase() + (unread ? ` (${unread})` : '');
    }
    const view = `${this.channel}:${context?.id}:${context?.instance}`;
    const changed = this.stream.dataset.view !== view;
    const atBottom = changed || this.stream.scrollHeight - this.stream.scrollTop - this.stream.clientHeight < 24;
    if (changed) { this.stream.textContent = ''; this.stream.dataset.view = view; }
    const messages = this.feed.visible(this.channel);
    const existing = new Map([...this.stream.querySelectorAll('[data-chat-id]')].map(node => [node.dataset.chatId, node]));
    const ids = new Set(messages.map(m => m.id));
    for (const [id, node] of existing) if (!ids.has(id)) node.remove();
    if (messages.length) this.stream.querySelector('.chat-empty')?.remove();
    else if (!this.stream.querySelector('.chat-empty')) this.stream.innerHTML = '<p class="chat-empty">Say hello, ask for help, or invite a neighbor along.</p>';
    for (const m of messages) if (!existing.has(m.id)) {
      const node = document.createElement('div'); node.dataset.chatId = m.id; node.className = `chat-message${m.gesture ? ' chat-emote' : ''}`;
      node.innerHTML = `<small>${esc(new Date(m.created).toISOString().slice(11,16))} UTC</small> <strong>${esc(m.name)}</strong>${m.gesture ? ' ' : ': '}${esc(m.body)}`;
      this.stream.append(node);
    }
    if (atBottom) this.stream.scrollTop = this.stream.scrollHeight;
    for (const b of this.root.querySelectorAll('[data-gesture], [data-chat-draft], [type="submit"]')) b.disabled = Boolean(this.pending);
    this.field.readOnly = Boolean(this.pending);
    this.root.querySelector('[data-chat-action="retry"]').hidden = !this.pending || !this.retryReady;
    this.root.querySelector('[data-chat-action="close"]').hidden = !this.expanded;
    this.root.querySelector('[data-chat-action="open"]').hidden = this.expanded;
    const unread = this.unread.nearby + this.unread.zone;
    const badge = document.querySelector('#chat-badge'); if (badge) badge.textContent = unread ? String(unread) : '';
  }
}
