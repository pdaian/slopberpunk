// Saved decisions and their consequences. Only the server commits choices.
// GPL-3.0-or-later.
import { escapeHtml as esc } from './icons.js';

export const moralAxes = { care: 'Care', autonomy: 'Freedom', candor: 'Honesty' };
const score = (map, id) => map?.[id] || 0;
const signed = n => `${n >= 0 ? '+' : ''}${n}`;
export const standingLabel = n => n >= 20 ? 'Trusted' : n >= 8 ? 'Welcome' : n <= -20 ? 'Resented' : n <= -8 ? 'Distrusted' : 'Neutral';
export const moralRecord = (c, id) => c.morality?.records?.[id];
export function decisionOptions(data, id, c) {
  const d = data.morality?.decisions[id];
  if (!d) return [];
  return [...d.choices, ...(d.restitution && score(c.morality?.debts, d.route) > 0 ? [{ id: 'restitution', profile: 'repair', label: 'Pay for repairs to make up for a broken promise', outcome: data.morality.restitution }] : [])];
}
export function decisionPreview(data, c, id, choice) {
  const d = data.morality.decisions[id], p = data.morality.profiles[choice.profile];
  const previous = c.morality?.commitments?.[d.route];
  const broken = Boolean(d.restitution && previous && p.pledge && previous !== p.pledge && choice.id !== 'restitution');
  const debt = score(c.morality?.debts, d.route), repairing = choice.id === 'restitution';
  const trust = p.trust - (broken ? data.morality.breach.trust : 0);
  const bond = p.bond - (broken ? data.morality.breach.bond : 0);
  return { profile: p, broken, repairing, debt, trust, bond, goldPercent: p.goldPercent, pledge: repairing ? previous : p.pledge };
}
export function decisionOutcome(q, c, data) {
  const record = moralRecord(c, q.id);
  if (!record) return q.completion;
  if (record.choice === 'restitution') return data.morality?.restitution || q.completion;
  return data.morality?.decisions[q.id]?.choices.find(o => o.id === record.choice)?.outcome || q.completion;
}
export function consequenceText(data, c, id, choice, baseGold) {
  const d = data.morality.decisions[id], v = decisionPreview(data, c, id, choice), p = v.profile;
  const delta = (map,key,n) => signed(Math.max(-100,Math.min(100,score(map,key)+n))-score(map,key));
  const parts = [Object.entries(p.values).map(([k,n]) => `${moralAxes[k]} ${delta(c.morality?.values,k,n)}`).join(' · '),
    Object.entries(p.factions).map(([k,n]) => `${data.morality.factions[k]} ${delta(c.morality?.factions,k,n)}`).join(' · '),
    `${data.morality.places[d.neighborhood]} trust ${delta(c.morality?.neighborhoods,d.neighborhood,v.trust)}`, `${data.npcs.find(n => n.id === d.contact)?.name || 'Contact'} trust ${delta(c.morality?.bonds,d.contact,v.bond)}`];
  if (p.gear) parts.push(`${data.morality.gear.find(g => g.id === p.gear).name} +1 upgrade point`);
  if (baseGold !== undefined) parts.push(`${Math.floor(baseGold * p.goldPercent / 100)} gold; full XP`);
  if (v.broken) parts.push('Breaks your earlier promise: the trust losses shown include the penalty; adds one broken promise');
  else if (v.repairing) parts.push('Makes up for one broken promise; keeps your current promise; gives up all gold from this quest');
  else if (d.restitution && p.pledge) parts.push(`Promise: ${data.morality.pledges[p.pledge]}`);
  return parts.filter(Boolean).join(' · ');
}
export function decisionPanel(q, c, data, canChoose = false) {
  const d = data.morality?.decisions[q.id];
  if (!d) return '';
  const record = moralRecord(c, q.id);
  if (c.completed.includes(q.id)) return record ? `<p class="moral-record"><strong>YOUR DECISION · ${esc(record.choice === 'restitution' ? 'Paid for repairs' : d.choices.find(o => o.id === record.choice)?.label || record.choice)}</strong>${record.broken ? '<br>This choice broke an earlier promise.' : ''}</p>` : '<p class="muted">Completed before choices were added. No choice was recorded.</p>';
  const previous = c.morality?.commitments?.[d.route];
  return `<details class="moral-decision" data-story-section="decision:${esc(q.id)}" ${canChoose ? 'open' : ''}><summary tabindex="0">CHOOSE AN ENDING</summary><p>${esc(d.question)}</p><p>Choose how this quest ends. Read each outcome and reward below. Your choice is permanent.</p>${previous ? `<p>Current promise: ${esc(data.morality.pledges[previous])}. Broken promises still to make up for: ${score(c.morality?.debts,d.route)}.</p>` : ''}<div class="card-grid">${decisionOptions(data,q.id,c).map(o => `<article class="info-card"><h4>${esc(o.label)}</h4><p>${esc(o.outcome || q.completion)}</p><p class="muted">${esc(data.morality.profiles[o.profile].tradeoff)}</p><p class="moral-effects">${esc(consequenceText(data,c,q.id,o,q.reward.gold))}</p>${canChoose ? `<button class="small-button" data-do="quest-complete" data-id="${esc(q.id)}" data-choice="${esc(o.id)}" ${c.health <= 0 ? 'disabled' : ''}>CHOOSE · ${esc(o.label)}</button>` : ''}</article>`).join('')}</div><p class="panel-description">Finish the quest steps, then return to the person who gave you the quest to choose. Each option gives the full XP reward. Later quests can change your reputation, but they cannot undo this choice.</p></details>`;
}
export function moralGearState(c, data, g) {
  const imprints = score(c.morality?.imprints,g.id), rank = data.morality.ranks.filter(n => imprints >= n).length;
  const aligned = Object.entries(g.requires).every(([k,n]) => score(c.morality?.values,k) >= n);
  const active = c.morality?.equipped === g.id && rank > 0 && aligned;
  return { imprints, rank, aligned, active, stats: Object.fromEntries(Object.entries(g.stats).map(([k,n]) => [k,n * rank])) };
}
export function moralBonuses(c, data) {
  const g = data.morality?.gear.find(g => g.id === c.morality?.equipped);
  if (!g) return {};
  const state = moralGearState(c,data,g);
  return state.active ? state.stats : {};
}
export function vendorPercent(c) {
  const trust = score(c.morality?.neighborhoods,'market');
  return trust >= 20 ? 85 : trust >= 8 ? 95 : trust <= -20 ? 120 : trust <= -8 ? 110 : 100;
}
export const moralPrice = (c, base) => Math.ceil(base * vendorPercent(c) / 100);

