// Buildless recovery checks. No browser, files, or generated assets are created.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World } from '../src/world.js';
import { Prediction, stats, availableQuest } from '../src/prediction.js';
import { isSpirit, recoveryView, bearing } from '../src/death.js';
import { Renderer } from '../src/renderer.js';
import { CharacterMeshes } from '../src/character.js';
import { npcIdentity, outfitDescription } from '../src/npc-style.js';
import { runInNewContext } from 'node:vm';
import { distance, mix3, clamp } from '../src/math.js';
import { escapeHtml, icon } from '../src/icons.js';
import { formatGold } from '../src/currency.js';
import { openingGuide, questView, questGuide, placeInfo, questProgressText, followedQuest, objectiveText } from '../src/quests.js';
import { localMapPlaces, mapLabelLayout } from '../src/map.js';
import { worldEventViews } from '../src/events.js';
import { dungeonPosition } from '../src/dungeons.js';
import { collectTargets, targetProblem, elevatorTarget, targetBounds, visibleTargets, pickTarget, cycleTarget } from '../src/targeting.js';
import { storyDialogue, questThread, campaignLead, campaignPanel } from '../src/story.js';
import { controlLabel, inputText, inputPrompt, updateInputPrompts } from '../src/input-prompts.js';
import { founderXpReward } from '../src/founders.js';
import { decisionPanel, decisionOutcome, moralPrice, vendorPercent } from '../src/morality.js';
import { collection, forgeRank } from '../src/forge.js';

const read = name => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url)));
const data = Object.fromEntries(['world', 'rules', 'races', 'factions', 'talents', 'dungeons', 'quests', 'npcs', 'events', 'abilities', 'lore', 'citylife', 'morality', 'forge'].map(n => [n, read(n)]));
for (const npc of data.npcs) Object.assign(npc, npcIdentity(npc.id));
const world = new World(data.world);
const character = () => ({ id: 'runner', position: [0, 0, 64], yaw: 0, health: 0, energy: 0, gold: 95, level: 0, race: 'human', talents: {}, death: { corpse: [0, 0, 32], graveyard: 'commons-rest', released: false, releaseAt: 15, goldLost: 5 } });

test('every graveyard is reachable, uniquely identified, and outside enemy aggro range', () => {
  assert.equal(new Set(data.world.graveyards.map(g => g.id)).size, data.world.graveyards.length);
  assert.equal(data.world.graveyards.length, 9);
  for (const g of data.world.graveyards) {
    assert.equal(world.collides(...g.position), false, g.id);
    assert.equal(world.floorAt(g.position[0], g.position[2], 1, -1), 0, g.id);
    for (const e of data.world.enemySpawns) assert.ok(Math.hypot(...g.position.map((v, i) => v - e.position[i])) > data.rules.combat.aggroRadius + data.rules.interactionRadius, g.id);
  }
});

test('release countdown and recovery state survive JSON round trips without granting life', () => {
  const c = JSON.parse(JSON.stringify(character()));
  assert.equal(recoveryView(c, data, world, 12500).wait, 3);
  assert.equal(recoveryView(c, data, world, 18000).wait, 0);
  assert.equal(isSpirit(c), false);
  assert.equal(recoveryView(c, data, world, 18000).canReclaim, false);
  c.death.released = true;
  const view = recoveryView(c, data, world, 18000);
  assert.equal(view.spirit, true);
  assert.equal(view.atHealer, true);
  assert.equal(view.distance, 32);
  assert.equal(view.healerCost, 10);
  c.gold = 10000;
  assert.equal(recoveryView(c, data, world, 18000).healerCost, 100);
  c.gold = 0;
  assert.equal(recoveryView(c, data, world, 18000).healerCost, 0);
  c.health = 1;
  assert.equal(recoveryView(c, data, world, 18000), null);
  assert.equal(isSpirit(c), false);
});

test('corpse recovery requires range, elevation, and line of sight; keeper requires proximity', () => {
  const c = character(); c.death.released = true;
  c.position = [0, 0, 44];
  assert.equal(recoveryView(c, data, world, 18000).canReclaim, true);
  assert.equal(recoveryView(c, data, world, 18000).atHealer, false);
  c.position[2] += .01;
  assert.equal(recoveryView(c, data, world, 18000).canReclaim, false);
  c.position = [0, 24, 32];
  assert.equal(recoveryView(c, data, world, 18000).canReclaim, false);
  c.position = [0, 0, 32];
  assert.equal(recoveryView(c, data, { lineOfSight: () => false }, 18000).canReclaim, false);
});

test('only released spirits move while dead, and prediction does not restore health or energy', () => {
  const c = character(), prediction = new Prediction(data, world, c);
  for (let i = 0; i < 20; i++) prediction.tick(.05, { forward: 1 });
  assert.deepEqual(c.position, [0, 0, 64]);
  c.death.released = true;
  for (let i = 0; i < 20; i++) prediction.tick(.05, { forward: 1 });
  assert.ok(c.position[2] < 55);
  assert.equal(c.health, 0);
  assert.equal(c.energy, 0);
  assert.ok(Math.abs(prediction.velocity[2] + data.rules.movement.speed * data.rules.death.spiritSpeedMultiplier) < .001);
});

