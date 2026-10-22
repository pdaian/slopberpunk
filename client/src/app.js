// Sloperberpunk browser application. GPL-3.0-or-later. See LICENSE.
import { World } from './world.js';
import { Renderer } from './renderer.js';
import { Prediction,availableQuest,experienceFor,stats } from './prediction.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { Connection,api } from './network.js';
import { icon,escapeHtml as esc } from './icons.js';
import { clamp,distance,mix3,lerp } from './math.js';
import { Community } from './social.js';
import { WorldClock,clockLabel } from './clock.js';
import { downloadCharacter } from './persistence.js';
import { ghostPosition } from './ghostline.js';
import { hasFounderHalo, founderBoostActive, founderXpReward, founderOfferView } from './founders.js';
import { validateDungeons, dungeonPanel, dungeonPosition } from './dungeons.js';
import { CityLife, validateCityLife, cityStage, cityEvent } from './citylife.js';
import { questView, questDestination, objectiveText, openingGuide } from './quests.js';
import { validateWorldEvents, worldEventViews, incidentStatus, incidentTargets } from './events.js';
import { isSpirit, recoveryView, bearing } from './death.js';

const $=selector=>document.querySelector(selector);
let data,world,renderer,input,audio,cityLife,simulation=null,connection=null,account=null;
let state='landing',selectedRace='human',selectedFaction='relay',targetId=null,nearest=null;
let time=0,lastFrame=0,uiAccumulator=0,yaw=0,pitch=.15,thirdPerson=true,introTime=0,introShot=-1;
let toastTimer,dialogPage='',journalFilter='active',otherPlayers=[],effects=[],floaters=[],log=[],deleteArmed=null;
let community,myGuild=null,founderOffer=null;
let sessionReady=Promise.resolve();
let dungeonPanelKey='';
let cameraFov=1.04;
let mapRegion='city';
let storyCue='',currentGuide=null;
const exploration=new Map();
const worldClock=new WorldClock();
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;

function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
function setState(next){
  if(next!=='playing'){audio?.stopVoice();$('#world').classList.remove('spirit-world');}
  state=next;for(const name of ['landing','creation','cinematic','hud'])$(`#${name}`).hidden=next!==(name==='hud'?'playing':name);
  if(input){input.active=next==='playing'||next==='cinematic';input.menu=next!=='playing'||$('#panel-dialog').open;input.clear();}
}
function closePanel(){if($('#panel-dialog').open)$('#panel-dialog').close();dialogPage='';audio?.stopVoice();if(input){input.menu=state!=='playing';input.clear();}}
function panel(title,html,eyebrow='SLOPERBERPUNK / FIELD TERMINAL',page=''){
  if(dialogPage!==page)audio?.stopVoice();
  $('#dialog-title').textContent=title;$('#dialog-eyebrow').textContent=eyebrow;$('#dialog-content').innerHTML=html;dialogPage=page;
  if(!$('#panel-dialog').open)$('#panel-dialog').showModal();
  document.exitPointerLock?.();if(input){input.menu=true;input.clear();}
}
function initialUI(){
  $('#race-options').innerHTML=data.races.map(r=>`<label class="choice" style="--choice-color:${r.color}"><input type="radio" name="race" value="${r.id}" ${r.id===selectedRace?'checked':''}>${icon(r.id)}<strong>${esc(r.name)}</strong><small>${esc(r.passive.name)}</small></label>`).join('');
  $('#faction-options').innerHTML=data.factions.map(f=>`<label class="choice" style="--choice-color:${f.color}"><input type="radio" name="faction" value="${f.id}" ${f.id===selectedFaction?'checked':''}>${icon(f.id)}<strong>${esc(f.shortName||f.name)}</strong></label>`).join('');
  updateChoices();
  $('#hotbar').innerHTML=data.abilities.map(a=>`<button class="ability" data-action="ability:${a.id}" title="${esc(a.name)} — ${esc(a.description)}" aria-label="${esc(a.name)}: ${esc(a.description)}" style="color:${a.color}"><span class="key">${a.key}</span>${icon(a.icon)}<span class="cooldown-shade" style="transform:scaleY(0)"></span><span class="cooldown-number"></span><span class="locked-level"></span></button>`).join('')+`<button class="ability" data-action="medkit" title="Medkit [H]" aria-label="Use medkit"><span class="key">H</span>${icon('medkit')}<span id="medkit-count" class="locked-level"></span></button>`;
}
function updateFounderOffer(){
  const view=founderOfferView(founderOffer,account);
  $('#founder-status').textContent=view.status;$('#founder-cta').textContent=view.action;
  const note=$('[data-founder-status]');if(note)note.textContent=view.status;
}
async function refreshFounderOffer(){
  try{founderOffer=await api('/founder-offer');}catch{founderOffer=null;}
  updateFounderOffer();
}
function founderGear(c){
  if(!hasFounderHalo(c))return '';
  const status=founderBoostActive(c)?'+5% combat & quest XP active until level 10.':c.level<1?'Your +5% XP boost activates at level 1 and ends at level 10.':'Early XP boost complete. The look is yours forever.';
  return `<article class="founder-item"><img src="/assets/first-signal-halo.svg" width="480" height="260" alt="First Signal Halo"><div><span class="tag">EDITION ${String(c.founderHalo).padStart(4,'0')} / 1,000 · WORN · ACCOUNT BOUND</span><h3>First Signal Halo</h3><p>Black-chrome crown. Magenta light fins. A luminous cyan orbit.</p><p>${status} Permanent on every server character; cannot be traded.</p></div></article>`;
}
function updateChoices(){
  const race=data.races.find(r=>r.id===selectedRace),faction=data.factions.find(f=>f.id===selectedFaction);
  $('#race-description').textContent=`${race.description} ${race.passive.description}`;
  $('#faction-description').textContent=faction.description;
  $('#preview-lineage').textContent=race.name.toUpperCase();$('#preview-lineage').style.color=race.color;
}
function openCreation(){
  if(!account)return showAccount().catch(e=>toast(e.message));
  closePanel();$('#character-error').textContent='';$('#creation-storage').textContent=`Server character · account ${account.username}`;
  if(hasFounderHalo(account))$('#creation-storage').textContent+=' · First Signal Halo included.';
  setState('creation');$('#character-name').focus();
}
async function enter(){
  await sessionReady;
  if(!account)return showAccount();
  try{const chars=(await api('/characters')).characters;if(chars.length)showCharacters(chars);else openCreation();}
  catch(error){
    if(error.status!==401)throw error;
    account=null;$('#account-label').textContent='ACCOUNT';updateFounderOffer();return showAccount();
  }
}
function showCharacters(chars){
  panel('Choose your signal.',`<p class="muted">Account: ${esc(account.username)}</p>${hasFounderHalo(account)?'<p class="founder-account-note"><strong>First Signal Halo unlocked.</strong> Your numbered halo is worn automatically by every character on this account. +5% XP from level 1 until reaching level 10.</p>':''}${chars.map(c=>`<div class="character-row"><div class="grow"><strong>${esc(c.name)}</strong><small>LEVEL ${c.level} · ${esc(data.races.find(r=>r.id===c.race)?.name||c.race)} · ${esc(data.factions.find(f=>f.id===c.faction)?.name||c.faction)}</small></div><button class="small-button" data-do="play-character" data-id="${esc(c.id)}">ENTER ↗</button><button class="small-button danger" data-do="delete-character" data-id="${esc(c.id)}">${deleteArmed===c.id?'CONFIRM DELETE':'DELETE'}</button></div>`).join('')}<div class="settings-actions"><button class="button primary" data-do="new-character" ${chars.length>=8?'disabled':''}>NEW CHARACTER +</button><button class="small-button" data-do="logout">SIGN OUT</button></div>`,'IDENTITY ARCHIVE / SERVER','characters');
}
async function startGame(character,newCharacter=false){
  closePanel();connection?.close();connection=null;otherPlayers=[];targetId=null;effects=[];floaters=[];
  myGuild=null;community?.reset();worldClock.reset();cityLife.clear();
  storyCue='';currentGuide=null;
  simulation=new Prediction(data,world,structuredClone(character),onEvent);yaw=character.yaw||0;pitch=.15;
  if(!exploration.has(character.id))exploration.set(character.id,new Set());
  world.discovered=exploration.get(character.id);world.reveal(character.position);cameraFov=1.04;
  connection=new Connection(character.id,onSnapshot,onEvent,()=>{
    setState('landing');panel('Signal interrupted.','<p>Your server connection closed. Reconnect to continue from the server save.</p><button class="button primary" data-do="reconnect">RECONNECT ↗</button>','CONNECTION LOST','disconnected');
  });
  try{await connection.connect();}catch(error){connection.close();connection=null;simulation=null;setState('landing');toast(error.message);return;}
  $('#network-label').textContent='ONLINE';
  if(newCharacter||!character.introSeen){introTime=0;introShot=-1;setState('cinematic');audio.unlock().catch(()=>{});}
  else{setState('playing');toast('Welcome back. Follow your faction’s signal.');}
  updateHUD();
}
function onSnapshot(message){
  if(!simulation||!message.character)return;
  const questPanelOpen=$('#panel-dialog').open&&(dialogPage==='journal'||dialogPage.startsWith('npc:'));
  const previousQuestPanel=questPanelOpen?questPanelState():null;
  const previousCharacter=simulation.character,previous=previousCharacter.position,server=message.character;
  const recoveryChanged=isSpirit(previousCharacter)!==isSpirit(server)||(previousCharacter.health>0)!==(server.health>0);
  const teleported=distance(previous,server.position)>8;
  if(state==='playing'&&!recoveryChanged&&distance(previous,server.position)<3){
    const blended=mix3(previous,server.position,.12);
    if(!world.collides(...blended))server.position=blended;
  }
  simulation.character=server;simulation.enemies=message.enemies||[];otherPlayers=message.players||[];
  if(recoveryChanged||teleported){targetId=null;simulation.velocity=[0,0,0];simulation.dash=0;simulation.jumpBuffer=0;simulation.coyote=0;input.clear();if(recoveryChanged&&server.health<=0)closePanel();}
  simulation.worldEvents=worldEventViews(data,message.worldEvents);
  const previousRun=simulation.dungeonState?.run;simulation.dungeonState=message.dungeon||null;
  const currentRun=simulation.dungeonState?.run;
  if(previousRun?.id!==currentRun?.id||previousRun?.phase==='ready'&&currentRun?.phase!=='ready'||previousRun?.phase==='wipe'&&currentRun?.phase==='briefing'){targetId=null;simulation.velocity=[0,0,0];simulation.dash=0;simulation.grounded=true;simulation.coyote=0;simulation.jumpBuffer=0;}
  simulation.cooldowns=message.cooldowns||{};simulation.time=message.time||0;simulation.shield=message.shield||0;
  simulation.ghostlines=message.ghostlines||[];simulation.ghostCharge=message.ghostCharge||{seconds:0,meters:0,ready:false};simulation.dashReady=message.dashReady??simulation.dashReady;
  worldClock.sync(message.serverTime);myGuild=message.guild||null;
  if(questPanelOpen&&!recoveryChanged&&previousQuestPanel!==questPanelState()){
    const scroll=$('#panel-dialog').scrollTop,focus=document.activeElement?.dataset;
    const expanded=[...document.querySelectorAll('.neighborhood-entry')].map(e=>e.open);
    if(dialogPage==='journal')showJournal();else talk(data.npcs.find(n=>n.id===dialogPage.slice(4)),false);
    document.querySelectorAll('.neighborhood-entry').forEach((e,i)=>{if(expanded[i]!==undefined)e.open=expanded[i];});
    if(focus?.do)[...document.querySelectorAll('#dialog-content [data-do]')].find(e=>e.dataset.do===focus.do&&e.dataset.id===focus.id)?.focus();
    $('#panel-dialog').scrollTop=scroll;
  }
}
function questPanelState(){
  const c=simulation.character;
  return JSON.stringify([c.level,c.activeQuests,Object.entries(c.questStages||{}).map(([id,s])=>[id,s.index,s.progress]),c.completed.length,simulation.worldEvents.map(e=>[e.id,e.phase,e.repaired.length])]);
}
function finishIntro(){
  if(state!=='cinematic')return;audio.stopVoice();simulation.character.introSeen=true;
  connection?.send({type:'intro_seen'});
  setState('playing');toast('A place at the table · Follow the story marker to your contact. E / X / USE to talk.');
}
function act(action){
  if(!simulation)return;
  connection?.send(action);
}
function onEvent(event){
  if(event.type==='worldEvent'){toast(event.text);addLog(event.text);return;}
  if(event.type==='braid'){
    if(simulation)simulation.ghostlines=simulation.ghostlines.filter(g=>g.owner!==event.owner);
    effects.push({...event,kind:'braid',time,duration:.8});
    if([event.owner,event.partner].includes(simulation?.character.id)){audio?.effect('surge');toast(`${event.cooperative?'DOUBLE BRAID · +50% power':'SELF BRAID'} · Dash restored · +${data.rules.ghostline.energyReturn} energy`);addLog(event.cooperative?'Ghostline · a second runner braided your timeline.':'Ghostline · you crossed your own past.');}
    return;
  }
  if(event.type==='notice'){toast(event.text);return;}
  if(event.type==='sound'){audio?.effect(event.name);return;}
  if(event.type==='effect'){effects.push({...event,time,duration:event.kind==='beam'?.13:.8});return;}
  if(event.type==='hit'){
    floaters.push({...event,time,duration:1,text:event.damage?`${event.critical?'✧ ':''}${event.damage}`:'MISS'});
    addLog(`${event.ability} · d100 ${event.roll} · ${event.damage?event.damage+' damage':'miss'}${event.critical?' CRITICAL':''}`);
  }
  if(event.type==='hurt'){audio.effect('hurt');addLog(`Incoming · ${event.amount} damage`);}
  if(event.type==='level'){toast(`LEVEL ${event.level} · ${event.level%5===0?'A new talent point is available.':'Your signal grows stronger.'}`);audio.effect('confirm');effects.push({kind:'level',position:[...simulation.character.position],color:'#c7ed99',time,duration:1});}
  if(event.type==='questAccepted'){toast(`Contract accepted · ${event.quest.title}`);audio.speak(event.quest.briefing,event.quest.giver);}
  if(event.type==='questProgress'){
    const next=event.quest.steps?.[event.stage?.index];
    addLog(`${event.quest.title} · ${next?`${event.stage.index+1}/${event.quest.steps.length} · ${next.text} ${event.stage.progress}/${next.count}`:`${event.progress}/${event.quest.objective.count}`}`);
    if(event.progress>=event.quest.objective.count)toast('Objective complete. Return to your contact.');
    else if(next&&event.stage.progress===0)toast(`Next · ${next.text}`);
  }
  if(event.type==='questComplete'){toast(`Contract complete · +${event.xp??event.quest.reward.xp} XP / +${event.quest.reward.credits} ¤`);audio.effect('confirm');audio.speak(event.quest.completion,event.quest.giver);addLog(event.quest.title+' · complete');}
  if(event.type==='reward')addLog(`Recovered ${event.credits} ¤ · +${event.xp} XP`);
}
function addLog(text){log.push(text);log=log.slice(-5);$('#combat-log').innerHTML=log.map(t=>`<div>${esc(t)}</div>`).join('');}
function perform(action,event){
  if(action==='escape'){
    if(state==='cinematic')return finishIntro();
    if($('#panel-dialog').open)return closePanel();
    if(state==='creation')return setState('landing');
    if(state==='playing')return isSpirit(simulation.character)?showRecoveryMenu():showSettings();return;
  }
  if(state!=='playing')return;
  if(action.startsWith('ability:')){if(!$('#panel-dialog').open&&simulation.character.health>0)act({type:'ability',id:action.split(':')[1],target:targetId});return;}
  const panels={journal:showJournal,neighborhoods:()=>showJournal('neighborhoods'),talents:showTalents,inventory:showInventory,map:showMap,dungeons:showDungeons,community:()=>community.open().catch(e=>toast(e.message))};if(panels[action])return panels[action]();
  if(action==='camera'){thirdPerson=!thirdPerson;return;}
  if(action==='medkit'){act({type:'medkit'});return;}
  if(action==='target'){
    const visible=simulation.enemies.filter(e=>e.health>0&&distance(e.position,simulation.character.position)<80&&world.lineOfSight(e.position,simulation.character.position));
    if(visible.length){const i=visible.findIndex(e=>e.id===targetId);targetId=visible[(i+1)%visible.length].id;}else targetId=null;return;
  }
  if(action==='pick'){
    let best=45;for(const e of simulation.enemies){const p=renderer.project([e.position[0],e.position[1]+1.5,e.position[2]]);if(p&&e.health>0){const d=Math.hypot(p[0]-event.clientX,p[1]-event.clientY);if(d<best){best=d;targetId=e.id;}}}return;
  }
  if(action==='interact'&&!$('#panel-dialog').open&&(simulation.character.health>0||isSpirit(simulation.character))&&(nearest=findNearest())){
    if(nearest.kind==='corpse')return act({type:'reclaimCorpse'});
    if(nearest.kind==='healer')return showSpiritHealer();
    if(['evidence','recover','revive'].includes(nearest.kind)){const run=simulation.dungeon?.run;return act({type:'dungeon',operation:nearest.kind==='evidence'?'interact':nearest.kind,run:run.id,chapter:run.chapter,attempt:run.attempt,target:nearest.object.id});}
    if(nearest.kind==='incident')return act({type:'worldEvent',id:nearest.object.event,cycle:nearest.object.cycle,site:nearest.object.id});
    if(nearest.kind==='npc')return talk(nearest.object);
    if(nearest.kind==='resident')return talkResident(nearest.object);
    act({type:nearest.kind==='lift'?'lift':'interact',id:nearest.object.id});
    if(nearest.object.evidence)panel(nearest.object.name,`<div class="npc-quote">${esc(nearest.object.evidence)}</div><p class="panel-description">Return to the neighborhood contact after completing your objective. J → Neighborhoods keeps the case and its progress.</p>`,'NEIGHBORHOOD / FIELD RECORD','street-record');
  }
}