export function moralGearPanel(c, data, formatStats) {
  if (!data.morality) return '';
  return `<h3>Choice rewards</h3><p>Choices can earn upgrade points for the items below. Earn ${data.morality.ranks.join(', ')} points in an item to unlock ranks 1, 2, and 3. Equip one alongside your normal gear. These items cannot be sold or traded. Some bonuses stop working if your values fall below their requirement; you keep the points. Normal bonus limits still apply.</p><div class="card-grid">${data.morality.gear.map(g => {
    const s = moralGearState(c,data,g), fitted = c.morality?.equipped === g.id;
    return `<article class="info-card"><span class="tag">${s.active ? 'ACTIVE' : fitted ? 'EQUIPPED · BONUS INACTIVE' : s.rank ? 'AVAILABLE' : 'LOCKED'} · RANK ${s.rank}/3 · ${s.imprints} UPGRADE POINTS</span><h4>${esc(g.name)}</h4><p>${esc(g.description)}</p><p>${esc(formatStats(s.rank ? s.stats : g.stats))}${s.rank ? '' : ' at rank 1'}</p><button class="small-button" data-do="moral-gear" data-id="${fitted ? '' : esc(g.id)}" ${!s.rank || c.health <= 0 || c.dungeonReturn ? 'disabled' : ''}>${fitted ? 'TAKE OFF' : 'EQUIP'}</button></article>`;
  }).join('')}</div><button class="small-button" data-do="journal-filter" data-id="morality">REPUTATION & CHOICES ↗</button>`;
}

export function neighborhoodOutcome(place, c, data) {
  if (!data?.morality) return '';
  const q = [...(c.completed || [])].reverse().map(id => data.quests.find(q => q.id === id))
    .find(q => q?.neighborhood === place && moralRecord(c,q.id));
  return q ? decisionOutcome(q,c,data) : '';
}

export function moralClosing(c, data) {
  if (!Object.keys(c.morality?.records || {}).length) return '';
  const debts = Object.values(c.morality.debts || {}).reduce((n,v) => n + v,0);
  const reception = score(c.morality.neighborhoods,'market') >= 8 ? 'Nella makes room at the table.' : score(c.morality.neighborhoods,'market') <= -8 ? 'Nella accepts your report, but she does not trust you yet.' : 'Nella reads your report before deciding what to ask of you next.';
  return `Oru saves your choices, including who you helped and who paid the price. ${reception} ${debts ? `${debts} broken promise(s) still need to be made up for.` : 'You have no broken promises left to make up for.'} The city still lacks supplies. Your report, the Living Record, will help people decide what to do next.`;
}