test('sickness applies to damage and movement while preserving base vitals and build bonuses', () => {
  const c = character(), normal = stats(c, data);
  c.resurrectionSickness = 60;
  const sick = stats(c, data);
  assert.equal(sick.damage, normal.damage * .5);
  assert.equal(sick.speed, normal.speed * .75);
  assert.equal(sick.health, normal.health);
  assert.equal(sick.energy, normal.energy);
});

test('directional guidance follows camera heading in all quadrants', () => {
  const origin = [0, 0, 0];
  assert.equal(bearing(origin, [0, 0, -10]), '↑');
  assert.equal(bearing(origin, [10, 0, 0]), '→');
  assert.equal(bearing(origin, [0, 0, 10]), '↓');
  assert.equal(bearing(origin, [-10, 0, 0]), '←');
  assert.equal(bearing(origin, [-10, 0, 0], Math.PI / 2), '↑');
});

test('fallen-body geometry remains finite at both quality levels', () => {
  const models = JSON.parse(readFileSync(new URL('../assets/models.json', import.meta.url)));
  for (const quality of [.5, 1]) {
    const renderer = { models, characters: new CharacterMeshes(models), quality }, vertices = [];
    Renderer.prototype.actor.call(renderer, vertices, { id: 'body', model: 'humanoid', race: 'human', position: [0, 0, 32], corpse: true }, 0);
    assert.ok(vertices.length > 1000);
    assert.ok(vertices.every(Number.isFinite));
  }
});

// Exercise application wiring in memory; this is not a browser/WebGL acceptance test.
function application(c) {
  const nodes = new Map(), promptNodes = new Map(), sent = [], spoken = [], drawing = [];
  const canvasContext = Object.fromEntries(['fillRect','strokeRect','beginPath','arc','fill','stroke','moveTo','lineTo','closePath','fillText','save','translate','rotate','restore'].map(name => [name, (...args) => drawing.push([name, ...args])]));
  canvasContext.measureText = text => ({ width: text.length * 7.2 });
  let sectionReads = [];
  const node = selector => {
    if (!nodes.has(selector)) {
      const classes = new Set();
      nodes.set(selector, { hidden: true, open: false, textContent: '', innerHTML: '', scrollTop: 0, dataset: {}, querySelectorAll: () => [],
        classList: { toggle: (key, on) => on ? classes.add(key) : classes.delete(key), remove: key => classes.delete(key) },
        focus() {}, showModal() { this.open = true; }, close() { this.open = false; }, setAttribute() {},
        width: 900, height: 720, getContext: () => canvasContext,
        listeners: {}, addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); },
      });
    }
    return nodes.get(selector);
  };
  const simulation = new Prediction(data, world, c);
  const context = { fixtureData: data, fixtureWorld: world, fixtureSimulation: simulation, sent, spoken,
    document: { querySelector: node, querySelectorAll: selector => selector === '[data-story-section]' ? sectionReads.shift() || [] : promptNodes.get(selector) || [], addEventListener() {} },
    window: { addEventListener() {} },
    setTimeout() {}, clearTimeout() {},
    matchMedia: () => ({ matches: true }), WorldClock: class { now() { return 18000; } sync() {} },
    distance, mix3, clamp, isSpirit, recoveryView, bearing, openingGuide, questView, questGuide, placeInfo, questProgressText, followedQuest, objectiveText, localMapPlaces, mapLabelLayout,
    storyDialogue, questThread, campaignLead, campaignPanel, controlLabel, inputText, inputPrompt, updateInputPrompts,
    founderXpReward, decisionPanel, decisionOutcome, moralPrice, vendorPercent, collection, forgeRank, formatGold, icon, outfitDescription,
    worldEventViews, collectTargets, targetProblem, elevatorTarget, targetBounds, visibleTargets, pickTarget, cycleTarget, availableQuest, esc: escapeHtml,
  };
  let source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8').replace(/^import .*;$/gm, '');
  source = source.slice(0, source.lastIndexOf('boot().catch'));
  runInNewContext(source + `\ndata=fixtureData;world=fixtureWorld;simulation=fixtureSimulation;renderer={quality:1,volumetric:true};audio={stopVoice(){},effect(){},speak(...args){spoken.push(args);}};input={lastDevice:'keyboard',clear(){}};connection={send(action){sent.push(action);}};cityLife={actors:[],neighborhoods:new Map(),overheard(){return null;}};state='playing';globalThis.harness={inputBlocked,wireEvents,connection,setChat(value){liveChat=value;},setScreen(value){state=value;},setDevice(value){input.lastDevice=value;},menu(){return input.menu;},perform,showJournal,showShop,showGuide,onEvent,questCard,nextQuestGuide,showMap,drawMap,updateLabels,selectedTarget,targetCandidates,updateRecoveryUI,updateStoryGuide,onSnapshot,panel,closePanel,select(key){targetKey=key;},setRenderer(value){renderer=value;},setPlayers(value){otherPlayers=value;}};`, context);
  return { ...context.harness, node, sent, spoken, drawing, simulation, prompts(selector,values){promptNodes.set(selector,values);}, sections(before, after, focus) { sectionReads = [before, after]; context.document.activeElement = focus; } };
}