function showDungeons(){
  if(!simulation)return;
  panel('Expedition casebook',dungeonPanel(data,simulation.character,simulation.dungeon,simulation.time),'DUNGEONS / GROUP FINDER','dungeons');
  dungeonPanelKey=dungeonKey();
}
function dungeonKey(){
  const state=simulation?.dungeon,run=state?.run;
  return JSON.stringify(run?{...run,members:run.members.map(m=>({id:m.id,name:m.name,down:m.health<=0})),recoveryReady:0,nextPulse:0,pulse:0}:state);
}

function showWorld(){
  panel('The city lives on what it loses.',`<p class="dialog-intro">${esc(data.lore.setting.premise)}</p><div class="card-grid">${data.world.districts.map((d,i)=>`<article class="info-card"><span class="tag">SECTOR 0${i+1} / LEVEL ${d.minLevel}+</span><h3 style="color:${d.color}">${esc(d.name)}</h3><p>${esc(d.subtitle)}</p></article>`).join('')}</div><h3>Beyond the extraction line</h3><div class="card-grid">${data.world.biomes.map(b=>`<article class="info-card"><span class="tag">${esc(b.kind.toUpperCase())} / LEVEL ${b.minLevel}+</span><h3 style="color:${b.color}">${esc(b.name)}</h3><p class="quote">${esc(b.subtitle)}</p><p>${esc(b.description)}</p><small>Contact: ${esc(data.npcs.find(n=>n.biome===b.id).name)} · 3 contracts from level ${data.quests.find(q=>q.biome===b.id).level}</small></article>`).join('')}</div><p class="panel-description">Walk Vesper’s streets and elevated crossings, then follow the roads into a 6.4 km basin. Every faction and lineage can take the twelve basin contracts. Find their contacts on the map and their stories in the journal’s Basin tab.</p><div class="settings-actions"><button class="button primary" data-do="enter">FIND YOUR SIGNAL ↗</button><button class="small-button" data-do="lineages">LINEAGES & ORIGINS ↗</button></div>`,'WELCOME TO THE AFTERLIGHT','world');
}
function showFactions(){
  panel('Four incomplete answers.',`<p class="dialog-intro">Each faction can end a cruelty. Each depends on something its victory will continue to consume.</p><div class="card-grid">${data.factions.map(f=>`<article class="info-card"><span style="color:${f.color}">${icon(f.id)}</span><h3>${esc(f.name)}</h3><p class="quote">“${esc(f.motto)}”</p><p>${esc(f.description)}</p><p class="tag">31 CONTRACTS · LEVEL 0–60</p></article>`).join('')}</div><p class="panel-description">Your faction campaign runs beside your lineage story. Every character can build across the Anchor, Sustainer, Disruptor, and Runner talent branches.</p>`,'ALLEGIANCES / 04','factions');
}
function showLineages(){
  panel('An origin is not an order.',`<p class="dialog-intro">Four ways of being human. Every lineage carries a history, a living argument, and a future it gets to choose.</p><div class="card-grid">${data.races.map(r=>`<article class="info-card"><span style="color:${r.color}">${icon(r.id)}</span><h3>${esc(r.name)}</h3><p class="quote">${esc(r.tagline)}</p><p>${esc(r.lore)}</p><p class="tag">${esc(r.passive.name.toUpperCase())} / ${esc(r.passive.description)}</p><p class="tag">13 CHAPTERS · LEVEL 0–60</p></article>`).join('')}</div>`,'LINEAGES / LIVING HISTORY','lineages');
}
function showGuide(){
  const controls=[['Move','W A S D'],['Look','HOLD RMB / DRAG'],['Capture mouse','DOUBLE CLICK'],['Jump / sprint','SPACE / SHIFT'],['Dash','Q'],['Talk / use / lift','E'],['Cycle targets','TAB'],['Abilities','1–6'],['Ghostline','R'],['Medkit','H'],['Journal / talents','J / T'],['Gear / map','I / M'],['Dungeons / group finder','G'],['Camera / menu','V / ESC']];
  panel('A runner’s field guide.',`<div class="guide-grid">${controls.map(([a,b])=>`<div class="guide-row"><span>${a}</span><kbd>${b}</kbd></div>`).join('')}</div><p class="guide-note">CONTROLLER · Left stick moves, right stick looks. A jumps, B dashes, X interacts, Y cycles targets. RT fires; LB surges; RB heals; LT shields. D-pad up uses a medkit, down opens the map, left/right use unlocked abilities. Right-stick press (R3) casts Ghostline. View opens the journal. Menu opens settings. In menus, use the D-pad and A.</p><p class="guide-note">TOUCH · Use the left movement pad and drag the world to look. Tap the action bar to cast. TARGET chooses a nearby enemy; USE talks to contacts, activates terminals, or rides a lift.</p><article class="info-card ghostline-guide"><span class="tag">GHOSTLINE / LEVEL 0 / R · R3 · TOUCH HOTBAR</span><h3>Your past is someone else’s opening.</h3><p>Move at least 12 m over 2 seconds, then cast Ghostline. A cyan runner replays up to 6 seconds of your route. After its 0.6-second arming delay, cross it to braid: a 10 m shockwave hits visible enemies, restores your dash, and returns 20 energy. Another player crossing it adds 50% power and restores both runners. Costs 30 energy; 18-second cooldown. No target needed.</p><p>Try it: sprint past an enemy, press R, turn, and dash back through your afterimage. With a friend, lay your route through their fight and let them make contact. Follow the dotted cyan trail and the moving runner, also shown on the minimap.</p></article><div class="card-grid"><article class="info-card"><h3>Build a role, not a cage.</h3><p>Everyone carries an arc carbine, a disruption pulse, a healing protocol, and a kinetic shield. Earn a talent point every five levels. Specialize in holding ground, restoring allies, breaking enemy rhythm, or moving between them.</p></article><article class="info-card"><h3>Death has a cost.</h3><p>Outside expeditions, death costs 5% of your credits (up to 50). Release your spirit at the nearest graveyard, then follow your body marker. Recover within 12 m with a clear view to return at 50% health and energy. A Remembrance keeper can revive you at the graveyard at 25%, charging another 10% of your credits (up to 100) and giving 60 seconds of resurrection sickness: half damage and 25% slower movement. Spirits can use lifts; ESC / Menu opens recovery options.</p><h3>Every shot is a roll.</h3><p>Position and range matter. A d100 resolves misses and critical hits. Stronger enemies are harder to hit. Watch your energy, interrupt incoming attacks, and save a dash for the way out.</p></article></div><p class="guide-note">Character voices have individual pitch and pacing and use installed local English voices. VOICES toggles speech; dialogue and story captions remain available. Standard USB controllers require browser support and a secure origin. GPL-3.0-or-later. Source and original assets are yours to modify under the license.</p>`,'CONTROLS / SYSTEMS','guide');
}
function questObjective(q){return objectiveText(questView(q,simulation.character).step,data);}
function questCard(q,c,atNpc=false){
  const view=questView(q,c),{accepted,ready}=view,done=c.completed.includes(q.id),available=availableQuest(q,c);
  const steps=view.staged?`<ol class="quest-steps">${q.steps.map((s,i)=>`<li class="${done||ready||accepted&&i<view.index?'complete':accepted&&i===view.index?'current':''}">${esc(s.text)}${s.type==='hold'?` · ${s.count}s`:''}${accepted&&!ready&&i===view.index?` <strong>${view.progress}/${s.count}${s.type==='hold'?'s':''}</strong>`:''}</li>`).join('')}</ol>`:'';
  const rewardXp=done?q.reward.xp:founderXpReward(c,q.reward.xp,data.rules).xp,biome=data.world.biomes.find(b=>b.id===q.biome);
  return `<article class="quest-row ${!accepted&&!available&&!done?'locked':''}"><span class="quest-level">LV ${q.level}${done?' / COMPLETE':''}</span><h3>${esc(q.title)}</h3>${biome?`<small class="muted">${esc(biome.name)} · ${esc(data.npcs.find(n=>n.id===q.giver).name)}</small>`:""}<p>${esc(done?q.completion:q.briefing)}</p>${q.story?`<small class="story-chapter">${esc(q.story.chapter)}</small>`:''}${steps||`<div class="quest-objective">${esc(questObjective(q))}${accepted?` · ${view.progress}/${view.step.count}`:''}</div>`}<div class="quest-meta"><span>+${rewardXp} XP${rewardXp>q.reward.xp?' · HALO BONUS INCLUDED':''}</span><span>+${q.reward.credits} ¤</span></div>${q.story?`<button class="small-button" data-do="quest-voice" data-id="${q.id}">REPLAY ${done?'ENDING':'BRIEFING'} ♫</button>`:''}${atNpc&&available?`<button class="small-button" data-do="quest-accept" data-id="${q.id}">ACCEPT CONTRACT ↗</button>`:atNpc&&ready?`<button class="button primary" data-do="quest-complete" data-id="${q.id}">COMPLETE CONTRACT ↗</button>`:accepted?`<small class="muted">${ready?'Return to '+esc(data.npcs.find(n=>n.id===q.giver)?.name):'Contract in progress'}</small>`:!done?`<small class="muted">${available?'Available from '+esc(data.npcs.find(n=>n.id===q.giver)?.name):'Requires level '+q.level+' and the preceding chapter.'}</small>`:''}</article>`;
}
function showJournal(filter=journalFilter){
  if(!simulation)return;journalFilter=filter;const c=simulation.character;
  const applicable=data.quests.filter(q=>(!q.faction||q.faction===c.faction)&&(!q.race||q.race===c.race));
  let list=filter==='active'?applicable.filter(q=>c.activeQuests[q.id]!==undefined):filter==='available'?applicable.filter(q=>availableQuest(q,c)):filter==='history'?applicable.filter(q=>c.completed.includes(q.id)):filter==='basin'?applicable.filter(q=>q.biome):applicable.filter(q=>!q.biome&&!q.neighborhood);
  panel('Your unfinished business.',`<div class="tabs">${[['active','ACTIVE'],['available','AVAILABLE'],['campaign','CAMPAIGNS'],['neighborhoods','NEIGHBORHOODS'],['basin','BASIN'],['history','COMPLETED']].map(([id,name])=>`<button class="${id===filter?'selected':''}" data-do="journal-filter" data-id="${id}">${name}</button>`).join('')}</div>${filter==='neighborhoods'?neighborhoodJournal():list.length?list.map(q=>questCard(q,c)).join(''):'<p class="muted">No contracts here yet. Meet your faction contact and Oru in Afterlight Commons, or visit a neighborhood steward.</p>'}<p class="panel-description">Faction and lineage chapters run from level 0 through 60. Neighborhood and basin stories are open to every faction and lineage at their listed levels. Accept and turn in each contract with its named contact; map markers show the destination.</p>`,'QUEST JOURNAL / '+c.completed.length+' COMPLETE','journal');
}
function neighborhoodJournal(){
  const c=simulation.character;
  return `<p class="panel-description">Five blocks, five unfinished stories. Talk to residents with E, inspect local records, and help the stewards. Your completed contracts change the activity and conversation you encounter on return.</p>${data.citylife.neighborhoods.map(n=>{
    const stage=cityStage(n,c.completed),contact=data.npcs.find(p=>p.id===n.contact),quests=data.quests.filter(q=>q.neighborhood===n.id),next=quests.find(q=>!c.completed.includes(q.id))||quests.at(-1),incident=simulation.worldEvents.find(e=>e.neighborhood===n.id&&e.phase!=='idle'),event=incident?{name:incident.name,detail:incidentStatus(incident,data.events.rules,simulation.time)}:cityEvent(n,worldClock.now());
    return `<details class="neighborhood-entry" style="--neighborhood-color:${n.color}" ${world.district(c.position).id===n.id?'open':''}><summary tabindex="0">${esc(n.name)} <small>${n.stages.indexOf(stage)}/3 · ${esc(stage.status)}</small></summary><p>${esc(n.premise)}</p><p class="neighborhood-now">ON THE STREET · ${esc(event.name)}<br><span ${incident?`data-incident-status="${incident.id}"`:""}>${esc(event.detail)}</span></p><p class="muted">${esc(contact.name)} · ${Math.round(distance(c.position,contact.position))} m · ${contact.position[1]?'24 m skyway · take the Transit lift':'Street level'}</p>${questCard(next,c)}<button class="small-button" data-do="map-region" data-id="city">LOCATE ON CITY MAP ↗</button></details>`;
  }).join('')}`;
}
function npcDialogue(npc){
  const n=cityLife.neighborhoods.get(npc.neighborhood);
  const stage=n&&cityStage(n,simulation.character.completed);
  return stage?.quest?stage.contactLine:npc.dialogue;
}
function talk(npc,narrate=true){
  if(npc.id==='merchant')return showShop();const c=simulation.character;
  const quests=data.quests.filter(q=>q.giver===npc.id&&((c.activeQuests[q.id]!==undefined)||availableQuest(q,c)));
  const dialogue=npcDialogue(npc);
  panel(npc.name,`<div class="npc-quote">“${esc(dialogue)}”</div>${quests.length?quests.map(q=>questCard(q,c,true)).join(''):npc.neighborhood?'<p class="muted">The neighborhood journal records your work here. Take a walk through the block and talk to the people keeping it going.</p>':'<p class="muted">I have no new work for your signal right now. Check your journal for the next level gate.</p>'}<button class="small-button" data-do="speak" data-id="${npc.id}">REPLAY ${esc(npc.name.toUpperCase())} ♫</button>`,npc.title.toUpperCase(),'npc:'+npc.id);
  if(narrate)audio.speak(dialogue,npc.id);
}
function talkResident(actor){
  const conversation=cityLife.conversation(actor,worldClock.now()),n=conversation.neighborhood;
  if(actor.activity==='flee'){toast(`${actor.name}: ${actor.line}`);return;}
  const contact=n&&data.npcs.find(p=>p.id===n.contact);
  panel(actor.name,`<p class="neighborhood-now">${esc(conversation.role)} · ${esc(actor.title)}</p><div class="npc-quote">“${esc(conversation.personal)}”</div>${n?`<h3>Life in ${esc(n.name)}</h3><p>“${esc(conversation.stage.line)}”</p><p class="muted">${esc(conversation.event.name)} · ${esc(conversation.event.detail)}</p><p>Talk to ${esc(contact.name)} about the work here. ${Math.round(distance(simulation.character.position,contact.position))} m${contact.position[1]?' · on the 24 m skyway':''}.</p><button class="small-button" data-do="journal-filter" data-id="neighborhoods">NEIGHBORHOOD JOURNAL ↗</button>`:''}`,n?.name.toUpperCase()||'VESPER / NEIGHBORS','resident:'+actor.id);
  audio.speak(conversation.personal);
}
function showTalents(){
  const c=simulation.character,spent=Object.values(c.talents).reduce((a,b)=>a+b,0),points=Math.floor(c.level/5)-spent;
  panel('Rewrite your limits.',`<p class="dialog-intro">${points} available point${points===1?'':'s'} · One point every five levels. Mix branches to build your own role.</p><div class="card-grid">${data.talents.map(t=>`<article class="talent-card"><small>${t.branch.toUpperCase()} / LEVEL ${t.level}+</small><h3>${esc(t.name)}</h3><p>${esc(t.description)}</p><button class="small-button" data-do="learn-talent" data-id="${t.id}" ${points<=0||c.level<t.level||(c.talents[t.id]||0)>=t.maxRank?'disabled':''}>${c.talents[t.id]||0} / ${t.maxRank} ${points>0?' · INVEST +':''}</button></article>`).join('')}</div>`,'AUGMENTATION / TALENTS','talents');
}
function showInventory(){
  const c=simulation.character,s=simulation.playerStats;
  panel('What you carry.',`<div class="inventory-summary"><div><strong>${c.credits}</strong><small>CREDITS ¤</small></div><div><strong>${c.medkits}</strong><small>MEDKITS / ${data.rules.inventory.slots}</small></div><div><strong>R${c.weaponRank+1}</strong><small>ARC CARBINE</small></div></div>${founderGear(c)}<div class="info-card" style="margin-top:20px"><span class="tag">PERSONAL AUGMENTATION</span><h3>${esc(data.races.find(r=>r.id===c.race).passive.name)}</h3><p>${esc(data.races.find(r=>r.id===c.race).passive.description)}</p></div><div class="guide-grid" style="margin-top:20px">${[['Health',s.health],['Energy',s.energy],['Critical chance',s.crit+'%'],['Ability damage',Math.round(s.damage*100)+'%'],['Weapon bonus','+'+(c.weaponRank*data.rules.inventory.weaponUpgradeDamage)],['Movement',Math.round(s.speed*100)+'%']].map(([k,v])=>`<div class="guide-row"><span>${k}</span><strong>${v}</strong></div>`).join('')}</div><p class="panel-description">Patch sells medkits and coil upgrades in Afterlight Commons. Medkits restore ${data.rules.inventory.medkitHeal} health and share an ${data.rules.inventory.medkitCooldown}-second cooldown.</p><button class="small-button" data-do="use-medkit">USE MEDKIT [H]</button>`,'EQUIPMENT / INVENTORY','inventory');
}
function showShop(){
  const c=simulation.character;
  panel('Patch’s street supply.',`<p class="npc-quote">“${esc(data.npcs.find(n=>n.id==='merchant').dialogue)}”</p><p class="quest-meta">YOUR BALANCE · ${c.credits} ¤</p><div class="card-grid"><article class="info-card"><span style="color:var(--green)">${icon('medkit')}</span><h3>Field medkit</h3><p>Restore ${data.rules.inventory.medkitHeal} health. Carry up to ${data.rules.inventory.slots}.</p><button class="small-button" data-do="buy" data-id="medkit">BUY / ${data.rules.inventory.medkitPrice} ¤</button></article><article class="info-card"><span style="color:var(--cyan)">${icon('bolt')}</span><h3>Coil upgrade</h3><p>Permanent +${data.rules.inventory.weaponUpgradeDamage} damage. Current rank ${c.weaponRank}. Maximum ${data.rules.inventory.maxWeaponRank}.</p><button class="small-button" data-do="buy" data-id="upgrade">UPGRADE / ${data.rules.inventory.weaponUpgradePrice*(c.weaponRank+1)} ¤</button></article></div>`,'QUARTERMASTER / AFTERLIGHT COMMONS','shop');
}
function showMap(region=mapRegion){
  mapRegion=region;
  panel('Vesper / field map.',`<div class="tabs">${[['city','CITY / NEIGHBORHOODS'],['basin','PALE BASIN']].map(([id,name])=>`<button class="${mapRegion===id?'selected':''}" data-do="map-region" data-id="${id}">${name}</button>`).join('')}</div><canvas id="full-map" class="map-view" width="900" height="720" aria-label="Map of Vesper with neighborhood stewards, objectives, and lifts"></canvas><div class="map-legend"><span><i></i> YOU</span><span><i style="background:#e8c983"></i> OBJECTIVES</span><span><i style="background:#7dbfc0"></i> LIFTS</span><span><i style="background:#efb778"></i> NEIGHBORHOOD STEWARDS</span></div><p class="panel-description">Neighborhood stewards are marked even on streets you have not visited. Use J → Neighborhoods to read their stories. Last Connection is on the 24 m skyway, reached by the Transit lift. Green doorway marks on the minimap identify walk-in shops and clinics. Select Pale Basin for the four nature biomes and their contacts.</p>`,'WORLD MAP / '+(mapRegion==='city'?'VESPER':'PALE BASIN'),'map');
  drawMap($('#full-map'),true);
}
function showSettings(){
  panel('Keep your signal clear.',`<div class="setting-row"><label for="setting-music">Sound & music<small>Original locally synthesized ambient score and effects.</small></label><input id="setting-music" type="checkbox" ${audio.enabled?'checked':''}></div><div class="setting-row"><label for="setting-voice">Character voices<small>${audio.voices.length?'Distinct character pitch and pacing using installed English voices. Captions remain available when muted.':'No local English voice detected. Captions are available; install an offline English voice to hear characters.'}</small></label><input id="setting-voice" type="checkbox" ${audio.narration?'checked':''}></div><div class="setting-row"><label for="setting-quality">Render resolution<small>Lower this on mobile hardware to improve frame pacing.</small></label><select id="setting-quality"><option value="1" ${renderer.quality===1?'selected':''}>High</option><option value="0.75" ${renderer.quality===.75?'selected':''}>Balanced</option><option value="0.5" ${renderer.quality===.5?'selected':''}>Low</option></select></div><div class="setting-row"><label for="setting-volume">Volumetric light<small>Atmospheric sunlight and Commons lamp shafts. Low resolution skips lamp shafts.</small></label><input id="setting-volume" type="checkbox" ${renderer.volumetric?'checked':''}></div><div class="setting-row"><label for="setting-sensitivity">Look sensitivity</label><input type="range" id="setting-sensitivity" min="0.001" max="0.006" step="0.0005" value="${input.sensitivity}"></div><div class="setting-row"><label for="setting-camera">Third person camera<small>Toggle at any time with V.</small></label><input id="setting-camera" type="checkbox" ${thirdPerson?'checked':''}></div><div class="settings-actions"><button class="small-button" data-do="guide">CONTROLS</button><button class="small-button" data-do="intro">REPLAY INTRO</button><button class="small-button" data-do="export">EXPORT SIGNED CHARACTER</button><button class="small-button" data-do="community">COMMUNITY</button><button class="small-button" data-do="dungeons">DUNGEONS / GROUP FINDER</button><button class="small-button" data-do="leave">RETURN TO TITLE</button></div><p class="panel-description">Server character · ${input.connected?'Standard controller connected.':'Keyboard, mouse, touch, and standard controllers supported.'} Sloperberpunk is GPL-3.0-or-later. There is no warranty. <a href="/LICENSE" target="_blank" rel="noopener">Read the license ↗</a></p>`,'OPTIONS / SIGNAL PREFERENCES','settings');
}
async function showAccount(mode='login'){
  await sessionReady;
  if(account)return enter();
  refreshFounderOffer();
  panel(mode==='register'?'Start a new signal.':'Welcome back, runner.',`<div class="tabs"><button class="${mode==='login'?'selected':''}" data-do="account-login">SIGN IN</button><button class="${mode==='register'?'selected':''}" data-do="account-register">CREATE ACCOUNT</button></div>${mode==='register'?`<p class="founder-account-note"><strong>First Signal Halo · first 1,000 accounts.</strong><br>Exclusive permanent cosmetic. +5% combat &amp; quest XP from level 1 until level 10.<br><span data-founder-status>${esc(founderOfferView(founderOffer,account).status)}</span></p>`:''}<form id="account-form" data-mode="${mode}"><div class="form-row"><label for="username">USERNAME</label><input id="username" name="username" autocomplete="username" minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+" required placeholder="Your callsign"></div><div class="form-row"><label for="password">PASSWORD / 12–128 CHARACTERS</label><input id="password" name="password" type="password" autocomplete="${mode==='register'?'new-password':'current-password'}" minlength="12" maxlength="128" required></div><div id="account-error" class="form-error" role="alert"></div><button type="submit" class="button primary">${mode==='register'?'CREATE ACCOUNT':'ESTABLISH LINK'} ↗</button></form><p class="form-note">Your characters and progress are saved on the server. Sign in to play from any device.</p>`,'ACCOUNT / SECURE IDENTITY', 'account');
}