export function residentTreatment(morality, place, role = 'neighbor') {
  const trust = score(morality?.neighborhoods,place), values = morality?.values;
  // Residents have interests of their own: a clerk values truthful records, a
  // patient values consent, and a worker values care. Local trust still dominates.
  const axis = role === 'archivist' ? 'candor' : ['patient','neighbor','gardener'].includes(role) ? 'autonomy' : 'care';
  const regard = trust + Math.trunc(score(values,axis) / 5);
  if (regard >= 8) return { label: standingLabel(regard), warm: true, wary: false, line: 'You kept people here in mind. There is a place for you at our table; I will make time to talk.' };
  if (regard <= -8) return { label: standingLabel(regard), warm: false, wary: true, line: 'We remember who carried the cost of your decisions. I will give you the public directions, but I am keeping our private business to myself.' };
  return { label: standingLabel(regard), warm: false, wary: false, line: '' };
}
export function moralNpcDialogue(npc, c, data) {
  if (!Object.keys(c.morality?.records || {}).length || !data.morality) return '';
  const faction = data.factions.find(f => f.giver === npc.id)?.id;
  const regard = score(c.morality.bonds,npc.id) + (faction ? Math.trunc(score(c.morality.factions,faction) / 2) : 0);
  if (regard >= 8) return 'You have earned my confidence. I will keep working with you, even when we disagree about the next decision.';
  if (regard <= -8) return 'I will still take evidence and offer work. Trust is another matter; the people who paid for your choices have not forgotten.';
  return '';
}
export function moralStandingPanel(c, data) {
  if (!data.morality) return '';
  const m = c.morality || {}, entries = Object.entries(m.records || {}).sort(([a],[b]) => a.localeCompare(b));
  const meters = (names,values) => Object.entries(names).map(([id,name]) => `<div class="guide-row"><span>${esc(name)}</span><strong>${signed(score(values,id))} · ${standingLabel(score(values,id))}</strong></div>`).join('');
  const records = entries.map(([id,r]) => {
    const d = data.morality.decisions[id], q = data.quests.find(q => q.id === id), dungeon = data.dungeons.entries.find(d => `dungeon:${d.id}` === id);
    if (!d) return '';
    const choice = d.choices.find(o => o.id === r.choice);
    const history = dungeon && c.dungeonHistory?.[dungeon.id];
    const group = history && (dungeon.decision.choices.find(o => o.id === history.ending)?.ending || dungeon.decision.deferred);
    return `<article class="info-card"><h4>${esc(q?.title || dungeon?.name || id)}</h4><p>${q ? 'QUEST ENDING' : 'YOUR FIRST VOTE'} · ${esc(choice?.label || 'Paid for repairs')} · ${esc(data.morality.places[d.neighborhood])}${r.broken ? ' · BROKEN PROMISE' : ''}</p><p>${esc(q ? decisionOutcome(q,c,data) : 'This is your own vote. Your group may have chosen a different ending.')}</p>${group ? `<p>LATEST GROUP ENDING · ${esc(group)}</p>` : ''}</article>`;
  }).join('');
  return `<p class="dialog-intro">The city remembers who paid for your decisions.</p><p>Care means helping people. Freedom means letting people decide for themselves. Honesty means sharing the truth. A choice can raise one value and lower another. Groups and residents may disagree about your choices. Scores range from −100 to +100: +8 makes you welcome, +20 trusted, −8 distrusted, and −20 resented.</p><h3>Your values</h3><div class="guide-grid">${Object.entries(moralAxes).map(([id,name]) => `<div class="guide-row"><span>${name}</span><strong>${signed(score(m.values,id))}</strong></div>`).join('')}</div><h3>Faction reputation</h3><div class="guide-grid">${meters(data.morality.factions,m.factions)}</div><h3>Neighborhood trust</h3><div class="guide-grid">${meters(data.morality.places,m.neighborhoods)}</div><h3>People who know you</h3><div class="guide-grid">${meters(Object.fromEntries(data.npcs.filter(n => m.bonds?.[n.id] !== undefined).map(n => [n.id,n.name])),m.bonds) || '<p>No personal relationships recorded.</p>'}</div><h3>Promises and repairs</h3>${Object.entries(m.commitments || {}).map(([id,p]) => `<p>${esc(data.morality.routes[id])} · ${esc(data.morality.pledges[p])} · ${score(m.debts,id)} broken promise(s)</p>`).join('') || '<p>You have not made any promises yet.</p>'}<p>Choosing a different promise in the same quest series costs ${data.morality.breach.trust} extra neighborhood trust and ${data.morality.breach.bond} extra trust with your contact. It also adds one broken promise. On a later quest in that series, you can give up the entire gold reward to make up for one broken promise. You keep your current promise and the full XP reward. Earlier choices stay saved.</p><p>Patch’s medkits and weapon upgrades currently cost ${vendorPercent(c)}% of their base price, rounded up. You can still use essential services and accept quests at any reputation.</p><button class="small-button" data-do="inventory">VIEW CHOICE REWARDS ↗</button><h3>${entries.length} decisions recorded</h3>${records || '<p>Finish a quest and choose its ending to start this list. Quests completed before choices were added keep their progress without recording a choice.</p>'}`;
}