test('chat focus and death independently keep gameplay input blocked across panel closing', () => {
  const c = { ...character(), health: 100, death: undefined }, app = application(c);
  assert.equal(app.inputBlocked(), false);
  const chat = { expanded: true }; app.setChat(chat);
  assert.equal(app.inputBlocked(), true); app.closePanel(); assert.equal(app.menu(), true);
  chat.expanded = false; assert.equal(app.inputBlocked(), false);
  c.health = 0; assert.equal(app.inputBlocked(), true); app.closePanel(); assert.equal(app.menu(), true);
  c.death = { ...character().death, released: true }; assert.equal(app.inputBlocked(), false);
});

test('Escape menu sends an unstuck request and waits for the server to move the character', async () => {
  const c = { ...character(), health: 50, energy: 20, death: undefined }, app = application(c);
  app.wireEvents();
  app.perform('escape');
  assert.equal(app.node('#dialog-title').textContent, 'Settings.');
  assert.match(app.node('#dialog-content').innerHTML, /data-do="unstuck"\s*>UNSTUCK/);
  assert.match(app.node('#dialog-content').innerHTML, /Return to the Commons/);
  const before = structuredClone(c);
  const button = { dataset: { do: 'unstuck' } };
  await app.node('#dialog-content').listeners.click[0]({ target: { closest: () => button } });
  assert.deepEqual(JSON.parse(JSON.stringify(app.sent)), [{ type: 'unstuck' }]);
  assert.deepEqual(c, before, 'only the server may relocate or change the character');
  assert.equal(app.node('#panel-dialog').open, false);
  assert.equal(app.inputBlocked(), false);
});

test('unstuck menu describes the current destination and is disabled while dead', () => {
  const c = { ...character(), health: 50, death: undefined, tutorialStage: 'combat' }, app = application(c);
  app.perform('settings');
  assert.match(app.node('#dialog-content').innerHTML, /Return to the training courtyard/);
  app.simulation.dungeonState = { run: { phase: 'active' } };
  app.perform('settings');
  assert.match(app.node('#dialog-content').innerHTML, /Return to the dungeon entrance/);
  c.health = 0;
  app.perform('settings');
  assert.match(app.node('#dialog-content').innerHTML, /data-do="unstuck" disabled/);
  assert.equal(app.sent.length, 0);
});

test('unstuck snapshots snap even short moves and clear motion once without restoring resources', () => {
  for (const offset of [0, 1, 5, 50]) {
    const c = { ...character(), position: [0, 0, 32 + offset], health: 50, energy: 20, death: undefined, activeQuests: {}, completed: [] };
    const app = application(c), simulation = app.simulation;
    simulation.velocity = [2, -3, 4];simulation.dash = .2;simulation.jumpBuffer = .1;simulation.coyote = .1;simulation.grounded = false;
    simulation.cooldowns = { arc: 20, unstuck: 10 };simulation.dashReady = 15;
    app.connection.pendingJump = true;app.connection.pendingDash = true;
    app.select('terminal:commons-water');
    const server = { ...structuredClone(c), position: [0, 0, 32] };
    app.onSnapshot({ character: server, time: 11, cooldowns: { arc: 20, unstuck: 41 }, dashReady: 15 });
    assert.deepEqual(simulation.character.position, [0, 0, 32]);
    assert.equal(simulation.velocity.join(','), '0,0,0');
    assert.equal(simulation.dash, 0);assert.equal(simulation.jumpBuffer, 0);assert.equal(simulation.coyote, 0);assert.equal(simulation.grounded, true);
    assert.equal(app.connection.pendingJump, false);assert.equal(app.connection.pendingDash, false);
    assert.equal(app.selectedTarget(), null);
    assert.equal(simulation.character.health, 50);assert.equal(simulation.character.energy, 20);assert.equal(simulation.character.gold, c.gold);
    assert.equal(simulation.cooldowns.arc, 20);assert.equal(simulation.dashReady, 15);
    simulation.velocity = [1, 0, 0];
    app.onSnapshot({ character: structuredClone(server), time: 11.1, cooldowns: { arc: 20, unstuck: 41 }, dashReady: 15 });
    assert.deepEqual(simulation.velocity, [1, 0, 0], 'later snapshots must not repeatedly stop movement');
  }
});

test('story controls open the current account and guidance continues after the kitchen', () => {
  const c = { ...character(), health: 100, death: undefined, faction: 'relay', activeQuests: {}, completed: [] }, app = application(c);
  app.perform('story');
  assert.equal(app.node('#dialog-title').textContent, 'The Living Record');
  assert.ok(app.node('#dialog-content').innerHTML.includes(data.lore.campaign.premise));
  app.closePanel(); app.updateStoryGuide();
  assert.equal(app.node('#story-guide').hidden, false);
  assert.equal(app.node('#quest-map').hidden, false);
  c.completed.push('relay-00', 'human-00', 'neighborhood-market-00', 'neighborhood-market-01', 'neighborhood-market-02');
  app.updateStoryGuide();
  assert.equal(app.node('#story-guide').hidden, false);
  assert.equal(app.node('#quest-map').hidden, true,'locked quests do not send players to an unusable destination');
  assert.match(app.node('#story-instruction').textContent, /level 2/);
  c.level=2;app.updateStoryGuide();
  assert.equal(app.node('#quest-map').hidden,false,'the same tracker continues after the opening');
  assert.equal(app.nextQuestGuide().destination.id,data.quests.find(q=>q.id==='relay-01').giver);
  assert.equal(app.sent.length, 0, 'opening the story never sends a reward or progression action');
});