function refreshPanel(){
  if(dialogPage.startsWith('npc:'))talk(data.npcs.find(n=>n.id===dialogPage.split(':')[1]));
  else if(dialogPage==='talents')showTalents();else if(dialogPage==='shop')showShop();else if(dialogPage==='inventory')showInventory();
}
function wireEvents(){
  $('#enter-button').onclick=()=>enter().catch(e=>toast(e.message));
  $('#account-button').onclick=()=>showAccount().catch(e=>toast(e.message));
  $('#founder-cta').onclick=()=>showAccount('register').catch(e=>toast(e.message));
  $('#creation-back').onclick=()=>setState('landing');$('#skip-intro').onclick=finishIntro;
  $('#close-dialog').onclick=closePanel;$('#panel-dialog').addEventListener('cancel',e=>{e.preventDefault();closePanel();});
  $('#music-button').onclick=async()=>{await audio.toggle();updateMusicButton();};
  document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>({world:showWorld,factions:showFactions,guide:showGuide}[b.dataset.page])());
  document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>perform(b.dataset.action));
  $('#respawn').onclick=()=>act({type:'releaseSpirit'});
  $('#reclaim-corpse').onclick=()=>act({type:'reclaimCorpse'});
  $('#return-graveyard').onclick=()=>act({type:'returnToGraveyard'});
  $('#spirit-healer').onclick=showSpiritHealer;
  $('#repeat-guidance').onclick=()=>{if(currentGuide)audio.speak(currentGuide.line,currentGuide.speaker);};
  $('#voice-toggle').onclick=()=>{audio.narration=!audio.narration;if(!audio.narration)audio.stopVoice();else if(currentGuide)audio.speak(currentGuide.line,currentGuide.speaker);updateVoiceButton();};
  $('#interaction').onclick=()=>perform('interact');
  $('#character-form').addEventListener('change',()=>{selectedRace=$('input[name="race"]:checked').value;selectedFaction=$('input[name="faction"]:checked').value;updateChoices();});
  $('#character-form').addEventListener('submit',async e=>{
    e.preventDefault();audio.unlock().catch(()=>{});const button=e.submitter;button.disabled=true;
    try{const name=$('#character-name').value.trim();const c=(await api('/characters',{name,race:selectedRace,faction:selectedFaction})).character;await startGame(c,true);}
    catch(error){$('#character-error').textContent=error.message;}finally{button.disabled=false;}
  });
  $('#dialog-content').addEventListener('click',async e=>{
    const button=e.target.closest('[data-do]');if(!button)return;const action=button.dataset.do,id=button.dataset.id;
    try{
      if(action==='enter'){closePanel();await enter();}
      else if(action==='new-character')openCreation();
      else if(action==='account-login')await showAccount('login');else if(action==='account-register')await showAccount('register');
      else if(action==='play-character'){const chars=(await api('/characters')).characters;const c=chars.find(c=>c.id===id);if(c)await startGame(c);}
      else if(action==='delete-character'){
        if(deleteArmed!==id){deleteArmed=id;button.textContent='CONFIRM DELETE';return;}
        await api('/characters/'+encodeURIComponent(id),{},'DELETE');
        deleteArmed=null;showCharacters((await api('/characters')).characters);
      }
      else if(action==='logout'){await api('/logout',{});account=null;$('#account-label').textContent='ACCOUNT';updateFounderOffer();refreshFounderOffer();closePanel();}
      else if(action==='reconnect'){if(simulation)await startGame(simulation.character);}
      else if(action==='journal-filter')showJournal(id);
      else if(action==='map-region')showMap(id==='basin'?'basin':'city');
      else if(action==='quest-accept'||action==='quest-complete'){act({type:'quest',id,operation:action==='quest-accept'?'accept':'complete'});}
      else if(action==='learn-talent'){act({type:'talent',id});setTimeout(refreshPanel,250);}
      else if(action==='buy'){act({type:'buy',item:id});setTimeout(refreshPanel,250);}
      else if(action==='use-medkit'){act({type:'medkit'});setTimeout(showInventory,250);}
      else if(action==='speak'){audio.narration=true;updateVoiceButton();if(!audio.speak(npcDialogue(data.npcs.find(n=>n.id===id)),id))toast('No local English speech voice is available. Dialogue remains on screen.');}
      else if(action==='quest-voice'){const q=data.quests.find(q=>q.id===id);if(q)audio.speak(simulation.character.completed.includes(id)?q.completion:q.briefing,q.giver);}
      else if(action==='healer-confirm'){act({type:'spiritHealer'});closePanel();}
      else if(action==='return-graveyard'){act({type:'returnToGraveyard'});closePanel();}
      else if(action==='reclaim-corpse'){act({type:'reclaimCorpse'});closePanel();}
      else if(action==='spirit-healer')showSpiritHealer();
      else if(action==='settings')showSettings();
      else if(action==='close-panel')closePanel();
      else if(action==='guide')showGuide();
      else if(action==='lineages')showLineages();
      else if(action==='intro'){closePanel();introTime=0;introShot=-1;setState('cinematic');}
      else if(action==='export'){
        button.disabled=true;
        try{const id=simulation.character.id;const envelope=await api(`/characters/${encodeURIComponent(id)}/export`);downloadCharacter(envelope,id);}
        finally{button.disabled=false;}
      }
      else if(action==='community')await community.open();
      else if(action==='dungeons')showDungeons();
      else if(action==='dungeon'){
        act({type:'dungeon',operation:button.dataset.operation,dungeon:button.dataset.dungeon,run:Number(button.dataset.run),chapter:Number(button.dataset.chapter),attempt:Number(button.dataset.attempt),target:button.dataset.target,choice:button.dataset.choice});
        if(button.dataset.operation==='begin')closePanel();
      }
      else if(action==='leave'){connection?.close();connection=null;simulation=null;closePanel();setState('landing');}
    }catch(error){toast(error.message);}
  });
  $('#dialog-content').addEventListener('submit',async e=>{
    if(e.target.id!=='account-form')return;e.preventDefault();const form=e.target,button=e.submitter,fields=new FormData(form);button.disabled=true;
    try{const result=await api('/'+form.dataset.mode,{username:fields.get('username'),password:fields.get('password')});account={username:result.username,founderHalo:result.founderHalo};$('#account-label').textContent=account.username;updateFounderOffer();refreshFounderOffer();showCharacters((await api('/characters')).characters);if(form.dataset.mode==='register'&&hasFounderHalo(account))toast('First Signal Halo unlocked · your permanent early-signup reward.');}
    catch(error){const field=$('#account-error');if(field)field.textContent=error.message;else toast(error.message);}finally{button.disabled=false;}
  });
  $('#dialog-content').addEventListener('change',async e=>{
    const t=e.target;
    if(t.id==='setting-music'){if(t.checked!==audio.enabled)await audio.toggle();updateMusicButton();}
    if(t.id==='setting-voice'){audio.narration=t.checked;updateVoiceButton();if(t.checked&&!audio.voices.length)toast('No local English voice is available. NPC dialogue stays on screen.');if(!t.checked)audio.stopVoice();}
    if(t.id==='setting-quality')renderer.quality=Number(t.value);
    if(t.id==='setting-volume')renderer.volumetric=t.checked;
    if(t.id==='setting-sensitivity')input.sensitivity=Number(t.value);
    if(t.id==='setting-camera')thirdPerson=t.checked;
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden){audio.stopVoice();if(connection)connection.send({type:'move',forward:0,strafe:0,yaw,jump:false,dash:false,sprint:false,sequence:++connection.sequence});}});
  window.addEventListener('graphicslost',()=>{input.clear();toast('Graphics context lost. The renderer will reload when your device restores it.');});
}
function updateMusicButton(){$('#music-button').innerHTML=`<span>♫</span> SOUND ${audio.enabled?'ON':'OFF'}`;$('#music-button').setAttribute('aria-pressed',String(audio.enabled));}