export function validateMorality(data) {
  const m = data.morality, fail = () => { throw new Error('Invalid morality content. Check morality.json.'); };
  const prose = v => typeof v === 'string' && v.trim().length > 0, ident = v => typeof v === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(v);
  if (!m || m.version !== 1 || m.format !== 'sloperberpunk-morality' || !prose(m.restitution) || !Array.isArray(m.ranks) || m.ranks.length !== 3 || m.ranks.some((n,i) => !Number.isInteger(n) || n < 1 || n > 203 || i > 0 && n <= m.ranks[i-1])) fail();
  for (const key of ['trust','bond']) if (!Number.isInteger(m.breach?.[key]) || m.breach[key] < 1 || m.breach[key] > 10) fail();
  if (!m.gear?.length || new Set(m.gear.map(g => g.id)).size !== m.gear.length) fail();
  const stats = new Set(['health','energy','speed','crit','damage','shield','healing','regen','armor','haste','efficiency','penetration','leech','combo','goldFind']);
  for (const g of m.gear) if (!ident(g.id) || ![g.name,g.description].every(prose) || !Object.keys(g.stats || {}).length || Object.entries(g.stats).some(([k,v]) => !stats.has(k) || !Number.isFinite(v) || v <= 0 || v > 20) || Object.entries(g.requires || {}).some(([k,v]) => !(k in moralAxes) || !Number.isInteger(v) || v < -100 || v > 100)) fail();
  const deltas = (map,keys) => map && Object.entries(map).every(([k,n]) => keys.includes(k) && Number.isInteger(n) && Math.abs(n) <= 10);
  for (const [id,p] of Object.entries(m.profiles)) if (!ident(id) || !prose(p.tradeoff) || !deltas(p.values,Object.keys(moralAxes)) || !deltas(p.factions,Object.keys(m.factions)) || !Number.isInteger(p.trust) || Math.abs(p.trust)>10 || !Number.isInteger(p.bond) || Math.abs(p.bond)>10 || !Number.isInteger(p.goldPercent) || p.goldPercent<0 || p.goldPercent>150 || p.pledge && !m.pledges[p.pledge] || p.gear && !m.gear.some(g => g.id === p.gear)) fail();
  if (!m.profiles.repair || m.profiles.repair.goldPercent !== 0 || m.profiles.repair.pledge) fail();
  const abstain = m.profiles.abstain;
  if (!abstain || Object.keys(abstain.values).length || Object.keys(abstain.factions).length || abstain.trust || abstain.bond || abstain.gear || abstain.pledge || abstain.goldPercent !== 100) fail();
  const expected = new Set([...data.quests.map(q => q.id), ...data.dungeons.entries.map(d => `dungeon:${d.id}`)]);
  if (Object.keys(m.decisions).length !== expected.size) fail();
  for (const [id,d] of Object.entries(m.decisions)) {
    const q = data.quests.find(q => q.id === id), dungeon = data.dungeons.entries.find(e => `dungeon:${e.id}` === id);
    if (!expected.has(id) || !m.routes[d.route] || !m.places[d.neighborhood] || !data.npcs.some(n => n.id === d.contact) || !prose(d.question) || !Array.isArray(d.choices) || d.choices.length < 2 || d.choices.length > 3 || new Set(d.choices.map(o => o.id)).size !== d.choices.length || Boolean(d.restitution) !== Boolean(q)) fail();
    if (q && (q.giver !== d.contact || d.route !== (q.faction || q.race || q.neighborhood || q.biome) || new Set(d.choices.map(o => o.profile)).size < 2)) fail();
    for (const o of d.choices) if (!ident(o.id) || o.id === 'restitution' || !prose(o.label) || !m.profiles[o.profile] || o.profile === 'repair' || (!q || o.id !== 'uphold') && !prose(o.outcome)) fail();
    if (d.choices.some(o => o.id === 'defer' ? o.profile !== 'abstain' : !m.profiles[o.profile].gear || !m.profiles[o.profile].pledge)) fail();
    if (dungeon && (d.choices.length !== 3 || d.choices.some(o => ![...dungeon.decision.choices.map(c => c.id),'defer'].includes(o.id)))) fail();
  }
  for (const id of Object.keys(m.places)) if (![...data.world.districts,...data.world.biomes].some(p => p.id === id)) fail();
  for (const f of data.factions) if (!m.factions[f.id]) fail();
  return m;
}