test('the journal opens to the same next step as the HUD, with optional lessons collapsed',()=>{
  const c={...character(),health:100,death:undefined,faction:'relay',activeQuests:{},completed:[]},app=application(c);
  app.updateStoryGuide();app.perform('journal');
  const html=app.node('#dialog-content').innerHTML;
  assert.equal(app.node('#dialog-title').textContent,'Quests');
  assert.ok(html.includes(escapeHtml(app.node('#story-instruction').textContent)));
  assert.equal((html.match(/<article/g)||[]).length,1,'the default journal presents one destination');
  assert.match(html,/<details[^>]*data-story-section="journal-more"\s*>/);
  assert.match(html,/<details[^>]*data-story-section="social-lesson"\s*>/);
  assert.doesNotMatch(html,/Your investigation/,'story history is available through More');
  app.showJournal('active');assert.match(app.node('#dialog-content').innerHTML,/No quests in progress/);
  app.closePanel();app.perform('journal');
  assert.match(app.node('#dialog-content').innerHTML,/class="selected"[^>]*data-id="next"/);
  assert.equal(app.sent.length,0);
});

test('quest cards expose acceptance and final choices only at the correct stage and contact',()=>{
  const q=data.quests.find(q=>q.id==='relay-00');
  const c={...character(),health:100,death:undefined,faction:'relay',activeQuests:{},completed:[]},app=application(c);
  const before=structuredClone(c),offer=app.questCard(q,c,true);
  assert.match(offer,/0\.03 base gold/);
  assert.ok(offer.indexOf('data-do="quest-accept"')<offer.indexOf('<details'),'acceptance does not require opening the full briefing');
  assert.doesNotMatch(app.questCard(q,c),/data-do="quest-accept"/);
  assert.doesNotMatch(offer,/data-do="quest-complete"/);
  assert.deepEqual(c,before);
  c.activeQuests[q.id]=0;c.questStages={[q.id]:{index:1,progress:0}};
  const active=app.questCard(q,c,true);
  assert.ok(active.slice(0,active.indexOf('<details')).includes(escapeHtml(questGuide(q,c,data).instruction)));
  assert.doesNotMatch(active,/data-do="quest-accept"|data-do="quest-complete"/);
  c.activeQuests[q.id]=q.objective.count;c.questStages[q.id].index=q.steps.length;
  const ready=app.questCard(q,c,true);
  assert.match(ready,/READY TO FINISH/);
  assert.equal((ready.match(/data-do="quest-complete"/g)||[]).length,2);
  assert.ok(ready.indexOf('data-do="quest-complete"')<ready.indexOf('class="quest-details"'));
  assert.doesNotMatch(app.questCard(q,c),/data-do="quest-complete"/,'remote journal views cannot submit a settlement');
  c.completed.push(q.id);delete c.activeQuests[q.id];delete c.questStages[q.id];
  assert.doesNotMatch(app.questCard(q,c,true),/data-do="quest-accept"|data-do="quest-complete"/);
  assert.equal(app.sent.length,0,'rendering a quest never changes saved progress');
});

test('shop prices, reward notices, and recovery instructions use the same fractional gold scale',()=>{
  const c={...character(),gold:45,weaponRank:0,health:100,death:undefined,faction:'relay',activeQuests:{},completed:[]},app=application(c);
  app.showShop();
  assert.match(app.node('#dialog-content').innerHTML,/YOUR BALANCE · 0\.045 gold/);
  assert.match(app.node('#dialog-content').innerHTML,/BUY \/ 0\.018 gold/);
  assert.match(app.node('#dialog-content').innerHTML,/UPGRADE \/ 0\.09 gold/);
  c.morality={neighborhoods:{market:20}};app.showShop();
  assert.match(app.node('#dialog-content').innerHTML,/BUY \/ 0\.016 gold/,'discounts round up to a thousandth');
  app.onEvent({type:'reward',gold:5,xp:28});
  assert.match(app.node('#combat-log').innerHTML,/Recovered 0\.005 gold · \+28 XP/);
  app.onEvent({type:'questComplete',quest:data.quests.find(q=>q.id==='relay-00'),gold:22,xp:220});
  assert.match(app.node('#toast').textContent,/\+220 XP \/ \+0\.022 gold/);
  app.showGuide();
  assert.match(app.node('#dialog-content').innerHTML,/next 0\.001 gold and capped at 0\.05 gold/);
  assert.match(app.node('#dialog-content').innerHTML,/next 0\.001 gold and capped at 0\.1 gold/);
  assert.equal(c.gold,45);assert.equal(app.sent.length,0);
});

test('quest snapshots retain the selected journal view and put ready quests first',()=>{
  const c={...character(),health:100,death:undefined,faction:'relay',activeQuests:{'relay-00':0,'human-00':0},completed:[]},app=application(c);
  app.showJournal('active');
  const saved=structuredClone(c);saved.activeQuests['human-00']=1;
  app.onSnapshot({character:saved,time:10,worldEvents:[]});
  const html=app.node('#dialog-content').innerHTML;
  assert.match(html,/class="selected"[^>]*data-id="active"/);
  assert.ok(html.indexOf(data.quests.find(q=>q.id==='human-00').title)<html.indexOf(data.quests.find(q=>q.id==='relay-00').title));
  app.closePanel();app.perform('journal');
  assert.match(app.node('#dialog-content').innerHTML,/class="selected"[^>]*data-id="next"/);
});