function findNearest(){
  if(!simulation)return null;const p=simulation.character.position;let best=null,range=data.rules.interactionRadius;
  const recovery=recoveryView(simulation.character,data,world,worldClock.now());
  if(recovery?.spirit){
    if(recovery.canReclaim)return{kind:'corpse',object:{name:'Recover your body',position:simulation.character.death.corpse}};
    if(recovery.atHealer)return{kind:'healer',object:{name:'Speak to the Remembrance keeper',position:recovery.graveyard.position}};
    for(const object of data.world.lifts){const d=Math.min(...object.stops.map(y=>distance(p,[object.position[0],y,object.position[2]])));if(d<range&&world.lineOfSight(p,[object.position[0],p[1],object.position[2]])){range=d;best={kind:'lift',object};}}
    return best;
  }
  if(simulation.inDungeon){
    const run=simulation.dungeon.run;if(run.phase!=='active')return null;
    const d=data.dungeons.entries.find(d=>d.id===run.dungeon),r=data.dungeons.rules;range=4;
    const objects=[...d.chapters[run.chapter].evidence.map(e=>({kind:'evidence',object:{...e,position:dungeonPosition(r,e.position)}})),{kind:'recover',object:{id:'aid',name:simulation.time>=run.recoveryReady?'Use recovery station':`Recovery station · ${Math.ceil(run.recoveryReady-simulation.time)}s`,position:r.recoveryPosition}},...otherPlayers.filter(p=>p.health<=0&&run.members.some(m=>m.id===p.id)).map(p=>({kind:'revive',object:{...p,name:`Revive ${p.name} · ${run.revivesLeft} left`}}))];
    for(const item of objects){const d=distance(p,item.object.position);if(d<range){range=d;best=item;}}
    return best;
  }
  for(const [kind,objects]of[['npc',data.npcs],['terminal',data.world.landmarks],['lift',data.world.lifts]])for(const object of objects){
    let d=distance(p,object.position);
    if(kind==='lift')d=Math.min(...object.stops.map(y=>distance(p,[object.position[0],y,object.position[2]])));
    if(d<range&&world.lineOfSight(p,kind==='lift'?[object.position[0],p[1],object.position[2]]:object.position)){range=d;best={kind,object};}
  }
  for(const item of incidentTargets(simulation.worldEvents)){
    const d=distance(p,item.object.position);
    if(d<data.rules.interactionRadius&&d<=range&&world.lineOfSight(p,item.object.position)){range=d;best=item;}
  }
  // A guided record must remain readable even when a live incident shares its control.
  const guide=openingGuide(simulation.character,data,simulation.worldEvents),destination=guide?.destination;
  if(destination&&(guide.phase==='offer'||guide.phase==='return'||guide.view.step.type==='interact')&&distance(p,destination.position)<data.rules.interactionRadius&&world.lineOfSight(p,destination.position))return{kind:data.npcs.some(n=>n.id===destination.id)?'npc':'terminal',object:destination};
  // Favor fixed services in a tie, while allowing conversation beside a busy stall.
  let residentRange=best?range-1.5:range;
  for(const object of cityLife.actors){const d=distance(p,object.position);if(d<residentRange&&world.lineOfSight(p,object.position)){residentRange=d;best={kind:'resident',object};}}
  return best;
}
function updateVoiceButton(){
  $('#voice-toggle').textContent=`VOICES ${audio.narration?'ON':'OFF'}`;
  $('#voice-toggle').setAttribute('aria-pressed',String(audio.narration));
}
function updateStoryGuide(){
  const c=simulation.character;
  currentGuide=c.health>0&&!simulation.inDungeon?openingGuide(c,data,simulation.worldEvents):null;
  $('#story-guide').hidden=!currentGuide;
  $('#tracked-quests').hidden=Boolean(currentGuide);
  if(!currentGuide)return;
  const g=currentGuide,d=g.destination;
  $('#story-chapter').textContent=(g.quest.story?.chapter||'Your first night in Vesper')+(g.view.accepted&&!g.view.ready?` · ${g.view.index+1}/${g.view.total}`:'');
  const instruction=g.instruction+(g.view.step.type==='hold'&&g.view.accepted&&!g.view.ready?` (${g.view.progress}/${g.view.step.count}s)`:'');
  if($('#story-instruction').textContent!==instruction)$('#story-instruction').textContent=instruction;
  $('#story-direction').textContent=d?`${bearing(c.position,d.position,yaw)} ${Math.ceil(distance(c.position,d.position))} m · ${d.name}${Math.abs(d.position[1]-c.position[1])>5?' · use a lift to change level':''}`:'';
  $('#story-hint').textContent=g.hint;
  if(g.key!==storyCue&&!$('#panel-dialog').open&&!audio.utterance){storyCue=g.key;audio.speak(g.line,g.speaker);}
}
function showSpiritHealer(){
  const view=recoveryView(simulation.character,data,world,worldClock.now());
  if(!view?.atHealer)return;
  const r=data.rules.death;
  panel('A costly return.',`<div class="npc-quote">“Your body still remembers you. Walk back to it, and you keep more of yourself. I can bring you back here, but the city takes its share.”</div><p>Resurrect here for <strong>${view.healerCost} ¤</strong> (${r.healerLossFraction*100}% of your remaining credits, capped at ${r.healerLossCap} ¤). Return with ${r.healerHealthFraction*100}% health and energy.</p><p><strong>Resurrection sickness · ${r.sicknessSeconds} seconds of living play.</strong> Damage is reduced by ${(1-r.sicknessDamageMultiplier)*100}% and movement by ${(1-r.sicknessSpeedMultiplier)*100}%. Reconnecting preserves the remaining sickness.</p><p class="muted">Recovering your body instead restores ${r.corpseHealthFraction*100}% health and energy, with no additional credit cost or sickness.</p><div class="settings-actions"><button class="button primary" data-do="healer-confirm">RESURRECT / ${view.healerCost} ¤</button><button class="small-button" data-do="close-panel">RETURN TO MY BODY</button></div>`,'REMEMBRANCE KEEPER / '+view.graveyard.name.toUpperCase(),'spirit-healer');
  audio.speak('Your body still remembers you. Walk back to it, and you keep more of yourself. I can bring you back here, but the city takes its share.','keeper');
}
function showRecoveryMenu(){
  const view=recoveryView(simulation.character,data,world,worldClock.now());
  if(!view?.spirit)return;
  panel('Find your way back.',`<p>Your body is ${view.distance} m away. Return within ${data.rules.death.reclaimRadius} m with a clear view to recover. You can use lifts while in spirit form.</p><div class="settings-actions"><button class="button primary" data-do="reclaim-corpse" ${view.canReclaim?'':'disabled'}>RECOVER BODY</button><button class="small-button" data-do="return-graveyard">RETURN SPIRIT TO GRAVEYARD</button><button class="small-button" data-do="spirit-healer" ${view.atHealer?'':'disabled'}>SPEAK TO KEEPER / ${view.healerCost} ¤ + SICKNESS</button><button class="small-button" data-do="map-region" data-id="${Math.max(Math.abs(simulation.character.death.corpse[0]),Math.abs(simulation.character.death.corpse[2]))>data.world.cityRadius?'basin':'city'}">LOCATE BODY</button><button class="small-button" data-do="settings">SETTINGS</button></div>`,'SPIRIT / RECOVERY','recovery');
}
function updateRecoveryUI(){
  const c=simulation.character,view=recoveryView(c,data,world,worldClock.now()),spirit=isSpirit(c),r=data.rules.death;
  const screen=$('#death-screen'),wasHidden=screen.hidden;
  screen.hidden=c.health>0||spirit;
  $('#world').classList.toggle('spirit-world',spirit);
  $('#death-description').textContent=simulation.inDungeon?'An ally can revive you. If the whole crew falls, this chapter restarts after five seconds.':`Death cost ${c.death?.creditsLost||0} ¤. Release your spirit at ${view?.graveyard?.name||'the nearest graveyard'}, then return to your body. Recovering it restores ${r.corpseHealthFraction*100}% health and energy. A keeper can resurrect you at the graveyard for an extra fee and sickness.`;
  $('#respawn').disabled=simulation.inDungeon||!view||view.wait>0;
  $('#respawn').textContent=simulation.inDungeon?'WAIT FOR AN ALLY OR CREW RECOVERY':view?.wait>0?`RELEASE SPIRIT IN ${view.wait}s`:'RELEASE SPIRIT ↗';
  $('#death-dungeons').hidden=!simulation.inDungeon;
  if(!screen.hidden&&wasHidden){document.exitPointerLock?.();input.clear();screen.focus();}
  $('#recovery-panel').hidden=!spirit;
  if(spirit&&view){
    $('#corpse-direction').textContent=`${bearing(c.position,c.death.corpse,yaw)} YOUR BODY · ${view.distance} m`;
    $('#recovery-description').textContent=view.canReclaim?'Your body is within reach. E / X / USE to recover with 50% health and energy.':`Get within ${r.reclaimRadius} m with a clear view of your body. Spirits are safe from damage and can use lifts. Body elevation: ${Math.round(c.death.corpse[1])} m. M opens the map; ESC / Menu opens recovery options.`;
    $('#reclaim-corpse').disabled=!view.canReclaim;
    $('#spirit-healer').hidden=!view.atHealer;
    $('#spirit-healer').textContent=`KEEPER · ${view.healerCost} ¤ + ${r.sicknessSeconds}s SICKNESS`;
  }
  $('#sickness-status').hidden=!(c.resurrectionSickness>0);
  const sickness=`RESURRECTION SICKNESS · ${Math.ceil(c.resurrectionSickness||0)}s · −${(1-r.sicknessDamageMultiplier)*100}% damage / −${(1-r.sicknessSpeedMultiplier)*100}% movement`;
  if($('#sickness-status').textContent!==sickness)$('#sickness-status').textContent=sickness;
}
function updateHUD(){
  if(!simulation)return;const c=simulation.character,s=simulation.playerStats;
  if(dialogPage.startsWith('resident:')){
    const resident=cityLife.actors.find(a=>a.id===dialogPage.slice(9));
    if(!resident||resident.activity==='flee'||c.health<=0||distance(c.position,resident.position)>data.rules.interactionRadius){closePanel();if(resident?.activity==='flee')toast(`${resident.name} is taking cover.`);}
  }
  $('#player-name').textContent=c.name;$('#player-level').textContent=c.level;$('#player-origin').textContent=data.races.find(r=>r.id===c.race).name.toUpperCase();
  $('#server-clock').textContent=clockLabel(worldClock.now());
  $('#server-clock').dateTime=new Date(worldClock.now()).toISOString();
  $('#health-fill').style.width=`${clamp(c.health/s.health*100,0,100)}%`;$('#health-text').textContent=`${Math.ceil(c.health)} / ${s.health}${simulation.shield?' +'+Math.ceil(simulation.shield):''}`;
  $('#energy-fill').style.width=`${clamp(c.energy/s.energy*100,0,100)}%`;$('#energy-text').textContent=`${Math.floor(c.energy)} / ${s.energy}`;
  $('#credits').textContent=`${c.credits} ¤`;$('#medkit-count').textContent=`${c.medkits} PACKS`;
  $('#xp-fill').style.width=`${c.level===60?100:c.xp/experienceFor(c.level,data.rules)*100}%`;$('#xp-text').textContent=c.level===60?'LEVEL 60 / SIGNAL COMPLETE':`LEVEL ${c.level} · ${c.xp} / ${experienceFor(c.level,data.rules)} XP`;
  $('#founder-xp-status').hidden=!founderBoostActive(c);
  const district=world.district(c.position),interior=world.interiorAt(c.position);
  $('#zone-name').textContent=interior?interior.interior.name:district.name;
  $('#zone-subtitle').textContent=interior?`${district.name} · UNIT ${100+interior.seed%900}`:district.subtitle;
  const neighborhood=cityLife.neighborhoods.get(district.id),street=$('#street-life');
  const incident=simulation.worldEvents.filter(e=>e.phase!=='idle'&&Math.abs(c.position[1]-e.position[1])<6&&distance(c.position,e.position)<data.events.rules.triggerRadius).sort((a,b)=>distance(c.position,a.position)-distance(c.position,b.position))[0];
  street.hidden=(!neighborhood&&!incident)||simulation.inDungeon;street.classList.toggle('has-incident',Boolean(incident));
  if(incident){
    const next=incident.controls.filter(s=>!incident.repaired.includes(s.id)).sort((a,b)=>distance(c.position,a.position)-distance(c.position,b.position))[0];
    street.textContent=`LIVE · ${incident.name}\n${incidentStatus(incident,data.events.rules,simulation.time)}${incident.phase==='active'&&next?`\nE · ${next.name} · ${Math.round(distance(c.position,next.position))} m`:''}`;
    street.style.setProperty('--neighborhood-color',incident.color);
  }else if(neighborhood){const event=cityEvent(neighborhood,worldClock.now());street.textContent=`${neighborhood.name} · ${event.name} · J: Neighborhoods`;street.style.setProperty('--neighborhood-color',neighborhood.color);}
  for(const node of document.querySelectorAll("[data-incident-status]")){const event=simulation.worldEvents.find(e=>e.id===node.dataset.incidentStatus);if(event)node.textContent=incidentStatus(event,data.events.rules,simulation.time);}
  const ds=simulation.dungeon,run=ds?.run,definition=run&&data.dungeons.entries.find(d=>d.id===run.dungeon);
  if(simulation.inDungeon){$('#zone-name').textContent=definition.name;$('#zone-subtitle').textContent=definition.chapters[run.chapter].name;}
  $('.quest-tracker').hidden=simulation.inDungeon||c.health<=0;$('.minimap-heading>span').textContent=simulation.inDungeon?'EXPEDITION':district.kind?district.name:district.id==='basin'?'PALE BASIN':'VESPER';
  const status=$('#dungeon-status');status.hidden=!run&&!ds?.queue;
  status.textContent=run?run.phase==='ready'?`CREW READY · ${Math.max(0,Math.ceil(run.deadline-simulation.time))}s · G TO ACCEPT`:run.phase==='active'?`CHAPTER ${run.chapter+1} · EVIDENCE ${run.evidence.length}/2 · SIGNED ${run.signed.length}/${run.members.length} · G CASEBOOK`:`${run.phase==='wipe'?'CREW RECOVERING':run.phase==='complete'?'EXPEDITION COMPLETE':run.phase==='decision'?'YOUR CHOICE':'CHAPTER READY'} · G CASEBOOK`:ds?.queue?`DUNGEON QUEUE · ${ds.queue.waiting}/${ds.queue.required} · G TO VIEW`:'';
  const hazard=$('#dungeon-warning'),warning=run?.phase==='active'&&run.nextPulse-simulation.time<=data.dungeons.rules.warningSeconds;
  hazard.hidden=!warning;if(warning)hazard.textContent=`${Math.max(0,Math.ceil(run.nextPulse-simulation.time))}s · ${definition.chapters[run.chapter].warning}`;
  if(dialogPage==='dungeons'){
    if(dungeonPanelKey!==dungeonKey()){
      const focused=document.activeElement?.closest('[data-do="dungeon"]')?.dataset,scroll=$('#panel-dialog').scrollTop,focusedEvidence=[...document.querySelectorAll('.dungeon-evidence summary')].indexOf(document.activeElement);
      const openEvidence=[...document.querySelectorAll('.dungeon-evidence')].map(e=>e.open);showDungeons();
      document.querySelectorAll('.dungeon-evidence').forEach((e,i)=>e.open=Boolean(openEvidence[i]));$('#panel-dialog').scrollTop=scroll;
      if(focused)[...document.querySelectorAll('[data-do="dungeon"]')].find(b=>b.dataset.operation===focused.operation&&b.dataset.choice===focused.choice&&b.dataset.dungeon===focused.dungeon)?.focus({preventScroll:true});
      else if(focusedEvidence>=0)document.querySelectorAll('.dungeon-evidence summary')[focusedEvidence]?.focus({preventScroll:true});
    }
    const countdown=$('[data-dungeon-countdown]');if(countdown)countdown.textContent=Math.max(0,Math.ceil(run.deadline-simulation.time));
    for(const node of document.querySelectorAll('[data-dungeon-vitals]')){const member=run?.members.find(m=>m.id===node.dataset.dungeonVitals);if(member)node.textContent=member.health<=0?'DOWN':`${Math.ceil(member.health)}/${Math.ceil(member.maxHealth)} HP`;}
  }
  $('#role-label').textContent=data.factions.find(f=>f.id===c.faction).name.toUpperCase()+' / RUNNER';
  $('#elevation').textContent=interior?'INTERIOR':c.position[1]>40?'CROWN / 48 M':c.position[1]>20?'SKYWAY / 24 M':'STREET LEVEL';
  const target=simulation.enemies.find(e=>e.id===targetId&&e.health>0);$('#target-frame').hidden=!target;
  if(target){$('#target-name').textContent=target.name;$('#target-level').textContent=`LV ${target.level}`;$('#target-health').style.width=`${target.health/target.maxHealth*100}%`;}
  const tracked=data.quests.filter(q=>c.activeQuests[q.id]!==undefined).slice(0,3);
  $('#tracked-quests').innerHTML=tracked.length?tracked.map(q=>{
    const view=questView(q,c),npc=data.npcs.find(n=>n.id===q.giver),dest=questDestination(q,c,data,simulation.worldEvents);
    return `<div class="tracked-quest"><strong>${esc(q.title)}${view.staged&&!view.ready?` · ${view.index+1}/${view.total}`:''}</strong><span>${view.ready?'↳ Return to '+esc(npc.name):esc(questObjective(q))+' · '+view.progress+'/'+view.step.count+(view.step.type==='hold'?'s':'')}</span>${dest?`<small>◇ ${Math.round(distance(c.position,dest.position))} m / ${esc(dest.name)}</small>`:''}</div>`;
  }).join(''):`<div class="tracked-quest"><strong>Make contact</strong><span>Meet ${esc(data.npcs.find(n=>n.id===data.factions.find(f=>f.id===c.faction).giver).name)} and Oru at Afterlight Commons.</span><small>J · Open your journal</small></div>`;
  updateStoryGuide();
  nearest=findNearest();$('#interaction').hidden=!nearest||$('#panel-dialog').open||c.health<=0&&!isSpirit(c);
  if(nearest)$('#interaction-text').textContent=`${['npc','resident'].includes(nearest.kind)?'Talk to ':nearest.kind==='lift'?'Ride ':''}${nearest.object.name}`;
  for(const a of data.abilities){const b=$(`[data-action="ability:${a.id}"]`),remaining=Math.max(0,(simulation.cooldowns[a.id]||0)-simulation.time);b.classList.toggle('locked',c.level<a.level);b.querySelector('.cooldown-shade').style.transform=`scaleY(${Math.min(1,remaining/a.cooldown)})`;b.querySelector('.cooldown-number').textContent=remaining>0?Math.ceil(remaining):'';b.querySelector('.locked-level').textContent=c.level<a.level?'LV '+a.level:'';}
  const ghost=simulation.ghostlines.find(g=>g.owner===c.id&&simulation.time<=g.started+g.path.at(-1).time),charge=simulation.ghostCharge;
  const ghostCooldown=Math.max(0,(simulation.cooldowns.ghostline||0)-simulation.time),ghostKey=input.connected?'R3':'R',g=data.rules.ghostline,ghostCost=data.abilities.find(a=>a.id==='ghostline').cost;
  $('#ghostline-status').textContent=c.health<=0?'GHOSTLINE · SIGNAL OFFLINE':ghost?'ECHO LIVE · CROSS THE CYAN RUNNER TO BRAID':ghostCooldown>0?`GHOSTLINE · RECHARGING ${Math.ceil(ghostCooldown)}s`:c.energy<ghostCost?`GHOSTLINE · NEED ${ghostCost} ENERGY`:charge?.ready?`${ghostKey} · GHOSTLINE READY · CAST, THEN CROSS YOUR ECHO`:`GHOSTLINE · MOVE ${Math.min(g.minDistance,Math.floor(charge?.meters||0))}/${g.minDistance} m · ${Math.min(g.minSeconds,charge?.seconds||0).toFixed(1)}/${g.minSeconds} s`;
  updateRecoveryUI();
  input.menu=state!=='playing'||$('#panel-dialog').open||c.health<=0&&!isSpirit(c);
  $('#input-label').textContent=input.connected?'CONTROLLER · A JUMP · X USE · RT FIRE':'WASD MOVE · RMB LOOK · SPACE JUMP · Q DASH';
  drawMap($('#minimap'),false);
  if(dialogPage==='map')drawMap($('#full-map'),true);
}
function drawMap(canvas,full){
  if(!canvas||!simulation)return;const ctx=canvas.getContext('2d'),c=simulation.character,w=canvas.width,h=canvas.height,scale=simulation.inDungeon?(full?9:2.5):full?Math.min(w,h)/((mapRegion==='city'?data.world.cityRadius:data.world.bounds)*2+160):.65,center=simulation.inDungeon?data.dungeons.rules.arena:full?[0,0,0]:c.position;
  const p=pos=>[w/2+(pos[0]-center[0])*scale,h/2+(pos[2]-center[2])*scale];
  ctx.fillStyle='#0b1b16';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#7a9a5833';ctx.lineWidth=1;
  if(!simulation.inDungeon)for(const b of data.world.biomes){const [x,y]=p(b.center);ctx.fillStyle=b.ground;ctx.strokeStyle=b.color;ctx.beginPath();ctx.arc(x,y,b.radius*scale,0,Math.PI*2);ctx.fill();ctx.stroke();}
  const city=p([-1120,0,-1120]);ctx.fillStyle='#23362a';ctx.fillRect(city[0],city[1],2240*scale,2240*scale);
  ctx.fillStyle='#65795966';for(const b of world.buildings){const [x,y]=p([b.x,0,b.z]);if(x>-20&&x<w+20&&y>-20&&y<h+20)ctx.fillRect(x-b.w*scale/2,y-b.d*scale/2,b.w*scale,b.d*scale);}
  ctx.strokeStyle='#82b9ae70';for(const road of data.world.platforms){const [x,y]=p(road.position);ctx.strokeRect(x-road.size[0]*scale/2,y-road.size[2]*scale/2,road.size[0]*scale,road.size[2]*scale);}
  if(!simulation.inDungeon){
    const cell=data.world.cellSize,minX=Math.max(-data.world.bounds,center[0]-w/2/scale),maxX=Math.min(data.world.bounds,center[0]+w/2/scale),minZ=Math.max(-data.world.bounds,center[2]-h/2/scale),maxZ=Math.min(data.world.bounds,center[2]+h/2/scale);
    ctx.fillStyle='#0b1422ed';
    for(let x=Math.floor(minX/cell);x<=Math.floor(maxX/cell);x++)for(let z=Math.floor(minZ/cell);z<=Math.floor(maxZ/cell);z++)if(!world.discovered.has(`${x},${z}`)){const [px,py]=p([x*cell,0,z*cell]);ctx.fillRect(px,py,cell*scale+.5,cell*scale+.5);}
    if(!full)for(const b of world.buildings)if(b.interior&&world.isDiscovered([b.x,0,b.z]))for(const side of [-1,1]){const [x,y]=p([b.x,0,b.z+side*b.d/2]);if(x>=0&&x<w&&y>=0&&y<h){ctx.fillStyle='#73f4d1';ctx.fillRect(x-2,y-1,4,2);}}
  }
  for(const lift of data.world.lifts){const [x,y]=p(lift.position);ctx.fillStyle='#77c4cd';ctx.fillRect(x-2,y-2,4,4);}
  if(simulation.inDungeon){const r=data.dungeons.rules,run=simulation.dungeon.run,d=data.dungeons.entries.find(d=>d.id===run.dungeon);const [x,y]=p(r.arena);ctx.strokeStyle='#d3dbba';ctx.strokeRect(x-r.arenaRadius*scale,y-r.arenaRadius*scale,r.arenaRadius*scale*2,r.arenaRadius*scale*2);for(const point of [...d.chapters[run.chapter].evidence.map(e=>dungeonPosition(r,e.position)),r.recoveryPosition]){const [x,y]=p(point);ctx.fillStyle=d.color;ctx.fillRect(x-3,y-3,6,6);}for(const other of otherPlayers){const [x,y]=p(other.position);ctx.fillStyle=other.health>0?'#81dce0':'#ee9b9f';ctx.fillRect(x-2,y-2,4,4);}}
  for(const npc of data.npcs){if(!world.isDiscovered(npc.position))continue;const [x,y]=p(npc.position);ctx.fillStyle=npc.color;ctx.fillRect(x-1.5,y-1.5,3,3);}
  if(!simulation.inDungeon){
    if(!full)for(const resident of cityLife.actors){if(Math.abs(resident.position[1]-c.position[1])>5||!world.isDiscovered(resident.position))continue;const [x,y]=p(resident.position);ctx.fillStyle=resident.activity==='flee'?'#e4b083':'#a1bab9';ctx.fillRect(x-1,y-1,2,2);}
    if(full&&mapRegion==='city')for(const n of data.citylife.neighborhoods){const contact=data.npcs.find(p=>p.id===n.contact),[x,y]=p(contact.position);ctx.fillStyle=n.color;ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();ctx.font='11px monospace';ctx.textAlign='center';ctx.fillText(n.name.toUpperCase(),x,y-20);ctx.font='9px monospace';ctx.fillText(`${contact.name}${contact.position[1]?' · SKYWAY':''}`,x,y-8);}
  }
  for(const q of data.quests)if(c.activeQuests[q.id]!==undefined){const dest=questDestination(q,c,data,simulation.worldEvents);if(dest){const [x,y]=p(dest.position);ctx.strokeStyle='#e7cb7b';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.stroke();}}
  if(!simulation.inDungeon){
    const guide=c.health>0?openingGuide(c,data,simulation.worldEvents):null;
    const markers=c.death?[{name:'YOUR BODY',position:c.death.corpse,color:'#c3e8ff'},...data.world.graveyards.filter(g=>g.id===c.death.graveyard).map(g=>({...g,color:'#91cbdc'}))]:guide?.destination?[{...guide.destination,color:'#f5d38a'}]:[];
    for(const marker of markers){const [mx,my]=p(marker.position),x=clamp(mx,9,w-9),y=clamp(my,20,h-9);ctx.strokeStyle=marker.color;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,y-6);ctx.lineTo(x+5,y);ctx.lineTo(x,y+6);ctx.lineTo(x-5,y);ctx.closePath();ctx.stroke();if(full){ctx.fillStyle=marker.color;ctx.font='10px monospace';ctx.textAlign='center';ctx.fillText(marker.name,x,y-10);}}
  }
  if(!simulation.inDungeon)for(const event of simulation.worldEvents){if(event.phase==='idle')continue;for(const site of event.controls){const [x,y]=p(site.position);ctx.strokeStyle=event.phase==='recovery'?'#9be7a1':event.color;ctx.lineWidth=2;ctx.strokeRect(x-4,y-4,8,8);if(full){ctx.font='9px monospace';ctx.textAlign='center';ctx.fillStyle=ctx.strokeStyle;ctx.fillText(site.id===event.anchor?event.name:site.name,x,y+15);}}}
  if(!full)for(const e of simulation.enemies)if(e.health>0&&(simulation.inDungeon||world.isDiscovered(e.position))){const [x,y]=p(e.position);ctx.fillStyle='#df8875';ctx.fillRect(x-1.5,y-1.5,3,3);}
  for(const ghost of simulation.ghostlines){if(simulation.time>ghost.started+ghost.path.at(-1).time)continue;ctx.strokeStyle='#81e5ed';ctx.lineWidth=1;ctx.beginPath();ghost.path.forEach((s,i)=>{const [x,y]=p(s.position);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();const [x,y]=p(ghostPosition(ghost,simulation.time));ctx.fillStyle='#81e5ed';ctx.fillRect(x-2,y-2,4,4);}
  if(full&&!simulation.inDungeon&&mapRegion==='basin'){ctx.font='10px monospace';ctx.textAlign='center';const [cx,cy]=p([0,0,0]);ctx.fillStyle='#c4ed92';ctx.fillText('VESPER / COMMONS',cx,cy-12);for(const b of data.world.biomes){const [x,y]=p(b.center),npc=data.npcs.find(n=>n.biome===b.id),known=world.isDiscovered(b.center);ctx.fillStyle=known?b.color:'#748392';ctx.fillText(known?b.name:'UNSURVEYED',x,y-b.radius*scale-8);if(known)ctx.fillText(`${npc.name} · LV ${data.quests.find(q=>q.biome===b.id).level}`,x,y+b.radius*scale+14);}}
  const [x,y]=p(c.position);ctx.save();ctx.translate(x,y);ctx.rotate(-c.yaw);ctx.fillStyle='#e1f2b3';ctx.beginPath();ctx.moveTo(0,-6);ctx.lineTo(4,5);ctx.lineTo(0,3);ctx.lineTo(-4,5);ctx.closePath();ctx.fill();ctx.restore();
  ctx.fillStyle='#bfd79e';ctx.font='9px monospace';ctx.textAlign='center';ctx.fillText('N',w/2,12);
}
function updateLabels(){
  if(!simulation||state!=='playing')return;const c=simulation.character;let html='';
  const waypoint=c.death?{name:'YOUR BODY',position:c.death.corpse}:currentGuide?.destination;
  if(waypoint&&!simulation.inDungeon){const p=renderer.project([waypoint.position[0],waypoint.position[1]+3.5,waypoint.position[2]]);if(p&&p[2]<=1)html+=`<div class="world-label story-waypoint" style="left:${p[0]}px;top:${p[1]}px">◇ ${esc(waypoint.name)}<small>${Math.ceil(distance(c.position,waypoint.position))} m${c.death?' · RECOVER BODY':' · STORY'}</small></div>`;}
  if(isSpirit(c)){const g=data.world.graveyards.find(g=>g.id===c.death.graveyard),p=g&&renderer.project([g.position[0],g.position[1]+3.5,g.position[2]]);if(p&&p[2]<=1)html+=`<div class="world-label" style="left:${p[0]}px;top:${p[1]}px;color:#bce8fa">REMEMBRANCE KEEPER<small>${esc(g.name)} · E / X / USE</small></div>`;}
  if(simulation.inDungeon){const run=simulation.dungeon.run,d=data.dungeons.entries.find(d=>d.id===run.dungeon),r=data.dungeons.rules;for(const e of [...d.chapters[run.chapter].evidence.map(e=>({...e,position:dungeonPosition(r,e.position)})),{name:'RECOVERY · E',position:r.recoveryPosition}]){const p=renderer.project([e.position[0],e.position[1]+3,e.position[2]]);if(p)html+=`<div class="world-label" style="left:${p[0]}px;top:${p[1]}px">${esc(e.name)}</div>`;}for(const other of otherPlayers.filter(p=>p.health<=0)){const p=renderer.project([other.position[0],other.position[1]+1,other.position[2]]);if(p)html+=`<div class="world-label" style="left:${p[0]}px;top:${p[1]}px">${esc(other.name)}<small>DOWN · E TO REVIVE</small></div>`;}}
  for(const npc of data.npcs){if(distance(c.position,npc.position)>75||!world.lineOfSight(c.position,npc.position))continue;const p=renderer.project([npc.position[0],npc.position[1]+3,npc.position[2]]);if(!p||p[2]>1)continue;const has=data.quests.some(q=>q.giver===npc.id&&(availableQuest(q,c)||c.activeQuests[q.id]>=q.objective.count));html+=`<div class="world-label" style="left:${p[0]}px;top:${p[1]}px;color:${npc.color}">${has?'<span class="quest-mark">!</span>':''}${esc(npc.name)}<small>${esc(npc.title)}</small></div>`;}
  if(!simulation.inDungeon){
    const overheard=!$('#panel-dialog').open&&cityLife.overheard(c.position,worldClock.now());
    const resident=nearest?.kind==='resident'?cityLife.actors.find(a=>a.id===nearest.object.id):null;
    for(const actor of [overheard,resident].filter((a,i,all)=>a&&all.findIndex(b=>b?.id===a.id)===i)){
      if(!world.lineOfSight(c.position,actor.position))continue;
      const p=renderer.project([actor.position[0],actor.position[1]+3,actor.position[2]]);
      if(p&&p[2]<=1)html+=`<div class="world-label resident-label" style="left:${p[0]}px;top:${p[1]}px;color:${actor.color}">${esc(actor.name)}<small>${esc(actor.title)}</small>${actor===overheard?`<span class="street-speech">“${esc(Math.floor(worldClock.now()/23000)%2?actor.line:data.citylife.roles[actor.role].line)}”</span>`:''}</div>`;
    }
    for(const event of simulation.worldEvents){
      if(event.phase==='idle'||distance(c.position,event.position)>100||!world.lineOfSight(c.position,event.position))continue;
      const p=renderer.project([event.position[0],event.position[1]+9,event.position[2]]);
      if(p&&p[2]<=1)html+=`<div class="world-label incident-label" style="left:${p[0]}px;top:${p[1]}px;color:${event.color}">${esc(event.name)}<small>${esc(incidentStatus(event,data.events.rules,simulation.time))}</small></div>`;
      if(event.hazard){const h=event.hazard,p=renderer.project([h.position[0],h.position[1]+1,h.position[2]]);if(p&&p[2]<=1)html+=`<div class="world-label" style="left:${p[0]}px;top:${p[1]}px;color:#ff9c67">SURGE · ${Math.max(0,Math.ceil(h.hitsAt-simulation.time))}s<small>LEAVE THE MARKED CIRCLE</small></div>`;}
    }
    for(const site of data.world.landmarks.filter(l=>l.neighborhood)){
      if(distance(c.position,site.position)>32||!world.lineOfSight(c.position,site.position))continue;
      const p=renderer.project([site.position[0],site.position[1]+4.6,site.position[2]]);
      if(p&&p[2]<=1)html+=`<div class="world-label street-site" style="left:${p[0]}px;top:${p[1]}px;color:${site.color}">${esc(site.name)}<small>LOCAL RECORD · E</small></div>`;
    }
  }
  for(const e of simulation.enemies){if(e.health<=0||distance(c.position,e.position)>80||!world.lineOfSight(c.position,e.position))continue;const p=renderer.project([e.position[0],e.position[1]+3.4,e.position[2]]);if(!p||p[2]>1)continue;html+=`<div class="world-label" style="left:${p[0]}px;top:${p[1]}px;color:${e.id===targetId?'#f1d0a4':'#d4b7a0'}">${esc(e.name)} <small>LV ${e.level}</small><div class="enemy-bar"><i style="width:${e.health/e.maxHealth*100}%"></i></div></div>`;}
  for(const other of otherPlayers){if(other.health<=0||distance(c.position,other.position)>80||!world.lineOfSight(c.position,other.position))continue;const p=renderer.project([other.position[0],other.position[1]+2.8,other.position[2]]);if(p)html+=`<div class="world-label" style="left:${p[0]}px;top:${p[1]}px">${esc(other.name)}${other.guild?`<small>〈${esc(other.guild.name)}〉</small>`:''}</div>`;}
  for(const ghost of simulation.ghostlines){if(simulation.time>ghost.started+ghost.path.at(-1).time)continue;const position=ghostPosition(ghost,simulation.time);if(distance(c.position,position)>80)continue;const p=renderer.project([position[0],position[1]+3.2,position[2]]);if(p)html+=`<div class="world-label ghostline-label" style="left:${p[0]}px;top:${p[1]}px">${esc(ghost.name)} · GHOSTLINE<small>${simulation.time<ghost.started+data.rules.ghostline.armSeconds?'ARMING':'CROSS TO BRAID'}</small></div>`;}
  for(const f of floaters){const age=time-f.time,p=renderer.project([f.position[0],f.position[1]+3+age*2,f.position[2]]);if(p)html+=`<div class="float-number ${f.critical?'critical':''}" style="left:${p[0]}px;top:${p[1]}px;color:${f.color};opacity:${1-age/f.duration}">${esc(f.text)}</div>`;}
  $('#world-labels').innerHTML=html;
}
function gameCamera(dt){
  const c=simulation.character,p=c.position;const look=[p[0]-Math.sin(yaw)*8,p[1]+1.7-Math.sin(pitch)*8,p[2]-Math.cos(yaw)*8];
  if(!thirdPerson)return{eye:[p[0],p[1]+1.8,p[2]],target:look,fov:1.1};
  const desired=[p[0]+Math.sin(yaw)*8*Math.cos(pitch),p[1]+3.3+Math.sin(pitch)*6,p[2]+Math.cos(yaw)*8*Math.cos(pitch)];
  let eye=desired;for(let t=.05;t<=1;t+=.05){const sample=mix3([p[0],p[1]+1.8,p[2]],desired,t);if(world.collides(sample[0],sample[1]-.15,sample[2],.2,.3)){eye=mix3([p[0],p[1]+1.8,p[2]],desired,Math.max(0,t-.06));break;}}
  const speed=Math.hypot(simulation.velocity[0],simulation.velocity[2]),desiredFov=1.04+(reducedMotion?0:clamp((speed-10)/14,0,1)*.09);
  cameraFov=lerp(cameraFov,desiredFov,1-Math.exp(-dt*5));
  return{eye,target:[p[0]-Math.sin(yaw)*3,p[1]+1.8-Math.sin(pitch)*3,p[2]-Math.cos(yaw)*3],fov:cameraFov};
}
function frame(timestamp){
  const dt=Math.min((timestamp-lastFrame)/1000||.016,.05);lastFrame=timestamp;time+=dt;
  const controls=input.sample(dt);let actors=data.npcs.map(n=>({...n,model:'humanoid',yaw:Math.atan2(-n.position[0],32-n.position[2])})),camera;
  if(state==='landing'){
    const orbit=reducedMotion?0:Math.sin(time*.018)*6;camera={eye:[58+orbit,40,58],target:[-55,28,-130],fov:.95};
  }else if(state==='creation'){
    camera={eye:[3,2.4,38.5],target:[-3,1.2,32],fov:.62};actors=[{position:[0,0,32],model:'humanoid',race:selectedRace,yaw:Math.PI*.2+(reducedMotion?0:Math.sin(time*.2)*.15),color:data.races.find(r=>r.id===selectedRace).color,founderHalo:account?.founderHalo}];
  }else if(state==='cinematic'){
    connection?.update(dt,{forward:0,strafe:0,yaw,jump:false,dash:false,sprint:false});
    introTime+=dt;const index=data.intro.shots.findIndex(s=>introTime>=s.start&&introTime<s.end),shot=data.intro.shots[Math.max(0,index)];
    if(index<0){finishIntro();camera=gameCamera(dt);}else{
      const t=clamp((introTime-shot.start)/(shot.end-shot.start),0,1),eased=t*t*(3-2*t);camera={eye:mix3(shot.from,shot.to,eased),target:mix3(shot.lookFrom,shot.lookTo,eased),fov:.88};
      if(introShot!==index){introShot=index;$('#cinema-label').textContent=shot.label;$('#cinema-subtitle').textContent=shot.caption;audio.speak(shot.caption);}
      $('#cinema-progress').style.width=`${introTime/data.intro.duration*100}%`;
    }
  }else if(simulation){
    controls.yaw=yaw;simulation.tick(dt,controls);connection?.update(dt,controls);camera=gameCamera(dt);
    if(!simulation.inDungeon)world.reveal(simulation.character.position);
    if(thirdPerson){const c=simulation.character;actors.push({...c,ghost:isSpirit(c),guild:myGuild,model:'humanoid',velocity:simulation.velocity,grounded:simulation.grounded,yaw:yaw+Math.PI,color:isSpirit(c)?'#bce8fa':data.races.find(r=>r.id===c.race).color});}
    if(simulation.character.death){const c=simulation.character,g=data.world.graveyards.find(g=>g.id===c.death.graveyard);actors.push({id:'fallen-body',model:'humanoid',race:c.race,position:c.death.corpse,corpse:true,color:'#9cb0bf'});if(isSpirit(c)&&g)actors.push({id:'spirit-keeper',model:'humanoid',position:g.position,ghost:true,color:'#bce8fa'});}
    actors.push(...simulation.enemies,...otherPlayers.filter(p=>p.id!==simulation.character.id).map(p=>({...p,model:'humanoid',color:p.ghost?'#bce8fa':data.races.find(r=>r.id===p.race)?.color||'#c7ed99'})));
  }
  if(!camera)camera={eye:[135,81,165],target:[-45,36,-95]};
  if(state==='playing'&&simulation.inDungeon)cityLife.clear();
  else if(state!=='creation')actors.push(...cityLife.update(worldClock.now(),state==='playing'?simulation.character.position:[camera.target[0],0,camera.target[2]],{enemies:state==='playing'?simulation.enemies:[],incidents:state==='playing'?simulation.worldEvents:[],completed:state==='playing'?simulation.character.completed:[],quality:renderer.quality,focus:dialogPage.startsWith('resident:')?dialogPage.slice(9):null}));
  if(state==='playing'){uiAccumulator+=dt;if(uiAccumulator>.1){uiAccumulator=0;updateHUD();}}
  effects=effects.filter(e=>time-e.time<e.duration);floaters=floaters.filter(f=>time-f.time<f.duration);
  renderer.render(camera,actors,effects,time,worldClock.now(),state==='playing'?simulation.ghostlines:[],simulation?.time||0,state==='playing'&&simulation?.inDungeon?{catalog:data.dungeons,run:simulation.dungeon.run}:null,state==='playing'&&!simulation.inDungeon?{events:simulation.worldEvents,rules:data.events.rules}:null);updateLabels();requestAnimationFrame(frame);
}
async function boot(){
  const names=['rules','world','races','factions','quests','talents','abilities','enemies','npcs','intro','audio','lore','dungeons','citylife','events'];
  const manifest=await fetch('/data/manifest.json').then(r=>r.json());
  if(manifest.format!=='sloperberpunk-content-manifest'||manifest.version!==2||[...names,'models'].some(name=>manifest.files?.[name]!==1))throw new Error('Unsupported content schema version.');
  const values=await Promise.all(names.map(async name=>{const response=await fetch(`/data/${name}.json`);if(!response.ok)throw new Error(`Could not load ${name}.`);return response.json();}));data=Object.fromEntries(names.map((n,i)=>[n,values[i]]));
  validateDungeons(data.dungeons,data);
  const models=await fetch('/assets/models.json').then(r=>r.json());world=new World(data.world);validateWorldEvents(data.events,data,world);validateCityLife(data.citylife,data,world);cityLife=new CityLife(world,data.citylife);renderer=new Renderer($('#world'),world,models,cityLife);renderer.reducedMotion=reducedMotion;audio=new AudioEngine(data.audio);
  audio.onCaption=caption=>{$('#voice-caption').hidden=!caption||state!=='playing'||$('#panel-dialog').open;if(caption){$('#voice-speaker').textContent=caption.speaker;$('#voice-line').textContent=caption.text;}};
  community=new Community({character:()=>simulation?.character,online:()=>Boolean(connection?.open),showPanel:panel,isOpen:()=>dialogPage==='community'&&$('#panel-dialog').open,toast,races:data.races,now:()=>worldClock.now()});
  input=new Input($('#world'),perform,(dx,dy)=>{yaw-=dx;pitch=clamp(pitch+dy,-.45,1.05);});
  initialUI();wireEvents();$('#loading').hidden=true;setState('landing');requestAnimationFrame(frame);
  refreshFounderOffer();
  api('/health').then(health=>worldClock.sync(health.serverTime)).catch(()=>{});
  sessionReady=api('/session').then(session=>{account={username:session.username,founderHalo:session.founderHalo};$('#account-label').textContent=account.username;updateFounderOffer();}).catch(error=>{if(error.status!==401)toast('The server is unavailable. Try signing in again when your connection returns.');});
}
boot().catch(error=>{console.error(error);$('#loading').innerHTML='';const box=document.createElement('div');box.className='fatal';box.textContent=`Unable to establish a signal. ${error.message}`;$('#loading').append(box);});
