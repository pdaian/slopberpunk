// In-memory checks only: no saves, browser profiles, caches, or generated files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateMorality, decisionOptions, decisionPreview, consequenceText, decisionPanel, decisionOutcome, moralBonuses, moralGearState, moralGearPanel, moralPrice, vendorPercent, residentTreatment, moralStandingPanel, neighborhoodOutcome, moralClosing } from '../src/morality.js';
import { campaignPanel, storyDialogue } from '../src/story.js';
import { ballotConsequences, dungeonPanel } from '../src/dungeons.js';
import { stats } from '../src/prediction.js';
import { statText } from '../src/economy.js';
import { World } from '../src/world.js';
import { CityLife } from '../src/citylife.js';

const data = Object.fromEntries(['morality','quests','dungeons','world','npcs','factions','races','citylife','lore','rules','events','talents','economy'].map(n => [n,JSON.parse(readFileSync(new URL(`../data/${n}.json`,import.meta.url)))]));
const character = () => ({ id:'runner',name:'Runner',faction:'relay',race:'human',level:60,xp:0,gold:100,health:100,energy:60,position:[0,0,32],completed:[],activeQuests:{},talents:{},items:{},equipment:{},buffs:{} });
const state = () => ({ records:{},values:{},factions:{},neighborhoods:{},bonds:{},commitments:{},debts:{},imprints:{},equipped:'' });
const quest = id => data.quests.find(q => q.id === id);

test('all 203 contracts across 17 routes and six expedition ballots have valid decisions', () => {
  validateMorality(data);
  assert.equal(data.quests.length,203);
  assert.equal(Object.keys(data.morality.decisions).length,209);
  assert.equal(new Set(data.quests.map(q => data.morality.decisions[q.id].route)).size,17);
  const endings = new Set();
  for (const q of data.quests) {
    const d = data.morality.decisions[q.id], options = decisionOptions(data,q.id,character());
    assert.equal(options.length,2);
    assert.equal(d.restitution,true);
    assert.equal(d.contact,q.giver);
    assert.notEqual(options[0].profile,options[1].profile,q.id);
    assert.ok(options[1].outcome.length > 60,q.id);
    assert.ok(!endings.has(options[1].outcome),q.id);
    endings.add(options[1].outcome);
    for (const option of options) {
      const p = data.morality.profiles[option.profile];
      assert.ok(p.gear && p.pledge);
      assert.ok(Object.keys(p.values).length && Object.keys(p.factions).length);
      assert.ok(Number.isFinite(Math.floor(q.reward.gold*p.goldPercent/100)));
    }
  }
});

test('invalid decisions, references, stats, and restitution definitions fail at startup', () => {
  for (const corrupt of [
    d => delete d.morality.decisions['relay-00'],
    d => d.morality.decisions['relay-00'].contact = 'missing',
    d => d.morality.decisions['relay-00'].route = 'human',
    d => d.morality.decisions['relay-00'].neighborhood = 'missing',
    d => d.morality.decisions['relay-00'].choices[1].id = 'uphold',
    d => d.morality.decisions['relay-00'].choices[1].profile = 'missing',
    d => d.morality.decisions['relay-00'].choices[1].outcome = '',
    d => d.morality.decisions['dungeon:ninth-bell'].choices[0].id = 'forged',
    d => d.morality.gear[0].stats.armor = Infinity,
    d => d.morality.gear[0].requires.nonexistent = 2,
    d => d.morality.profiles.care.factions.missing = 3,
    d => d.morality.profiles.profit.goldPercent = 151,
    d => d.morality.profiles.repair.goldPercent = 100,
    d => d.morality.profiles.abstain.gear = 'witness',
    d => d.morality.decisions['dungeon:ninth-bell'].choices[2].profile = 'truth',
    d => d.morality.decisions['relay-00'].choices[1].profile = 'care',
    d => d.morality.ranks = [1,5,5]
  ]) {
    const broken = structuredClone(data);corrupt(broken);
    assert.throws(() => validateMorality(broken),/Invalid morality/);
  }
});

test('legacy characters keep their endings, stats, prices, and neutral relationships', () => {
  const c = character(), q = quest('neighborhood-market-02');c.completed.push(q.id);
  assert.equal(decisionOutcome(q,c,data),q.completion);
  assert.match(decisionPanel(q,c,data,true),/Completed before choices were added/);
  assert.doesNotMatch(decisionPanel(q,c,data,true),/data-do="quest-complete"/);
  assert.deepEqual(moralBonuses(c,data),{});
  assert.equal(moralPrice(c,21),21);
  assert.equal(residentTreatment(undefined,'market').label,'Neutral');
  assert.equal(moralClosing(c,data),'');
  const before = structuredClone(c);moralStandingPanel(c,data);assert.deepEqual(c,before);
});