test('later quest guidance follows field work back to its contact and handles the completed story',()=>{
  const q=data.quests.find(q=>q.id==='relay-30');
  const c={...character(),health:100,death:undefined,faction:'relay',level:60,activeQuests:{[q.id]:0},completed:data.quests.filter(q=>q.id!=='relay-30').map(q=>q.id)},app=application(c);
  app.updateStoryGuide();
  assert.equal(placeInfo(app.nextQuestGuide().destination,data).region,'basin');
  assert.equal(app.node('#quest-map').hidden,false);
  c.activeQuests[q.id]=q.objective.count;app.updateStoryGuide();
  assert.equal(placeInfo(app.nextQuestGuide().destination,data).region,'city');
  assert.equal(app.nextQuestGuide().destination.id,q.giver);
  assert.match(app.node('#story-instruction').textContent,/Return to/);
  c.completed.push(q.id);delete c.activeQuests[q.id];app.updateStoryGuide();
  assert.equal(app.node('#quest-map').hidden,true);
  assert.match(app.node('#story-instruction').textContent,/Main story complete/);
  app.perform('journal');assert.match(app.node('#dialog-content').innerHTML,/Main story complete/);
  assert.equal(app.sent.length,0);
});

test('following a neighborhood story drives the tracker and map through its handover',async()=>{
  const q=data.quests.find(q=>q.id==='neighborhood-archive-00');
  const c={...character(),health:100,death:undefined,faction:'relay',level:60,activeQuests:{[q.id]:0},questStages:{[q.id]:{index:0,progress:0}},completed:[]},app=application(c);
  app.wireEvents();
  const click=app.node('#dialog-content').listeners.click[0];
  await click({target:{closest:()=>({dataset:{do:'quest-follow',id:q.id}})}});
  assert.equal(app.nextQuestGuide().quest.id,q.id);
  assert.match(app.node('#story-direction').textContent,/Elin.*Public memory archive/);
  app.showMap();
  assert.match(app.node('#dialog-content').innerHTML,/CURRENT QUEST/);
  assert.ok(app.node('#dialog-content').innerHTML.includes(escapeHtml(q.title)));
  assert.ok(app.drawing.some(call=>call[0]==='fillText'&&call[1]==='Unsorted witness shelf'));
  const saved=structuredClone(c);saved.activeQuests[q.id]=q.objective.count;saved.questStages[q.id].index=q.steps.length;
  app.onSnapshot({character:saved,time:10,worldEvents:[]});
  assert.match(app.node('#dialog-content').innerHTML,/READY TO FINISH/);
  assert.match(app.node('#dialog-content').innerHTML,/Return to Elin Voss/);
  const completed=structuredClone(saved);completed.completed.push(q.id);delete completed.activeQuests[q.id];delete completed.questStages[q.id];
  app.onSnapshot({character:completed,time:11,worldEvents:[]});
  assert.equal(app.nextQuestGuide().quest.id,'neighborhood-archive-01');
  assert.ok(app.node('#dialog-content').innerHTML.includes(escapeHtml(data.quests.find(q=>q.id==='neighborhood-archive-01').title)));
  await click({target:{closest:()=>({dataset:{do:'quest-follow',id:''}})}});
  assert.equal(app.nextQuestGuide().quest.id,'relay-00');
  assert.equal(app.sent.length,0,'tracking and map navigation never mutate server progress');
});

test('a quest map shows the selected quest independently of the tracker and updates after each step',()=>{
  const q=data.quests.find(q=>q.id==='neighborhood-skybridge-02');
  const c={...character(),health:100,death:undefined,faction:'relay',level:60,activeQuests:{[q.id]:0},questStages:{[q.id]:{index:0,progress:0}},completed:[]},app=application(c);
  app.showMap('local',q.id);
  let html=app.node('#dialog-content').innerHTML;
  assert.ok(html.includes(escapeHtml(q.title)));
  assert.match(html,/Transit lift.*Night crew ramp/);
  assert.equal(app.nextQuestGuide().quest.id,'relay-00');
  const saved=structuredClone(c);saved.questStages[q.id]={index:1,progress:4};
  app.onSnapshot({character:saved,time:10,worldEvents:[]});
  html=app.node('#dialog-content').innerHTML;
  assert.match(html,/Stay near Service-pass counter/);
  assert.match(html,/4\/10 seconds/);
  assert.doesNotMatch(html,/OBJECTIVES|QUEST CONTACTS|SHOW ON MAP/);
});

test('map labels and world names do not become quest pins or exclamation marks',()=>{
  const c={...character(),health:100,death:undefined,position:[0,0,0],faction:'relay',activeQuests:{},completed:[]},app=application(c);
  app.showMap('city');
  const before=JSON.stringify(app.drawing);app.drawing.length=0;
  c.activeQuests['relay-00']=0;c.activeQuests['human-00']=1;
  app.drawMap(app.node('#full-map'),true);
  assert.equal(JSON.stringify(app.drawing),before,'accepting quests adds no objective shapes or coordinates to the map');
  app.setRenderer({project:p=>[450+p[0],360+p[2],.5]});
  app.setChat({expanded:false,feed:{labels:()=>''}});
  app.updateLabels();
  assert.match(app.node('#world-labels').innerHTML,/Iri Vale/);
  assert.doesNotMatch(app.node('#world-labels').innerHTML,/quest-mark|story-waypoint|◇/);
});

