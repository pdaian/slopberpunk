// Authenticated in-game community terminal. User text is always escaped.
import { api } from './network.js';
import { escapeHtml as esc } from './icons.js';
import { tabardPreview } from './tabard.js';
import { itemById, itemCount, itemLabel, selectField } from './economy.js';

const tabs = [['chat','CHAT'],['dm','MESSAGES'],['guild','GUILD'],['party','PARTY'],['auctions','AUCTION HOUSE'],['forum','FORUM'],['people','PEOPLE'],['deliveries','DELIVERIES']];
const stamp = seconds => new Date(seconds * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
const button = (label, action, fields = '') => `<button type="button" class="small-button" data-social="${action}" ${fields}>${esc(label)}</button>`;
const field = (label, name, options = '') => {
  // Text inputs expose caret/selection positions to the WebGL painter; number inputs
  // do not. Retain a numeric mobile keyboard and enforce the original bounds below.
  if(options.includes('type="number"'))options=options.replace('type="number"','type="text" inputmode="numeric" pattern="[0-9]+"').replace(/\b(min|max)=/g,'data-$1=');
  return `<label class="community-field">${label}<input name="${name}" ${options} required></label>`;
};
const compose = (action, hidden = '', title = '') => `<form data-community-form="${action}" class="community-form">${hidden}${title}<label class="community-field">${action === 'dm' ? 'PRIVATE MESSAGE' : 'MESSAGE'}<textarea name="body" maxlength="${action === 'thread' || action === 'reply' ? 2000 : 1000}" rows="3" required placeholder="Write a message…"></textarea></label><span class="compose-hint">CTRL / CMD + ENTER TO SEND · DRAFT KEPT WHILE YOU PLAY</span><button class="button primary" type="submit">${action === 'thread' ? 'CREATE THREAD' : 'SEND'} →</button></form>`;
const hidden = (name, value) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
const numeric = new Set(['group','auction','delivery','thread','quantity','minimum','buyout','hours','amount']);
const tabardColors = ['#284d42','#273f65','#66384d','#9a613b','#d3b678','#c7ed99','#81e5ed','#e6abfd'];
const colorField = (label,name,value) => `${field(label+' / COLOR CODE (OR CHOOSE BELOW)',name,`value="${esc(value)}" pattern="#[0-9a-fA-F]{6}" maxlength="7" autocomplete="off" spellcheck="false"`)}<div class="tabard-swatches" role="group" aria-label="${label} color presets">${tabardColors.map(color=>`<button type="button" data-social="swatch" data-field="${name}" data-color="${color}" style="--swatch:${color}" aria-label="${label} ${color}"></button>`).join('')}</div>`;

export class Community {
  constructor({ character, online, showPanel, isOpen, toast, races, data, now = () => Date.now() }) {
    Object.assign(this, { character, online, showPanel, isOpen, toast, races, data, now });
    this.view = 'chat'; this.query = {}; this.summary = null; this.epoch = 0; this.busy = false; this.pending = null; this.owner = null;
    this.drafts = new Map(); this.pendingDraft = null;
    const root = document.querySelector('#dialog-content');
    root.addEventListener('click', e => { const b = e.target.closest('[data-social]'); if (b) this.click(b).catch(error => this.toast(error.message)); });
    root.addEventListener('submit', e => { if (e.target.dataset.communityForm) { e.preventDefault(); this.submit(e.target).catch(error => this.toast(error.message)); } });
    root.addEventListener('input', e => {
      if(e.target.dataset.min!==undefined)e.target.setCustomValidity('');
      this.saveDrafts();
      if (e.target.form?.dataset.communityForm !== 'guild_tabard') return;
      const values = Object.fromEntries(new FormData(e.target.form));
      const preview = document.querySelector('#tabard-live'); if (preview) preview.innerHTML = tabardPreview(values);
    });
    root.addEventListener('keydown', e => {
      if(e.target.tagName==='TEXTAREA'&&(e.ctrlKey||e.metaKey)&&e.key==='Enter'&&!e.isComposing) {
        e.preventDefault();if(!this.busy)e.target.form?.requestSubmit();
      }
    });
    this.timer = setInterval(() => this.poll(), 5000);
  }
  reset(nextOwner = this.character()?.id) {
    this.summary = null; this.query = {}; this.epoch++;
    if(nextOwner!==this.owner){this.drafts.clear();this.pending=null;this.pendingDraft=null;this.view='chat';}
  }
  draftKey(form) {
    const hidden=[...form.querySelectorAll('input[type="hidden"]')].map(f=>[f.name,f.value]);
    return JSON.stringify([this.owner,this.view,form.dataset.communityForm,hidden]);
  }
  saveDrafts() {
    if(this.owner!==this.character()?.id)return;
    for(const form of document.querySelectorAll('[data-community-form]')) {
      const values=[...form.elements].filter(f=>f.name&&f.type!=='hidden').map(f=>[f.name,f.type==='checkbox'?f.checked:f.value]);
      const key=this.draftKey(form);this.drafts.delete(key);this.drafts.set(key,values);
    }
    // Bound memory even when browsing hundreds of different threads or listings.
    while(this.drafts.size>64)this.drafts.delete(this.drafts.keys().next().value);
  }
  restoreDrafts() {
    for(const form of document.querySelectorAll('[data-community-form]')) {
      const values=this.drafts.get(this.draftKey(form));if(!values)continue;
      for(const [name,value]of values){const field=form.elements.namedItem(name);if(!field)continue;if(field.type==='checkbox')field.checked=value;else field.value=value;}
      if(form.dataset.communityForm==='guild_tabard') {
        const preview=document.querySelector('#tabard-live');if(preview)preview.innerHTML=tabardPreview(Object.fromEntries(new FormData(form)));
      }
    }
  }
  path() { return `/characters/${encodeURIComponent(this.character().id)}/social`; }
  async browse(query) { return (await api(`${this.path()}?${new URLSearchParams(Object.entries(query).filter(([,v]) => v !== undefined && v !== null))}`)).data; }
  async open(view = this.view, query = {}, captureDrafts = true) {
    if(captureDrafts)this.saveDrafts();
    if (!this.online()) {
      this.showPanel('Social and trading.', '<p>Sign in and start playing to chat, join player groups, trade items, and use the forum.</p>', 'COMMUNITY / ACCOUNT REQUIRED', 'community'); return;
    }
    const id = this.character().id;
    if (this.owner !== id) { this.owner = id; this.summary = null; this.pending = null; this.pendingDraft=null; this.drafts.clear(); }
    const epoch = ++this.epoch; this.view = view; this.query = query;
    this.showPanel('Social and trading', '<p role="status">Loading community…</p>', 'VESPER / COMMUNITY', 'community');
    let summary;
    try { summary = await this.browse({ view: 'summary' }); }
    catch (error) { if (epoch === this.epoch && this.isOpen()) this.showPanel('Community unavailable.', `<p role="alert">${esc(error.message)}</p>${button('TRY AGAIN','tab','data-view="chat"')}`, 'VESPER / COMMUNITY', 'community'); return; }
    if (epoch !== this.epoch || !this.isOpen() || this.character()?.id!==id) return;
    this.summary=summary;
    this.render(); await this.refresh(epoch);
  }
  channelName(channel) {
    if (channel.startsWith('race:')) return `${this.races.find(r => r.id === channel.slice(5))?.name || 'Character type'} chat`;
    if (channel.startsWith('guild:')) return 'Guild'; if (channel.startsWith('party:')) return 'Party'; return channel === 'general' ? 'General' : channel === 'trade' ? 'Trade' : 'World';
  }
  choices(channels, key, selected) { return `<div class="tabs community-channels">${channels.map(c => button(this.channelName(c),'channel',`data-key="${key}" data-channel="${esc(c)}" aria-pressed="${c === selected}"`)).join('')}</div>`; }
  render() {
    const s = this.summary, c = this.character(), view = this.view;
    let html = `<p class="panel-description">Chat with other players, find a group, or trade items. Chat and private messages here are saved between play sessions.</p><div class="community-shell"><nav class="tabs community-tabs" aria-label="Community sections">${tabs.map(([id,label],i) => `<button data-social="tab" data-view="${id}" aria-current="${id===view?'page':'false'}" class="${id === view ? 'selected' : ''}"><span class="channel-slot">${String(i+1).padStart(2,'0')}</span>${label}</button>`).join('')}</nav><section class="community-main" aria-label="${tabs.find(([id])=>id===view)?.[1]||'Community'}"><div class="community-status"><span id="community-status">${s.deliveries} deliveries · ${s.inbox.reduce((n,i) => n+i.unread,0)} unread messages</span>${button('REFRESH','refresh')}</div><div id="community-retry" ${this.pending ? '' : 'hidden'}><p>Your last action is awaiting a response. Retry to check it without sending it twice.</p>${button('RETRY ACTION','retry')}</div>`;
    const pager = `<div class="settings-actions">${button(view==='auctions'?'FIRST PAGE':'LATEST','latest')}<button type="button" id="community-older" class="small-button" data-social="older" hidden>${view==='auctions'?'NEXT PAGE':'OLDER'} →</button></div>`;
    if (view === 'chat') {
      if (!s.channels.includes(this.query.channel)) this.query.channel = 'world';
      html += this.choices(s.channels,'channel',this.query.channel)+`<p class="muted">Saved messages · ${esc(this.channelName(this.query.channel))}</p><div id="community-stream" class="community-stream" aria-live="polite"></div>${pager}`+compose('chat',hidden('channel',this.query.channel));
    } else if (view === 'dm') {
      html += '<p class="muted">Messages reach offline characters. Use People to start a conversation.</p><div class="community-inbox">'+s.inbox.map(i => button(`${i.profile?.name || i.id.slice(0,8)}${i.unread ? ` (${i.unread} new)` : ''}`,'message',`data-target="${esc(i.id)}"`)).join('')+'</div>';
      if (this.query.target) {
        const person=[...s.inbox,...s.contacts,...s.members].find(p=>p.id===this.query.target);
        html += `<p>To: <strong>${esc(person?.profile?.name||this.query.target.slice(0,12))}</strong></p><div id="community-stream" class="community-stream" aria-live="polite"></div>${pager}`+compose('dm',hidden('target',this.query.target));
      }
      else html += '<p>Select a conversation or find someone in People.</p>';
    } else if (view === 'guild' || view === 'party') {
      html += this.groupView(view);
    } else if (view === 'forum') {
      const sections = ['general',...s.channels.filter(ch => ch !== 'world')];
      if (!sections.includes(this.query.section)) this.query.section = 'general';
      html += this.choices(sections,'section',this.query.section);
      if (this.query.thread) html += `<h3 id="community-thread-title">Thread</h3>${button('BACK TO THREADS','channel',`data-key="section" data-channel="${esc(this.query.section)}"`)}<div id="community-stream" class="community-stream"></div>${pager}`+compose('reply',hidden('thread',this.query.thread));
      else html += `<div id="community-stream" class="community-stream"></div>${pager}`+compose('thread',hidden('section',this.query.section),field('THREAD TITLE','title','minlength="3" maxlength="100"'));
    } else if (view === 'auctions') {
      const catalog=this.data.economy, available=catalog.items.filter(i=>itemCount(c,i.id)>0);
      html += `<p>Buy and sell materials, equipment, supplies, and medkits. Listing an item removes it from your inventory until it sells or is returned. Bidding sets aside your gold until the auction ends or someone outbids you. Auctions last 1–48 real hours. Sellers pay a 5% fee, rounded up, only when an item sells. Collect purchases, payments, and refunds in Deliveries.</p><p>You have ${c.gold} gold. A bid or buy-now price buys all items in that listing. Price per item lets you compare listings of different sizes. Take equipment off before listing it. You can have 20 listings at a time.</p><form data-community-form="auction_search" class="community-form community-grid"><label class="community-field">ITEM NAME<input name="search" maxlength="128" value="${esc(this.query.search||'')}" placeholder="Search the whole market"></label>${selectField('SORT','sort',[['newest','Newest'],['unit_asc','Price per item: low to high'],['unit_desc','Price per item: high to low'],['buyout_asc','Buy-now total: low to high'],['buyout_desc','Buy-now total: high to low'],['bid_asc','Next bid: low to high'],['ending','Ending soon'],['rarity','Rarity: highest first'],['tier','Tier: highest first'],['name','Item name'],['quantity','Quantity: most first']],this.query.sort||'newest')}${selectField('RARITY','rarity',[['','All rarities'],...catalog.rarities.map(r=>[r.id,r.name])],this.query.rarity)}${selectField('TIER','tier',[['','All tiers'],...catalog.tiers.map(t=>[t.id,`T${t.id} ${t.name}`])],this.query.tier)}${selectField('CATEGORY','kind',[['','All items'],['equipment','Equipment'],['material','Materials'],['consumable','Supplies']],this.query.kind)}${selectField('SHOW','scope',[['open','Open market'],['mine','My listings'],['bids','My bids'],['history','My completed listings / bids']],this.query.scope||'open')}<button class="small-button">APPLY FILTERS</button></form><p id="auction-count" role="status"></p><div id="community-stream" class="community-stream"></div>${pager}<h3>List an item</h3><form data-community-form="auction_list" class="community-form community-grid">${selectField('ITEM / IN YOUR INVENTORY','item',available.map(i=>[i.id,`${i.name} · ${itemCount(c,i.id)} available`]))}${field('QUANTITY','quantity','type="number" min="1" max="999" value="1"')}${field('STARTING BID / TOTAL GOLD','minimum','type="number" min="1" max="1000000" value="10"')}${field('BUY NOW / TOTAL GOLD','buyout','type="number" min="1" max="1000000" value="18"')}${field('DURATION / HOURS','hours','type="number" min="1" max="48" value="24"')}<button class="button primary" ${available.length?'':'disabled'}>LIST FOR SALE</button></form>${available.length?'':'<p>Your inventory is empty. Defeat patrol enemies for loot or buy supplies from Patch.</p>'}`;
    } else if (view === 'deliveries') {
      html += `<p>Collect purchases, payments, refunds, gifts, and daily supplies. If your inventory is full, anything you cannot collect stays here.</p><div id="community-stream" class="community-stream"></div>${pager}`;
    } else if (view === 'people') {
      html += `<p>Your character ID: <code>${esc(c.id)}</code></p><form data-community-form="search" class="community-form">${field('FIND A PLAYER / NAME OR ID','search',`maxlength="128" value="${esc(this.query.search || '')}"`)}<button class="small-button">SEARCH</button></form><div id="community-stream" class="community-stream"></div>${pager}<h3>Contacts & invitations</h3>`;
      html += s.contacts.map(f => `<article class="community-entry"><strong>${esc(f.profile?.name || f.id)}</strong><small>${f.online ? 'ONLINE' : 'OFFLINE'} · ${f.accepted ? 'FRIEND' : f.incoming ? 'INVITATION RECEIVED' : 'INVITATION SENT'}</small>${button('MESSAGE','message',`data-target="${esc(f.id)}"`)}${!f.accepted && f.incoming ? button('ACCEPT','mutate',`data-action="friend_accept" data-target="${esc(f.id)}"`) : ''}${button(f.accepted ? 'REMOVE' : 'DECLINE / CANCEL','mutate',`data-action="friend_remove" data-target="${esc(f.id)}"`)}</article>`).join('');
      html += (s.blocked || []).map(id => `<p>Blocked: <code>${esc(id)}</code> ${button('UNBLOCK','mutate',`data-action="unblock" data-target="${esc(id)}"`)}</p>`).join('');
    }
    this.showPanel('Social and trading',html+'</section></div>','VESPER / COMMUNITY','community');
    this.restoreDrafts();
  }
  groupView(kind) {
    const c = this.character(), s = this.summary, g = s[kind], invitations = s[`${kind}Invites`];
    let html = invitations.map(g => `<article class="community-entry">Invitation: ${esc(g.name)} ${button('JOIN','mutate',`data-action="${kind}_join" data-group="${g.id}"`)} ${button('DECLINE','mutate',`data-action="${kind}_decline" data-group="${g.id}"`)}</article>`).join('');
    if (!g) html += `<h3>Create a ${kind}</h3><form data-community-form="${kind}_create" class="community-form">${field('NAME','name','minlength="3" maxlength="32"')}<label><input type="checkbox" name="raceOnly"> Reserve membership for ${esc(this.races.find(r=>r.id===c.race)?.name)} characters</label><button class="button primary">CREATE ${kind.toUpperCase()}</button></form>`;
    else {
      const leader = g.owner === c.id, officer = leader || g.members[c.id] === 'officer';
      html += `<h3>${esc(g.name)}</h3><p>${g.race ? `${esc(this.races.find(r=>r.id===g.race)?.name)} characters only` : 'All character types welcome'} · ${Object.keys(g.members).length} members</p>${kind === 'guild' ? tabardPreview(g.tabard) : '<p>Party chat reaches your whole group. You can fight alongside group members only when they are in the same copy of the world.</p>'}`;
      html += Object.entries(g.members).map(([id,role]) => {
        const m = s.members.find(p => p.id === id);
        return `<article class="community-entry"><strong>${esc(m?.profile?.name || id.slice(0,8))}</strong><small>${esc(role)} · ${m?.online ? 'ONLINE' : 'OFFLINE'}</small>${id !== c.id ? button('MESSAGE','message',`data-target="${esc(id)}"`) : ''}${officer && id !== g.owner ? button('REMOVE','mutate',`data-action="${kind}_kick" data-group="${g.id}" data-target="${esc(id)}"`) : ''}${leader && id !== c.id ? button(role === 'officer' ? 'MAKE MEMBER' : 'MAKE OFFICER','mutate',`data-action="${kind}_promote" data-group="${g.id}" data-target="${esc(id)}" data-role="${role === 'officer' ? 'member' : 'officer'}"`)+button('TRANSFER LEADERSHIP','mutate',`data-action="${kind}_transfer" data-group="${g.id}" data-target="${esc(id)}"`) : ''}</article>`;
      }).join('');
      if (officer) html += `<form data-community-form="${kind}_invite" class="community-form">${hidden('group',g.id)}${field('INVITE / CHARACTER ID (FIND IN PEOPLE)','target','minlength="64" maxlength="64"')}<button class="small-button">INVITE</button></form>`;
      if (kind === 'guild' && officer) html += `<form data-community-form="guild_tabard" class="community-form community-grid">${hidden('group',g.id)}<div>${colorField('CLOTH','base',g.tabard.base)}</div><div>${colorField('TRIM','trim',g.tabard.trim)}</div><label class="community-field">PATTERN<select name="pattern">${['stripe','cross','split'].map(v=>`<option ${v===g.tabard.pattern?'selected':''}>${v}</option>`).join('')}</select></label><label class="community-field">EMBLEM<select name="emblem">${['signal','star','tower'].map(v=>`<option ${v===g.tabard.emblem?'selected':''}>${v}</option>`).join('')}</select></label><div id="tabard-live">${tabardPreview(g.tabard)}</div><button class="button primary">SAVE GUILD OUTFIT</button></form>`;
      html += button('LEAVE '+kind.toUpperCase(),'mutate',`data-action="${kind}_leave" data-group="${g.id}"`);
    }
    if (kind === 'guild') html += `<article class="info-card"><h3>Your character type’s daily reward</h3><p>Finish Oru’s first quest to unlock 18 gold each day. Join a guild limited to your character type to get 36 gold instead. Claim again after 00:00 UTC (the game clock). Collect the gold in Deliveries. Your character type also has its own chat and forum.</p><button class="small-button" data-social="mutate" data-action="lineage_reward" ${s.lineageClaimed ? 'disabled' : ''}>${s.lineageClaimed ? 'CLAIMED TODAY' : 'CLAIM DAILY SUPPLY'}</button></article><h3>Guild directory</h3><div id="community-stream" class="community-stream"></div><div class="settings-actions">${button('FIRST PAGE','latest')}<button type="button" id="community-older" class="small-button" data-social="older" hidden>MORE GUILDS →</button></div>`;
    return html;
  }
  async refresh(epoch = this.epoch) {
    if (!this.isOpen() || !this.summary || !document.querySelector('#community-stream')) return;
    const id = this.character().id, query = { ...this.query, view: this.view === 'guild' ? 'guilds' : this.view };
    const result = await this.browse(query);
    if (epoch !== this.epoch || this.character()?.id !== id || !this.isOpen()) return;
    this.next = result.before;
    const stream = document.querySelector('#community-stream'); if (!stream) return;
    const nearBottom = stream.scrollHeight-stream.scrollTop-stream.clientHeight < 50;
    const html=this.rows(result);if(stream.innerHTML!==html)stream.innerHTML=html;
    if (nearBottom && !this.query.before && ['chat','dm'].includes(this.view)) stream.scrollTop = stream.scrollHeight;
    const older = document.querySelector('#community-older'); if (older) older.hidden = result.before == null;
    const count = document.querySelector('#auction-count'); if (count) count.textContent = `${result.total || 0} matching listings · showing ${result.items.length}${this.query.before ? ' on this page' : ''}`;
    const title = document.querySelector('#community-thread-title'); if (title && result.thread) title.textContent = result.thread.title;
    if (this.view === 'dm' && !this.query.before && !this.busy && !this.pending) {
      const through = Math.max(0,...result.items.filter(p=>p.recipient===id).map(p=>p.id));
      const incoming = this.summary.inbox.find(i=>i.id===query.target);
      if (through && incoming?.unread) await this.mutate({action:'dm_read',target:query.target,through},false);
    }
  }
  rows(result) {
    const c = this.character(), view = this.view;
    if (!result.items.length) return '<p class="muted">Nothing here yet.</p>';
    if (view === 'chat' || view === 'dm' || (view === 'forum' && this.query.thread)) return [...result.items].reverse().map(p=>`<article class="community-entry"><strong>${esc(p.name)}</strong><small>${stamp(p.created)}</small><p class="community-body">${esc(p.body)}</p></article>`).join('');
    if (view === 'forum') return result.items.map(t=>`<article class="community-entry">${button(t.title,'thread',`data-thread="${t.id}"`)}<small>${esc(t.name)} · ${stamp(t.created)}</small></article>`).join('');
    if (view === 'guild') return result.items.map(g=>`<article class="community-entry">${tabardPreview(g.tabard)}<strong>${esc(g.name)}</strong><small>${g.members} members · ${g.race ? esc(this.races.find(r=>r.id===g.race)?.name) : 'All character types'}</small>${button('MESSAGE LEADER','message',`data-target="${esc(g.leader)}"`)}</article>`).join('');
    if (view === 'auctions') return result.items.map(a=>`<article class="community-entry">${itemLabel(this.data,itemById(this.data,a.item||'medkit'))}<p>${a.quantity} items · ${esc(a.status)}</p><small>#${a.id} · Ends ${stamp(a.expires)} · ${a.seller===c.id?'YOUR LISTING':a.bidder===c.id?'YOUR BID':'MARKET'}</small><p>${a.bid?`Current bid ${a.bid}`:`Starting bid ${a.minimum}`} gold · Buy-now total ${a.buyout} gold · ${(a.buyout/a.quantity).toLocaleString('en-US',{maximumFractionDigits:3})} gold / item</p>${a.status==='open' && a.expires>this.now()/1000 ? a.seller===c.id ? (!a.bidder?button('CANCEL LISTING','mutate',`data-action="auction_cancel" data-auction="${a.id}"`):'Someone has bid. This listing cannot be canceled.') : `<form data-community-form="auction_bid" class="community-form">${hidden('auction',a.id)}${field('NEXT BID / TOTAL GOLD','amount',`type="number" min="${Math.max(a.minimum,a.bid+1)}" max="${a.buyout}" value="${Math.max(a.minimum,a.bid+1)}"`)}<button class="small-button">BID</button></form>${button('BUY NOW / '+a.buyout+' gold','mutate',`data-action="auction_buy" data-auction="${a.id}"`)}` : ''}</article>`).join('');
    if (view === 'deliveries') return result.items.map(d=>`<article class="community-entry"><strong>${esc(d.reason)}</strong><p>${d.gold} gold · ${d.medkits} medkits</p>${Object.entries(d.items||{}).map(([id,n])=>`<p>${n} × ${itemLabel(this.data,itemById(this.data,id))}</p>`).join('')}${button('CLAIM','mutate',`data-action="claim" data-delivery="${d.id}"`)}</article>`).join('');
    if (view === 'people') return result.items.map(p=>`<article class="community-entry"><strong>${esc(p.name)}</strong><small>${esc(this.races.find(r=>r.id===p.race)?.name)} · ${p.online?'ONLINE':'OFFLINE'}</small><code>${esc(p.id)}</code>${p.id!==c.id?`<div class="settings-actions">${button('MESSAGE','message',`data-target="${esc(p.id)}"`)}${button('ADD FRIEND','mutate',`data-action="friend_request" data-target="${esc(p.id)}"`)}${button('BLOCK','mutate',`data-action="block" data-target="${esc(p.id)}"`)}</div><form data-community-form="gift" class="community-form">${hidden('target',p.id)}${field('GIFT GOLD','amount','type="number" min="1" max="1000000"')}<button class="small-button">SEND GIFT</button></form>`:''}</article>`).join('');
    return '';
  }
  async mutate(request, reopen = true, submittedDraft = null) {
    if (this.busy) return;
    const id = this.character().id;
    if(this.owner!==id){this.owner=id;this.summary=null;this.pending=null;this.pendingDraft=null;this.drafts.clear();}
    if (this.pending && request !== this.pending) throw new Error('Retry the pending action before sending another.');
    this.saveDrafts();this.pendingDraft ||= submittedDraft;
    this.pending ||= {...request,version:2,requestId:crypto.randomUUID()}; this.busy = true;
    try {
      const result = await api(this.path(),this.pending); this.pending = null;
      if (this.character()?.id !== id) return;
      if(this.pendingDraft)this.drafts.delete(this.pendingDraft);this.pendingDraft=null;
      if (reopen && this.isOpen()) await this.open(this.view,{...this.query,before:undefined},false);
      else if (this.summary && request.action==='dm_read') { const conversation=this.summary.inbox.find(i=>i.id===request.target);if(conversation)conversation.unread=0; }
      return result;
    } catch (error) {
      if (error.status && error.status<500) {this.pending = null;this.pendingDraft=null;}
      const retry = document.querySelector('#community-retry'); if (retry) retry.hidden = !this.pending;
      throw error;
    } finally { this.busy = false; }
  }
  async click(b) {
    const d = b.dataset;
    if(d.social==='swatch') {
      const field=b.closest('form').elements.namedItem(d.field);field.value=d.color;field.dispatchEvent(new Event('input',{bubbles:true}));return;
    }
    if (d.social==='tab') return this.open(d.view);
    if (d.social==='message') return this.open('dm',{target:d.target});
    if (d.social==='channel') return this.open(this.view,{[d.key]:d.channel});
    if (d.social==='thread') return this.open('forum',{section:this.query.section,thread:Number(d.thread)});
    if (d.social==='refresh') return this.open(this.view,this.query);
    if (d.social==='older') { this.query.before=this.next;return this.refresh(++this.epoch); }
    if (d.social==='latest') { delete this.query.before;return this.refresh(++this.epoch); }
    if (d.social==='retry' && this.pending) return this.mutate(this.pending);
    if (d.social==='mutate') {
      const request = {action:d.action};for (const key of ['target','group','auction','delivery','role']) if(d[key]!==undefined)request[key]=numeric.has(key)?Number(d[key]):d[key];
      b.disabled=true;try { await this.mutate(request); } finally { b.disabled=false; }
    }
  }
  async submit(form) {
    if (this.busy) return;
    for(const field of form.querySelectorAll('[data-min]')) {
      const value=Number(field.value),min=Number(field.dataset.min),max=Number(field.dataset.max);
      if(!Number.isSafeInteger(value)||value<min||value>max) {
        field.setCustomValidity(`Enter a whole number from ${min} to ${max}.`);field.reportValidity();return;
      }
    }
    const action = form.dataset.communityForm, values = Object.fromEntries(new FormData(form));
    if (action==='search') return this.open('people',{search:values.search});
    if (action==='auction_search') {
      this.saveDrafts();this.drafts.delete(this.draftKey(form));
      return this.open('auctions',Object.fromEntries(Object.entries(values).filter(([,v])=>v!=='')),false);
    }
    const request = {action,...values};
    for (const key of numeric) if(request[key]!==undefined)request[key]=Number(request[key]);
    if (action.endsWith('_create')) request.raceOnly=values.raceOnly==='on';
    if (action==='guild_tabard') request.tabard={base:values.base,trim:values.trim,pattern:values.pattern,emblem:values.emblem};
    const submit = form.querySelector('[type="submit"],button');submit.disabled=true;
    try { await this.mutate(request,true,this.draftKey(form)); } finally { submit.disabled=false; }
  }
  async poll() {
    if (!this.online() || !this.character() || this.busy || this.polling || document.hidden) return;
    this.polling=true;
    const id = this.character().id, epoch = this.epoch;
    try {
      const summary = await this.browse({view:'summary'});
      if (this.character()?.id!==id || !this.online() || epoch!==this.epoch) return;
      this.summary=summary;
      const unread=summary.inbox.reduce((n,i)=>n+i.unread,0), badge=document.querySelector('#community-badge');if(badge)badge.textContent=unread?String(unread):'';
      const status=document.querySelector('#community-status');if(status)status.textContent=`${summary.deliveries} deliveries · ${unread} unread messages`;
      // Never replace a composing form, an auction bid, or a page of historical messages.
      if (this.isOpen() && !this.query.before && ['chat','dm','forum','deliveries'].includes(this.view) && epoch===this.epoch) await this.refresh(epoch);
    } catch { /* Explicit refresh reports connection errors; background polling preserves drafts. */ }
    finally { this.polling=false; }
  }
}