test('turn-in choices are explicit, show costs, and never render a default selection', () => {
  const c = character(), q = quest('relay-00');
  const preview = decisionPanel(q,c,data), ready = decisionPanel(q,c,data,true);
  assert.doesNotMatch(preview,/data-do="quest-complete"/);
  assert.equal((ready.match(/data-do="quest-complete"/g)||[]).length,2);
  assert.match(ready,/data-choice="uphold"/);
  assert.match(ready,/data-choice="redirect"/);
  assert.match(ready,/22 gold; full XP/);
  assert.match(ready,/34 gold; full XP/);
  assert.match(ready,/permanent/);
  assert.doesNotMatch(ready,/(?:checked|selected)=/);
  c.health = 0;assert.equal((decisionPanel(q,c,data,true).match(/ disabled>/g)||[]).length,2);
});

test('a broken commitment has the same preview as the server fixture, with a costly repair path', () => {
  const c = character();c.morality = state();
  c.morality.commitments.market = 'neighbors';
  const d = data.morality.decisions['neighborhood-market-01'], choice = d.choices[1];
  const v = decisionPreview(data,c,'neighborhood-market-01',choice);
  assert.equal(v.broken,true);assert.equal(v.trust,-7);assert.equal(v.bond,-5);assert.equal(v.goldPercent,140);
  assert.match(consequenceText(data,c,'neighborhood-market-01',choice,30),/42 gold; full XP/);
  assert.match(consequenceText(data,c,'neighborhood-market-01',choice),/Breaks your earlier promise/);
  c.morality.commitments.market = 'contract';c.morality.debts.market = 1;
  const options = decisionOptions(data,'neighborhood-market-02',c), repair = options.at(-1);
  assert.equal(options.length,3);assert.equal(repair.id,'restitution');
  const r = decisionPreview(data,c,'neighborhood-market-02',repair);
  assert.equal(r.goldPercent,0);assert.equal(r.trust,4);assert.equal(r.bond,3);assert.equal(r.broken,false);assert.equal(r.pledge,'contract');
  c.morality.debts.market = 0;assert.equal(decisionOptions(data,'neighborhood-market-02',c).length,2);
  assert.equal(decisionOptions(data,'neighborhood-archive-00',c).length,2);
});

test('selected endings survive serialization and replace canonical dialogue and story reports', () => {
  const c = character(), q = quest('neighborhood-market-02');c.completed.push(q.id);c.morality = state();
  c.morality.records[q.id] = {choice:'redirect',broken:true};c.morality.bonds.nella = -20;
  const restored = JSON.parse(JSON.stringify(c)), outcome = data.morality.decisions[q.id].choices[1].outcome;
  assert.equal(decisionOutcome(q,restored,data),outcome);
  assert.equal(neighborhoodOutcome('market',restored,data),outcome);
  const dialogue = storyDialogue(data.npcs.find(n => n.id==='nella'),restored,data);
  assert.ok(dialogue.includes(outcome));assert.match(dialogue,/Trust is another matter/);
  assert.ok(!dialogue.includes(data.citylife.neighborhoods[0].stages[3].contactLine));
  const panel = campaignPanel(restored,data);
  assert.ok(panel.includes(outcome));assert.ok(!panel.includes(q.completion));
  const ledger = moralStandingPanel(restored,data);assert.ok(ledger.includes(outcome));assert.match(ledger,/BROKEN PROMISE/);
});

test('resident interests differ and distrust withholds private conversation but retains public directions', () => {
  const m = state();m.neighborhoods.market = 5;m.values = {candor:20,autonomy:-20,care:0};
  assert.equal(residentTreatment(m,'market','archivist').warm,true);
  assert.equal(residentTreatment(m,'market','patient').warm,false);
  assert.equal(residentTreatment(m,'archive','archivist').warm,false,'trust belongs to a place');
  m.neighborhoods.market = -20;
  const life = new CityLife(new World(data.world),data.citylife,data), q = quest('neighborhood-market-00');
  m.records[q.id] = {choice:'redirect',broken:false};
  life.update(Date.UTC(2026,0,1,12),[-30,0,12],{completed:[q.id],morality:m});
  const actor = life.actors.find(a => a.neighborhood==='market');assert.ok(actor);
  actor.personal='A private family account';actor.building={name:'Private room',history:'Family history'};
  const talk = life.conversation(actor,Date.UTC(2026,0,1,12));
  assert.match(talk.personal,/public directions/);assert.doesNotMatch(talk.personal,/private family account/);
  assert.equal(talk.building,null);assert.ok(talk.neighborhood.contact);
  assert.equal(talk.stage.line,data.morality.decisions[q.id].choices[1].outcome);
  life.clear();assert.equal(life.morality,null);assert.equal(life.outcomes.size,0);
});