test('open quest help switches input devices without losing the current panel',()=>{
  const q=data.quests.find(q=>q.id==='relay-00');
  const c={...character(),health:100,death:undefined,faction:'relay',activeQuests:{[q.id]:0},completed:['human-00']},app=application(c);
  app.showJournal('active');
  const hint={dataset:{questHint:q.id},textContent:''};app.prompts('[data-quest-hint]',[hint]);
  const html=app.node('#dialog-content').innerHTML;
  for(const [device,pattern]of [['keyboard',/press E/],['gamepad',/then X/],['touch',/then USE/]]){
    app.setDevice(device);app.updateStoryGuide();assert.match(hint.textContent,pattern);
    assert.equal(app.node('#dialog-content').innerHTML,html);
  }
});

test('a new chapter preserves expanded evidence and summary focus by identity', () => {
  const c = { ...character(), health: 100, death: undefined, faction: 'relay', activeQuests: {}, completed: ['relay-00', 'human-00'] }, app = application(c);
  app.perform('story');
  const before = { dataset: { storySection: 'place:archive' }, open: true };
  let focused = false;
  const after = { dataset: { storySection: 'place:archive' }, open: false, querySelector: () => ({ focus() { focused = true; } }) };
  const chapter = { dataset: { storySection: 'chapter:absent' }, open: true };
  app.sections([before], [chapter, after], { tagName: 'SUMMARY', parentElement: before });
  app.node('#panel-dialog').scrollTop = 300;
  const saved = structuredClone(c);
  saved.completed.push('neighborhood-market-00', 'neighborhood-market-01', 'neighborhood-market-02');
  app.onSnapshot({ character: saved, serverTime: 18000 });
  assert.equal(after.open, true, 'inserting a chapter must not shift another record’s state');
  assert.equal(chapter.open, true, 'the newly reached chapter keeps its default expansion');
  assert.equal(focused, true);
  assert.equal(app.node('#panel-dialog').scrollTop, 300);
});

test('authoritative milestones announce newly earned frame parts once',()=>{
  const c={...character(),health:100,death:undefined,faction:'relay',activeQuests:{},completed:data.quests.slice(0,7).map(q=>q.id)},app=application(c);
  const saved=structuredClone(c);saved.completed.push(data.quests[7].id);
  app.onSnapshot({character:saved,serverTime:18000});
  assert.match(app.node('#toast').textContent,/FRAME PART EARNED · Storm reactor/);
  assert.equal(app.simulation.character.forge,undefined,'earning a cosmetic does not silently equip it');
  app.node('#toast').textContent='';app.onSnapshot({character:structuredClone(saved),serverTime:18001});
  assert.equal(app.node('#toast').textContent,'','repeated snapshots cannot repeat the award');
});

test('tutorial HUD, journal, selection, and snapshots hand off to the existing story', () => {
  const area=data.world.tutorial;
  const c={...character(),health:100,death:undefined,faction:'relay',activeQuests:{},completed:[],tutorialStage:'combat',position:[...area.spawn]};
  const app=application(c);
  app.updateStoryGuide();
  assert.equal(app.node('#campaign-chapter').textContent,'TUTORIAL · 3/4');
  assert.match(app.node('#story-instruction').textContent,/practice target/);
  assert.equal(app.node('#story-help').open,true);
  app.perform('journal');
  assert.match(app.node('#dialog-content').innerHTML,/First Steps Courtyard/);
  app.closePanel();app.select(`practice:${area.target}`);app.perform('ability:arc');
  assert.equal(app.sent.at(-1).target,area.target);
  app.perform('interact');assert.equal(app.sent.at(-1).id,'arc');
  c.position=[...data.world.landmarks.find(l=>l.id===area.exit).position];
  app.select(`terminal:${area.exit}`);app.perform('interact');
  assert.equal(app.sent.at(-1).id,area.exit);
  assert.equal(c.tutorialStage,'combat','the client waits for server confirmation before leaving');
  const saved={...c,position:[...data.world.spawn]};delete saved.tutorialStage;
  app.onSnapshot({character:saved,time:10,worldEvents:[]});app.updateStoryGuide();
  assert.equal(app.node('#campaign-chapter').textContent,'MAIN STORY');
  assert.equal(app.node('#story-help').open,false);
  assert.match(app.node('#story-instruction').textContent,/Iri/);
  assert.equal(app.selectedTarget(),null);
});

test('tutorial prompts change in both HUD and an open journal without replacing the panel',()=>{
  const c={...character(),health:100,death:undefined,faction:'relay',activeQuests:{},completed:[],tutorialStage:'move'};
  const app=application(c),hint={textContent:''};
  app.perform('journal');app.prompts('[data-tutorial-hint]',[hint]);
  const panelHtml=app.node('#dialog-content').innerHTML;app.node('#panel-dialog').scrollTop=150;
  for(const stage of ['move','interact','combat','exit']){
    c.tutorialStage=stage;
    for(const device of ['gamepad','keyboard','touch']){
      app.setDevice(device);app.updateStoryGuide();
      const expected=openingGuide(c,data,[],device).hint;
      assert.equal(app.node('#story-hint').textContent,expected);
      assert.equal(hint.textContent,expected);
      assert.equal(app.node('#dialog-content').innerHTML,panelHtml);
      assert.equal(app.node('#panel-dialog').scrollTop,150);
    }
  }
  assert.equal(app.sent.length,0,'device changes never send progression actions');
});

test('the first tutorial instruction is narrated after the cinematic finishes', () => {
  const c={...character(),health:100,death:undefined,faction:'relay',activeQuests:{},completed:[],tutorialStage:'move'};
  const app=application(c);
  app.setScreen('cinematic');app.updateStoryGuide();
  assert.equal(app.spoken.length,0);
  app.setScreen('playing');app.updateStoryGuide();app.updateStoryGuide();
  assert.equal(app.spoken.length,1);
  assert.match(app.spoken[0][0],/cyan square/);
});

test('application enables spirit recovery, body interaction, and a controller-accessible recovery menu', () => {
  const c = { ...character(), faction: 'relay', activeQuests: {}, completed: [] }, app = application(c);
  app.updateRecoveryUI();
  assert.equal(app.node('#death-screen').hidden, false);
  assert.match(app.node('#death-description').textContent,/You lost 0\.005 gold/);
  assert.equal(app.node('#respawn').disabled, false);
  c.death.released = true;
  app.updateRecoveryUI();
  assert.equal(app.node('#death-screen').hidden, true);
  assert.equal(app.node('#recovery-panel').hidden, false);
  app.select('healer:commons-rest');
  app.perform('interact');
  assert.equal(app.node('#panel-dialog').open, true);
  assert.match(app.node('#dialog-content').innerHTML, /Weakened for 60 seconds/);
  assert.match(app.node('#dialog-content').innerHTML, /Damage is reduced by 50% and movement by 25%/);
  assert.match(app.node('#dialog-content').innerHTML, /0\.01 gold/);
  assert.match(app.node('#dialog-content').innerHTML, /capped at 0\.1 gold/);
  app.closePanel();
  c.position = [...c.death.corpse];
  app.select('corpse:runner');
  app.perform('interact');
  assert.equal(app.sent.at(-1).type, 'reclaimCorpse');
  app.perform('settings');
  assert.match(app.node('#dialog-content').innerHTML, /data-do="return-graveyard"/);
});

test('guided evidence remains readable when a live incident shares its terminal', () => {
  const c = { ...character(), health: 100, death: undefined, faction: 'relay', position: [36, 0, 40], activeQuests: { 'neighborhood-market-01': 0 }, questStages: { 'neighborhood-market-01': { index: 0, progress: 0 } }, completed: ['relay-00', 'human-00', 'neighborhood-market-00'] };
  const app = application(c);
  app.simulation.worldEvents = worldEventViews(data, [{ id: 'water-lockout', state: { phase: 'active', cycle: 1, repaired: [], hold: 0, deadline: 150 } }]);
  app.select('terminal:commons-water');
  assert.equal(app.selectedTarget().kind, 'terminal');
  assert.equal(app.selectedTarget().object.id, 'commons-water');
  app.perform('interact');
  assert.equal(app.sent.at(-1).type, 'interact');
  app.closePanel();
  c.questStages['neighborhood-market-01'].index = 1;
  assert.equal(app.selectedTarget().kind, 'incident');
  app.perform('interact');
  assert.equal(app.sent.at(-1).type, 'worldEvent');
  assert.equal(app.sent.at(-1).cycle, 1);
});

test('clicks select enemies and contacts through the same state; right click and E activate that selection', () => {
  const npc = data.npcs.find(n => n.id !== 'merchant');
  const c = { ...character(), health: 100, death: undefined, faction: 'relay', position: [...npc.position], activeQuests: {}, completed: data.quests.map(q => q.id) };
  const app = application(c), enemy = { id: 'machine', name: 'Machine', position: npc.position.map((v, i) => v + (i === 0 ? 2 : 0)), health: 50 };
  app.simulation.enemies = [enemy];
  const objects = [npc, enemy];
  app.setRenderer({ canvas: { clientWidth: 800, clientHeight: 600, getBoundingClientRect: () => ({ left: 20, top: 30 }) }, project: p => {
    const i = objects.findIndex(o => o.position[0] === p[0] && o.position[2] === p[2]);
    return i < 0 ? null : [100 + i * 100, 300 - (p[1] - npc.position[1]) * 15, .5];
  } });
  app.perform('pick', { clientX: 220, clientY: 310 });
  assert.equal(app.selectedTarget().object.id, enemy.id);
  assert.equal(app.sent.length, 0, 'selection alone never attacks');
  app.perform('ability:arc');
  assert.equal(app.sent.at(-1).target, enemy.id);
  app.perform('interact');
  assert.equal(app.sent.at(-1).id, 'arc', 'default activation attacks the selected enemy');
  app.perform('pick', { clientX: 120, clientY: 310 });
  assert.equal(app.selectedTarget().object.id, npc.id);
  assert.equal(app.node('#panel-dialog').open, false, 'left click only selects a contact');
  app.perform('ability:arc');
  assert.equal(app.sent.at(-1).target, null, 'friendly selection cannot reuse the previous enemy');
  app.perform('interact');
  assert.equal(app.node('#dialog-title').textContent, npc.name);
  app.closePanel();
  app.perform('pick-activate', { clientX: 220, clientY: 310 });
  assert.equal(app.sent.at(-1).target, enemy.id);
  app.perform('pick', { clientX: 750, clientY: 550 });
  assert.equal(app.selectedTarget(), null);
  const count = app.sent.length;
  app.perform('interact');
  assert.equal(app.sent.length, count, 'no selection must not activate the nearby contact');
  assert.match(app.node('#toast').textContent, /Select a target/);
  app.perform('target');
  assert.equal(app.selectedTarget().object.id, npc.id);
  app.perform('target');
  assert.equal(app.selectedTarget().object.id, enemy.id);
  app.perform('escape');
  assert.equal(app.selectedTarget(), null);
  assert.equal(app.node('#panel-dialog').open, false);
});