test('bound gear has three finite ranks, one active module, and reversible dormancy', () => {
  const c = character();c.morality = state();
  c.morality.equipped='shelter';c.morality.values.care=3;
  const g = data.morality.gear.find(g=>g.id==='shelter'), baseline=stats(character(),data);
  for (const [imprints,rank] of [[0,0],[1,1],[4,1],[5,2],[11,2],[12,3],[999,3]]) {
    c.morality.imprints.shelter=imprints;
    assert.equal(moralGearState(c,data,g).rank,rank);
    assert.equal(stats(c,data).shield,baseline.shield+rank*6);
    assert.equal(stats(c,data).healing,baseline.healing+rank*3);
  }
  c.morality.values.care=1;assert.deepEqual(moralBonuses(c,data),{});
  assert.match(moralGearPanel(c,data,statText),/EQUIPPED · BONUS INACTIVE/);
  c.morality.values.care=2;assert.equal(moralBonuses(c,data).shield,18);
  c.morality.imprints.witness=12;c.morality.values.candor=20;
  assert.equal(stats(c,data).crit,baseline.crit,'unfitted gear cannot stack');
  c.morality.equipped='witness';assert.equal(stats(c,data).shield,baseline.shield);
  assert.equal(stats(c,data).crit,baseline.crit+3);
  c.dungeonReturn=[0,0,32];assert.equal((moralGearPanel(c,data,statText).match(/ disabled>/g)||[]).length,6);
});

test('Patch prices use exact shared thresholds and round up; all standings retain supply access', () => {
  const c = character();c.morality = state();
  for (const [trust,percent,price] of [[-100,120,26],[-20,120,26],[-8,110,24],[-7,100,21],[7,100,21],[8,95,20],[19,95,20],[20,85,18],[100,85,18]]) {
    c.morality.neighborhoods.market=trust;
    assert.equal(vendorPercent(c),percent);assert.equal(moralPrice(c,21),price);
    assert.ok(moralPrice(c,21)>0);
  }
});

test('consequence previews respect score saturation instead of promising impossible gains', () => {
  const c=character();c.morality=state();c.morality.values.care=100;c.morality.neighborhoods.market=99;c.morality.bonds.iri=100;
  const option=data.morality.decisions['relay-00'].choices[0];
  const preview=consequenceText(data,c,'relay-00',option);
  assert.match(preview,/Care \+0/);assert.match(preview,/trust \+1/);assert.match(preview,/Iri Vale trust \+0/);
});

test('expeditions disclose personal one-time consequences, including a neutral abstention', () => {
  const c = character(), d = data.dungeons.entries[0];
  assert.match(ballotConsequences(data,c,d,'repair'),/Streetweave guard/);
  assert.match(ballotConsequences(data,c,d,'defer'),/your own vote is saved permanently/);
  const p = data.morality.profiles.abstain;assert.deepEqual(p.values,{});assert.deepEqual(p.factions,{});assert.equal(p.gear,'');
  c.morality = state();c.morality.records['dungeon:ninth-bell']={choice:'repair',broken:false};
  assert.match(ballotConsequences(data,c,d,'name'),/Let residents oversee repairs before a public hearing/);
  assert.match(ballotConsequences(data,c,d,'name'),/Repeating this dungeon does not give/);
  c.dungeonHistory={ [d.id]:{clears:1,ending:'name'} };
  const ledger=moralStandingPanel(c,data);
  assert.match(ledger,/YOUR FIRST VOTE/);assert.match(ledger,/LATEST GROUP ENDING/);
  assert.ok(ledger.includes(d.decision.choices.find(o=>o.id==='name').ending));
  assert.ok(!ledger.includes(d.decision.choices.find(o=>o.id==='repair').ending),'a losing ballot cannot rewrite the crew outcome');
  const run={id:1,dungeon:d.id,chapter:2,attempt:1,phase:'decision',members:[],votes:{},ready:[],signed:[],evidence:[],deadline:90};
  assert.match(dungeonPanel(data,c,{run},0),/Your first vote is saved:/);
});

test('final reception reflects local trust and outstanding breaches without changing completion gates', () => {
  const c = character();c.morality = state();c.morality.records['relay-00']={choice:'redirect',broken:false};
  c.morality.neighborhoods.market=-20;c.morality.debts.relay=2;
  assert.match(moralClosing(c,data),/does not trust you yet/);assert.match(moralClosing(c,data),/2 broken promise/);
  c.morality.neighborhoods.market=20;c.morality.debts.relay=0;
  assert.match(moralClosing(c,data),/makes room at the table/);
  assert.match(moralClosing(c,data),/no broken promises left/);
});

test('decision prose and standing ledgers escape markup without mutating characters', () => {
  const custom=structuredClone(data),c=character(),q=quest('relay-00');
  custom.morality.decisions[q.id].choices[1].outcome='<img src=x onerror=alert(1)>';
  custom.morality.pledges.neighbors='<script>bad()</script>';
  const before=structuredClone(c),html=decisionPanel(q,c,custom,true);
  assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<img|<script>/);
  assert.deepEqual(c,before);
});