test('selected services retain their identity out of range and stale enemies cannot be attacked', () => {
  const c = { ...character(), health: 100, death: undefined, faction: 'relay', position: [36, 0, 40], activeQuests: {}, completed: data.quests.map(q => q.id) };
  const app = application(c), terminal = data.world.landmarks.find(l => l.id === 'commons-water');
  c.position = [terminal.position[0], terminal.position[1] + 20, terminal.position[2]];
  app.select('terminal:commons-water');app.perform('interact');
  assert.equal(app.sent.length, 0);assert.match(app.node('#toast').textContent, /Move within/);
  assert.equal(app.selectedTarget().object.id, 'commons-water');
  c.position = [...terminal.position];app.perform('interact');
  assert.equal(app.sent.at(-1).id, 'commons-water');app.closePanel();
  app.simulation.enemies = [{ id: 'machine', position: [...c.position], health: 100 }];
  app.select('enemy:machine');app.simulation.enemies[0].health = 0;
  app.perform('ability:arc');assert.equal(app.sent.at(-1).target, null);assert.equal(app.selectedTarget(), null);
  app.simulation.enemies[0].health = 100;app.select('enemy:machine');app.simulation.enemies = [];
  assert.equal(app.selectedTarget(), null);
  app.select('terminal:commons-water');app.panel('Menu', '', '', 'settings');
  const count = app.sent.length;app.perform('interact');app.perform('pick-activate', {});
  assert.equal(app.sent.length, count, 'open menus block world actions');
});

test('dungeon evidence, recovery, and ally revival send the selected action with current run metadata', () => {
  const c = { ...character(), health: 100, death: undefined, faction: 'relay', position: [...data.dungeons.rules.arena], activeQuests: {}, completed: [] };
  const app = application(c), dungeon = data.dungeons.entries[0], evidence = dungeon.chapters[0].evidence[0];
  const run = { id: 7, dungeon: dungeon.id, chapter: 0, attempt: 2, phase: 'active', members: [{ id: 'ally' }], recoveryReady: 0, revivesLeft: 2 };
  app.simulation.dungeonState = { run };
  c.position = dungeonPosition(data.dungeons.rules, evidence.position);
  app.select(`evidence:${evidence.id}`);app.perform('interact');
  assert.deepEqual(JSON.parse(JSON.stringify(app.sent.at(-1))), { type: 'dungeon', operation: 'interact', run: 7, chapter: 0, attempt: 2, target: evidence.id });
  c.position = [...data.dungeons.rules.recoveryPosition];app.select('recover:aid');app.perform('interact');
  assert.equal(app.sent.at(-1).operation, 'recover');
  app.setPlayers([{ id: 'ally', name: 'Ally', position: [...c.position], health: 0 }]);
  app.select('player:ally');app.perform('interact');
  assert.equal(app.sent.at(-1).operation, 'revive');assert.equal(app.sent.at(-1).target, 'ally');
  app.setPlayers([{ id: 'ally', name: 'Ally', position: [...c.position], health: 100 }]);
  const count = app.sent.length;app.perform('interact');assert.equal(app.sent.length, count);
  app.select(`evidence:${evidence.id}`);run.phase = 'briefing';assert.equal(app.selectedTarget(), null);
});

test('death snapshots close stale quest panels and recovery teleports reset predicted motion', () => {
  const c = { ...character(), health: 100, death: undefined, faction: 'relay', activeQuests: {}, completed: [], position: [0, 0, 32] };
  const app = application(c);
  app.select('terminal:commons-water');
  app.panel('Journal', '', '', 'journal');
  app.simulation.velocity = [2, 0, 3];
  const dead = { ...c, health: 0, death: character().death, activeQuests: { 'relay-00': 0 } };
  app.onSnapshot({ character: dead, time: 1, worldEvents: [] });
  assert.equal(app.selectedTarget(), null);
  assert.equal(app.node('#panel-dialog').open, false, 'a changed quest cursor must not reopen the dialog after death');
  assert.equal(app.simulation.velocity.join(','), '0,0,0');
  const spirit = { ...dead, death: { ...dead.death, released: true }, position: [0, 0, 33] };
  app.onSnapshot({ character: spirit, time: 2, worldEvents: [] });
  assert.equal(app.simulation.character.position[2], 33, 'release must not blend with corpse position');
  app.simulation.velocity = [2, 0, 3];
  app.onSnapshot({ character: { ...spirit, position: [0, 0, 64] }, time: 3, worldEvents: [] });
  assert.equal(app.simulation.velocity.join(','), '0,0,0');
});
