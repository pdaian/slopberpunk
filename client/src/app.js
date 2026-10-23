// Sloperberpunk browser application. GPL-3.0-or-later. See LICENSE.
import { World } from './world.js';
import { Renderer } from './renderer.js';
import { WebGLUI } from './webgl-ui.js';
import { Prediction,availableQuest,experienceFor,stats } from './prediction.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { Connection,api } from './network.js';
import { icon,escapeHtml as esc } from './icons.js';
import { clamp,distance,mix3,lerp } from './math.js';
import { Community } from './social.js';
import { LiveSocial } from './live-social.js';
import { WorldClock,clockLabel } from './clock.js';
import { downloadCharacter } from './persistence.js';
import { ghostPosition } from './ghostline.js';
import { hasFounderHalo, founderBoostActive, founderXpReward, founderOfferView } from './founders.js';
import { validateDungeons, dungeonPanel, dungeonPosition } from './dungeons.js';
import { CityLife, validateCityLife, cityStage, cityEvent } from './citylife.js';
import { questView, questDestination, objectiveText, openingGuide } from './quests.js';
import { validateStory, questThread, campaignLead, campaignPanel, storyDialogue } from './story.js';
import { validateWorldEvents, worldEventViews, incidentStatus } from './events.js';
import { isSpirit, recoveryView, bearing } from './death.js';
import { collectTargets, targetProblem, targetBounds, visibleTargets, pickTarget, cycleTarget } from './targeting.js';
import { validateEconomy, economyTabs, inventoryPanel, craftingPanel, bestiaryPanel, classPanel, itemById, nearPatch, workOrdersPanel, modularDropsPanel } from './economy.js';

import { talentPanel, talentBudget, validateProgression } from './progression.js';
import { statCaps, statNames } from './item-catalog.js';
import { validateMorality, decisionPanel, decisionOutcome, moralStandingPanel, moralPrice, vendorPercent, neighborhoodOutcome } from './morality.js';

const $=selector=>document.querySelector(selector);
let data,world,renderer,interfaceUI,input,audio,cityLife,simulation=null,connection=null,account=null;
let state='landing',selectedRace='human',selectedFaction='relay',targetKey=null;
let time=0,lastFrame=0,uiAccumulator=0,yaw=0,pitch=.15,thirdPerson=true,introTime=0,introShot=-1;
let toastTimer,dialogPage='',journalFilter='story',otherPlayers=[],effects=[],floaters=[],log=[],deleteArmed=null;
let community,liveChat,myGuild=null,founderOffer=null;
let sessionReady=Promise.resolve();
let dungeonPanelKey='';
let cameraFov=1.04;
let mapRegion='city';
let bestiaryQuery={},catalogQueries={inventory:{},crafting:{}},talentBranch='Anchor';
let storyCue='',currentGuide=null;
const exploration=new Map();
const worldClock=new WorldClock();
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;

function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
function inputBlocked(){return state!=='playing'||$('#panel-dialog').open||Boolean(liveChat?.expanded)||Boolean(simulation&&simulation.character.health<=0&&!isSpirit(simulation.character));}
function setState(next){
  if(next!=='playing')liveChat?.close();
  if(next!=='playing'){audio?.stopVoice();$('#world').classList.remove('spirit-world');}
  state=next;for(const name of ['landing','creation','cinematic','hud'])$(`#${name}`).hidden=next!==(name==='hud'?'playing':name);
  if(input){input.active=next==='playing'||next==='cinematic';input.menu=inputBlocked();input.clear();}
}
function closePanel(){interfaceUI?.closeSelect();if($('#panel-dialog').open)$('#panel-dialog').close();dialogPage='';audio?.stopVoice();if(input){input.menu=inputBlocked();input.clear();}}
function panel(title,html,eyebrow='SLOPERBERPUNK / MENU',page=''){
  liveChat?.close();
  if(dialogPage!==page)audio?.stopVoice();
  interfaceUI?.closeSelect();
  $('#dialog-title').textContent=title;$('#dialog-eyebrow').textContent=eyebrow;$('#dialog-content').innerHTML=html;dialogPage=page;
  if(!$('#panel-dialog').open)$('#panel-dialog').showModal();
  if(input){input.menu=true;input.clear();}
}
function initialUI(){
  $('#race-options').innerHTML=data.races.map(r=>`<label class="choice" style="--choice-color:${r.color}"><input type="radio" name="race" value="${r.id}" ${r.id===selectedRace?'checked':''}>${icon(r.id)}<strong>${esc(r.name)}</strong><small>${esc(r.passive.name)}</small></label>`).join('');
  $('#faction-options').innerHTML=data.factions.map(f=>`<label class="choice" style="--choice-color:${f.color}"><input type="radio" name="faction" value="${f.id}" ${f.id===selectedFaction?'checked':''}>${icon(f.id)}<strong>${esc(f.shortName||f.name)}</strong></label>`).join('');
  updateChoices();
  const abilityNames={arc:'SHOOT',surge:'STUN',mend:'HEAL',aegis:'SHIELD',lance:'POWER',echo:'BLAST',ghostline:'GHOST',breach:'WEAKEN',siphon:'DRAIN',execute:'FINISH',nova:'WEAKEN+'};
  $('#hotbar').innerHTML=data.abilities.map(a=>`<button class="ability" data-action="ability:${a.id}" data-tooltip="${esc(a.name)} — ${esc(a.description)} Before bonuses: ${a.cost} energy; ${a.cooldown} seconds between uses." aria-label="${esc(a.name)}: ${esc(a.description)} Before bonuses: ${a.cost} energy; ${a.cooldown} seconds between uses." style="color:${a.color}"><span class="key">${a.key}</span>${icon(a.icon)}<span class="ability-name">${abilityNames[a.id]||esc(a.name)}</span><span class="cooldown-shade" style="transform:scaleY(0)"></span><span class="cooldown-number"></span><span class="locked-level"></span></button>`).join('')+`<button class="ability" data-action="medkit" data-tooltip="Restore health with a medkit [H]" aria-label="Use medkit"><span class="key">H</span>${icon('medkit')}<span class="ability-name">MEDKIT</span><span id="medkit-count" class="locked-level"></span></button>`;
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
  return `<article class="founder-item"><img src="/assets/first-signal-halo.svg" width="480" height="260" alt="First Signal Halo"><div><span class="tag">EDITION ${String(c.founderHalo).padStart(4,'0')} / 1,000 · WORN AUTOMATICALLY · CANNOT BE TRADED</span><h3>First Signal Halo</h3><p>Black-chrome crown. Magenta light fins. A luminous cyan orbit. Its pattern recalls the first Commons crews keeping a return signal lit for one another.</p><p>${status} All characters on your account keep this item. It cannot be traded.</p></div></article>`;
}
function updateChoices(){
  const race=data.races.find(r=>r.id===selectedRace),faction=data.factions.find(f=>f.id===selectedFaction);
  $('#race-description').textContent=`${race.description} ${race.passive.description}`;
  $('#faction-description').textContent=faction.description;
  $('#preview-lineage').textContent=race.name.toUpperCase();$('#preview-lineage').style.color=race.color;
}
function openCreation(){
  if(!account)return showAccount().catch(e=>toast(e.message));
  closePanel();$('#character-error').textContent='';$('#creation-storage').textContent=`Progress saved to account ${account.username}`;
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
  panel('Choose a character.',`<p class="muted">Account: ${esc(account.username)}</p>${hasFounderHalo(account)?'<p class="founder-account-note"><strong>First Signal Halo unlocked.</strong> Your numbered halo is worn automatically by every character on this account. +5% XP from level 1 until reaching level 10.</p>':''}${chars.map(c=>`<div class="character-row"><div class="grow"><strong>${esc(c.name)}</strong><small>LEVEL ${c.level} · ${esc(data.races.find(r=>r.id===c.race)?.name||c.race)} · ${esc(data.factions.find(f=>f.id===c.faction)?.name||c.faction)}</small></div><button class="small-button" data-do="play-character" data-id="${esc(c.id)}">PLAY ↗</button><button class="small-button danger" data-do="delete-character" data-id="${esc(c.id)}">${deleteArmed===c.id?'CONFIRM DELETE':'DELETE'}</button></div>`).join('')}<div class="settings-actions"><button class="button primary" data-do="new-character" ${chars.length>=8?'disabled':''}>NEW CHARACTER +</button><button class="small-button" data-do="logout">SIGN OUT</button></div>`,'YOUR SAVED CHARACTERS','characters');
}
async function startGame(character,newCharacter=false){
  closePanel();connection?.close();connection=null;otherPlayers=[];targetKey=null;effects=[];floaters=[];
  myGuild=null;community?.reset(character.id);liveChat?.reset(character.id);worldClock.reset();cityLife.clear();
  storyCue='';currentGuide=null;
  simulation=new Prediction(data,world,structuredClone(character),onEvent);yaw=character.yaw||0;pitch=.15;
  if(!exploration.has(character.id))exploration.set(character.id,new Set());
  world.discovered=exploration.get(character.id);world.reveal(character.position);cameraFov=1.04;
  connection=new Connection(character.id,onSnapshot,onEvent,()=>{
    setState('landing');panel('Connection lost.','<p>Your server connection closed. Reconnect to continue from the server save.</p><button class="button primary" data-do="reconnect">RECONNECT ↗</button>','CONNECTION LOST','disconnected');
  });
  try{await connection.connect();}catch(error){connection.close();connection=null;simulation=null;setState('landing');toast(error.message);return;}
  $('#network-label').textContent='ONLINE';
  if(newCharacter||!character.introSeen){introTime=0;introShot=-1;setState('cinematic');}
  else{setState('playing');toast('Welcome back. Press J and open Story to see what to do next.');}
  updateHUD();
}
function onSnapshot(message){
  if(!simulation||!message.character)return;
  const questPanelOpen=$('#panel-dialog').open&&(dialogPage==='journal'||dialogPage.startsWith('npc:'));
  const previousQuestPanel=questPanelOpen?questPanelState():null;
  const previousCharacter=simulation.character,previous=previousCharacter.position,server=message.character;
  const economyState=c=>JSON.stringify([c.items,c.equipment,Object.keys(c.buffs||{}),c.mobKills,c.medkits,c.gold,c.level,c.talents,talentBudget(c,data.rules),c.workOrder,c.ordersCompleted,c.morality]);
  const economyChanged=['inventory','crafting','talents','orders','shop'].includes(dialogPage)&&economyState(previousCharacter)!==economyState(server);
  const recoveryChanged=isSpirit(previousCharacter)!==isSpirit(server)||(previousCharacter.health>0)!==(server.health>0);
  const teleported=distance(previous,server.position)>8;
  if(state==='playing'&&!recoveryChanged&&distance(previous,server.position)<3){
    const blended=mix3(previous,server.position,.12);
    if(!world.collides(...blended))server.position=blended;
  }
  simulation.character=server;simulation.enemies=message.enemies||[];otherPlayers=message.players||[];
  if(recoveryChanged||teleported){targetKey=null;simulation.velocity=[0,0,0];simulation.dash=0;simulation.jumpBuffer=0;simulation.coyote=0;input.clear();if(recoveryChanged&&server.health<=0)closePanel();}
  simulation.worldEvents=worldEventViews(data,message.worldEvents);
  const previousRun=simulation.dungeonState?.run;simulation.dungeonState=message.dungeon||null;
  const currentRun=simulation.dungeonState?.run;
  if(previousRun?.id!==currentRun?.id||previousRun?.chapter!==currentRun?.chapter||previousRun?.phase==='ready'&&currentRun?.phase!=='ready'||previousRun?.phase==='wipe'&&currentRun?.phase==='briefing'){targetKey=null;simulation.velocity=[0,0,0];simulation.dash=0;simulation.grounded=true;simulation.coyote=0;simulation.jumpBuffer=0;}
  simulation.cooldowns=message.cooldowns||{};simulation.time=message.time||0;simulation.shield=message.shield||0;
  simulation.ghostlines=message.ghostlines||[];simulation.ghostCharge=message.ghostCharge||{seconds:0,meters:0,ready:false};simulation.dashReady=message.dashReady??simulation.dashReady;
  worldClock.sync(message.serverTime);myGuild=message.guild||null;
  liveChat?.setContext(message.chatContext);
  for(const event of message.social||[])liveChat?.receive(event);
  if(economyChanged&&!recoveryChanged){
    const scroll=$('#panel-dialog').scrollTop,focus=document.activeElement?.dataset;
    refreshPanel();
    if(focus?.do)[...document.querySelectorAll('#dialog-content [data-do]')].find(e=>e.dataset.do===focus.do&&e.dataset.id===focus.id&&!e.disabled)?.focus();
    $('#panel-dialog').scrollTop=scroll;
  }
  if(dialogPage==='inventory')for(const timer of document.querySelectorAll('[data-buff-timer]')){
    const seconds=String(Math.ceil(server.buffs?.[timer.dataset.buffTimer]||0));if(timer.textContent!==seconds)timer.textContent=seconds;
  }
  if(questPanelOpen&&!recoveryChanged&&previousQuestPanel!==questPanelState()){
    const scroll=$('#panel-dialog').scrollTop,focus=document.activeElement?.dataset;
    const focusedSection=document.activeElement?.tagName==='SUMMARY'?document.activeElement.parentElement?.dataset.storySection:null;
    const expanded=new Map([...document.querySelectorAll('[data-story-section]')].map(e=>[e.dataset.storySection,e.open]));
    if(dialogPage==='journal')showJournal();else talk(data.npcs.find(n=>n.id===dialogPage.slice(4)),false);
    document.querySelectorAll('[data-story-section]').forEach(e=>{
      if(expanded.has(e.dataset.storySection))e.open=expanded.get(e.dataset.storySection);
      if(e.dataset.storySection===focusedSection)e.querySelector('summary')?.focus({preventScroll:true});
    });
    if(focus?.do)[...document.querySelectorAll('#dialog-content [data-do]')].find(e=>e.dataset.do===focus.do&&e.dataset.id===focus.id&&e.dataset.choice===focus.choice)?.focus();
    $('#panel-dialog').scrollTop=scroll;
  }
}
function questPanelState(){
  const c=simulation.character;
  return JSON.stringify([c.level,c.tutorialStage,c.activeQuests,Object.entries(c.questStages||{}).map(([id,s])=>[id,s.index,s.progress]),c.completed,c.dungeonHistory,c.morality,simulation.worldEvents.map(e=>[e.id,e.phase,e.repaired.length])]);
}
function finishIntro(){
  if(state!=='cinematic')return;audio.stopVoice();simulation.character.introSeen=true;
  connection?.send({type:'intro_seen'});
  setState('playing');toast(simulation.character.tutorialStage?'Welcome to the training courtyard. Follow the marker to learn movement, interaction, and shooting.':'Follow the quest marker to your contact. Click them, then press E to talk. Controller: X. Touch: USE.');
}
function act(action){
  if(!simulation)return;
  connection?.send(action);
}
function onEvent(event){
  if(event.type==='social'||event.type==='socialError'){liveChat?.receive(event);return;}
  if(event.type==='loot'){
    const name=itemById(data,event.item)?.name||event.item;
    const message=event.quantity?`Recovered ${event.quantity} × ${name}`:`${name} stack full`;
    const detail=event.salvaged?` · ${event.salvaged} excess sold for ${event.gold} gold`:'';
    addLog(message+detail);toast(message+detail);return;
  }
  if(event.type==='worldEvent'){toast(event.text);addLog(event.text);return;}
  if(event.type==='braid'){
    if(simulation)simulation.ghostlines=simulation.ghostlines.filter(g=>g.owner!==event.owner);
    effects.push({...event,kind:'braid',time,duration:.8});
    if([event.owner,event.partner].includes(simulation?.character.id)){audio?.effect('surge');toast(`${event.cooperative?'TEAM BLAST · +50% power':'GHOSTLINE BLAST'} · Dash restored · +${data.rules.ghostline.energyReturn} energy`);addLog(event.cooperative?'Ghostline · another player touched your ghost.':'Ghostline · you touched your ghost.');}
    return;
  }
  if(event.type==='notice'){toast(event.text);return;}
  if(event.type==='sound'){audio?.effect(event.name);return;}
  if(event.type==='effect'){effects.push({...event,time,duration:event.kind==='beam'?.13:.8});return;}
  if(event.type==='hit'){
    floaters.push({...event,time,duration:1,text:event.damage?`${event.critical?'✧ ':''}${event.damage}`:'MISS'});
    addLog(`${event.ability} · hit roll ${event.roll}/100 · ${event.damage?event.damage+' damage':'miss'}${event.critical?' CRITICAL':''}${event.combo?' COMBO':''}`);
  }
  if(event.type==='hurt'){audio.effect('hurt');addLog(`You took ${event.amount} damage`);}
  if(event.type==='level'){toast(`LEVEL ${event.level} · A new talent point is available. Your maximum health has increased.`);audio.effect('confirm');effects.push({kind:'level',position:[...simulation.character.position],color:'#c7ed99',time,duration:1});}
  if(event.type==='questAccepted'){toast(`Quest accepted · ${event.quest.title}`);audio.speak(event.quest.briefing,event.quest.giver);}
  if(event.type==='questProgress'){
    const next=event.quest.steps?.[event.stage?.index];
    addLog(`${event.quest.title} · ${next?`${event.stage.index+1}/${event.quest.steps.length} · ${next.text} ${event.stage.progress}/${next.count}`:`${event.progress}/${event.quest.objective.count}`}`);
    if(event.progress>=event.quest.objective.count)toast('Objective complete. Return to your contact.');
    else if(next&&event.stage.progress===0)toast(`Next · ${next.text}`);
  }
  if(event.type==='questComplete'){toast(`Quest complete · +${event.xp??event.quest.reward.xp} XP / +${event.gold??event.quest.reward.gold} gold`);audio.effect('confirm');audio.speak(event.outcome||event.quest.completion,event.quest.giver);addLog(event.quest.title+' · '+(event.outcome||'complete'));}
  if(event.type==='reward')addLog(`Recovered ${event.gold} gold · +${event.xp} XP`);
}
function addLog(text){log.push(text);log=log.slice(-5);$('#combat-log').innerHTML=log.map(t=>`<div>${esc(t)}</div>`).join('');}
function perform(action,event){
  if(action==='escape'){
    if(state==='cinematic')return finishIntro();
    if(liveChat?.expanded){liveChat.close();return;}
    if($('#panel-dialog').open)return closePanel();
    if(state==='creation')return setState('landing');
    if(state==='playing'){if(targetKey){targetKey=null;return;}return isSpirit(simulation.character)?showRecoveryMenu():showSettings();}return;
  }
  if(state!=='playing')return;
  if(action==='chat'||action==='gestures'){closePanel();liveChat.open(liveChat.channel,action==='gestures');return;}
  if(action.startsWith('ability:')){if(!$('#panel-dialog').open&&simulation.character.health>0){const target=selectedTarget();act({type:'ability',id:action.split(':')[1],target:target&&['enemy','practice'].includes(target.kind)?target.object.id:null});}return;}
  const panels={settings:()=>isSpirit(simulation.character)?showRecoveryMenu():showSettings(),journal:showJournal,story:()=>showJournal('story'),neighborhoods:()=>showJournal('neighborhoods'),talents:showTalents,inventory:showInventory,map:showMap,dungeons:showDungeons,guild:()=>community.open('guild').catch(e=>toast(e.message)),community:()=>community.open().catch(e=>toast(e.message))};if(panels[action])return panels[action]();
  if(action==='camera'){thirdPerson=!thirdPerson;return;}
  if(action==='medkit'){act({type:'medkit'});return;}
  if($('#panel-dialog').open||simulation.character.health<=0&&!isSpirit(simulation.character))return;
  if(['target','pick','pick-activate'].includes(action)){
    const targets=visibleTargets(targetCandidates(),simulation.character,world,renderer);
    const rect=renderer.canvas.getBoundingClientRect();
    const target=action==='target'?cycleTarget(targets,targetKey,simulation.character.position):pickTarget(targets,renderer,event.clientX-rect.left,event.clientY-rect.top);
    targetKey=target?.key||null;
    if(action==='pick-activate'&&target)return activateTarget();
    return;
  }
  if(action==='interact')return activateTarget();
}

function targetCandidates(){return simulation?collectTargets(data,simulation,cityLife.actors,otherPlayers):[];}
function selectedTarget(){if(!targetKey)return null;const target=targetCandidates().find(t=>t.key===targetKey)||null;if(!target)targetKey=null;return target;}
function activateTarget(){
  const target=selectedTarget(),problem=targetProblem(target,simulation.character,world);
  if(problem)return toast(problem+'.');
  const {kind,object}=target;
  if(kind==='enemy'||kind==='practice')return perform('ability:arc');
  if(kind==='corpse')return act({type:'reclaimCorpse'});
  if(kind==='healer')return showSpiritHealer();
  if(['evidence','recover','revive'].includes(kind)){const run=simulation.dungeon.run;return act({type:'dungeon',operation:kind==='evidence'?'interact':kind,run:run.id,chapter:run.chapter,attempt:run.attempt,target:object.id});}
  if(kind==='incident')return act({type:'worldEvent',id:object.event,cycle:object.cycle,site:object.id});
  if(kind==='npc')return talk(object);
  if(kind==='resident')return talkResident(object);
  act({type:kind==='lift'?'lift':'interact',id:object.id});
  if(object.evidence)panel(object.name,`<div class="npc-quote">${esc(object.evidence)}</div><p class="panel-description">Return to the person who gave you this quest. Press J and open Story to review completed quests.</p><button class="small-button" data-do="journal-filter" data-id="story">OPEN STORY ↗</button>`,'THE LIVING RECORD / FIELD EVIDENCE','street-record');
}

function showDungeons(){
  if(!simulation)return;
  panel('Dungeons and groups',dungeonPanel(data,simulation.character,simulation.dungeon,simulation.time),'DUNGEONS / GROUP FINDER','dungeons');
  dungeonPanelKey=dungeonKey();
}
function dungeonKey(){
  const state=simulation?.dungeon,run=state?.run;
  return JSON.stringify(run?{...run,members:run.members.map(m=>({id:m.id,name:m.name,down:m.health<=0})),recoveryReady:0,nextPulse:0,pulse:0}:state);
}

function showWorld(){
  panel('Vesper and the Pale Basin.',`<p class="dialog-intro">${esc(data.lore.setting.premise)}</p><div class="card-grid">${data.world.districts.map((d,i)=>`<article class="info-card"><span class="tag">SECTOR 0${i+1} / LEVEL ${d.minLevel}+</span><h3 style="color:${d.color}">${esc(d.name)}</h3><p>${esc(d.subtitle)}</p></article>`).join('')}</div><h3>Outside the city</h3><div class="card-grid">${data.world.biomes.map(b=>`<article class="info-card"><span class="tag">${esc(b.kind.toUpperCase())} / LEVEL ${b.minLevel}+</span><h3 style="color:${b.color}">${esc(b.name)}</h3><p class="quote">${esc(b.subtitle)}</p><p>${esc(b.description)}</p><small>Contact: ${esc(data.npcs.find(n=>n.biome===b.id).name)} · 3 quests from level ${data.quests.find(q=>q.biome===b.id).level}</small></article>`).join('')}</div><p class="panel-description">Explore Vesper on foot, then follow the roads into the Pale Basin outside the city. Its twelve quests are open to every character. Find quest contacts on the map and their quests in the journal’s Basin tab.</p><div class="settings-actions"><button class="button primary" data-do="enter">PLAY ↗</button><button class="small-button" data-do="lineages">CHARACTER TYPES ↗</button></div>`,'WELCOME TO THE AFTERLIGHT','world');
}
function showFactions(){
  panel('Choose a faction.',`<p class="dialog-intro">A faction is the group you join. Each group gives you a different story and set of quests. All factions can use the same abilities and talents.</p><div class="card-grid">${data.factions.map(f=>`<article class="info-card"><span style="color:${f.color}">${icon(f.id)}</span><h3>${esc(f.name)}</h3><p class="quote">“${esc(f.motto)}”</p><p>${esc(f.description)}</p><p class="tag">31 QUESTS · LEVEL 0–60</p></article>`).join('')}</div><p class="panel-description">You get quests from both your faction contact and Oru, who handles your character type’s story. You can choose talents from all six groups.</p>`,'FOUR FACTIONS','factions');
}
function showLineages(){
  panel('Choose a character type.',`<p class="dialog-intro">Your character type gives you a bonus that is always active and a series of quests from Oru. Choose the type you like. Every type can join any faction and use every ability.</p><div class="card-grid">${data.races.map(r=>`<article class="info-card"><span style="color:${r.color}">${icon(r.id)}</span><h3>${esc(r.name)}</h3><p class="quote">${esc(r.tagline)}</p><p>${esc(r.lore)}</p><p class="tag">${esc(r.passive.name.toUpperCase())} / ${esc(r.passive.description)}</p><p class="tag">13 QUESTS · LEVEL 0–60</p></article>`).join('')}</div>`,'CHARACTER TYPES / BACKGROUNDS','lineages');
}
function showGuide(){
  const controls=[['Move','W A S D'],['Look around','HOLD RIGHT MOUSE + DRAG'],['Select a person, enemy, or object','CLICK / TAP'],['Use the selected target','E / RIGHT CLICK'],['Select the next target','TAB'],['Jump','SPACE'],['Sprint','SHIFT'],['Dash forward','Q'],['Use abilities','1–0'],['Create a Ghostline ghost','R'],['Use a medkit','H'],['Quests / talents','J / T'],['Gear / map','I / M'],['Dungeons / find a group','G'],['Social / guild','C / U'],['Chat with nearby players','ENTER'],['Wave and other gestures','B'],['Clear target, then open menu','ESC'],['Switch camera view','V']];
  panel('How to play.',`<article class="info-card"><h3>Start here</h3><ol><li>New characters start in the First Steps Courtyard. Follow the tutorial markers to move, use a terminal, and shoot a harmless practice target. Use the Commons gate when ready, or use it early to skip training.</li><li>Follow the quest marker to your faction contact. Click them, then press E to talk.</li><li>Choose ACCEPT QUEST. The instructions on the right tell you what to do next.</li><li>Talk to Oru for your second quest. Follow the markers to help restore the kitchen water.</li><li>When the steps are done, return to the person who gave you the quest. Read the choices, then choose an ending to earn XP and gold.</li></ol><p>Lost? Press J and open Story for your next step. Press M for the map. You can complete the main story alone.</p></article><h3>Keyboard and mouse</h3><div class="guide-grid">${controls.map(([a,b])=>`<div class="guide-row"><span>${a}</span><kbd>${b}</kbd></div>`).join('')}</div><p class="guide-note">Select something before using it. E talks to a person, attacks an enemy, reads a record, or uses a lift. Move closer if it is out of reach. Click empty space or press Esc to clear your selection.</p><details class="info-card"><summary>Controller controls</summary><p>Left stick: move. Right stick: look. A: jump. B: dash. Y: select the next target. X: use the target. RT: shoot. LB: stun shot. RB: heal. LT: shield.</p><p>D-pad up: medkit. D-pad down: map. D-pad left/right: unlocked attacks. Hold the left stick button and press D-pad up/right/down/left for Weaken, Drain health, Finishing shot, and Weaken area. Press the right stick (R3) for Ghostline. View: quests. Menu: settings. In menus, use the D-pad and A; B closes the menu.</p></details><details class="info-card"><summary>Touch controls</summary><p>Move with the pad on the left. Drag the world to look around. Tap a person, enemy, or object to select it, or tap TARGET to select the next one. Tap USE to act on it. Tap an ability at the bottom to use it. Tap CHAT to talk to players.</p></details><div class="card-grid"><article class="info-card"><h3>Fighting and healing</h3><p>Click an enemy, then press 1 to shoot. Press 2 to damage and stun it, 3 to heal yourself and nearby players, or 4 to protect yourself with a shield. H uses a medkit; buy more from Patch.</p><p>Health keeps you alive. Energy powers abilities and refills over time. A countdown on an ability shows how many seconds until you can use it again. Attacks can miss; critical hits deal extra damage. Move out of marked danger areas before they strike.</p><h3>Quests, levels, and talents</h3><p>Quests are jobs. Finish them and defeat enemies to earn experience, called XP. Fill the XP bar to gain a level. Gold buys supplies and upgrades.</p><p>Talents are permanent bonuses you choose with points. Start with six points and earn one more every quarter of a level. Press T to spend them. You can mix all six groups. Each talent lists what you must learn first. Visit Patch to pay for a reset and spend your points again.</p></article><article class="info-card"><h3>Street emergencies</h3><p>Follow the emergency tracker. Select and use both marked controls. Defeat any enemy machines, then stay inside the marked ring until the timer fills. Avoid striped danger areas. Other players can help. If you fail, wait nearby and try again; completed quest steps stay saved.</p><h3>Your choices matter</h3><p>Each quest ends with a permanent choice. Read who benefits, who loses out, and how much gold you receive. Every choice gives the full quest XP. Press J and open Reputation &amp; Choices to see how people feel about you.</p><h3>Playing with others</h3><p>Press Enter to chat. Nearby reaches players within 35 m. Zone reaches players in your area and copy of the world, or just your group inside a dungeon. Press B to wave. Press C for private messages, player groups, guilds, and trading. A party is a group of players; a guild is a lasting player club.</p></article></div><details class="info-card ghostline-guide"><summary>Ghostline: make a ghost that blasts enemies</summary><ol><li>Move at least 12 m over at least 2 seconds.</li><li>Press R (controller: R3; touch: GHOST). A blue ghost repeats up to 6 seconds of your recent movement.</li><li>Touch the moving ghost after its first 0.6 seconds. It blasts visible enemies within 10 m, restores 20 energy, and makes your dash ready.</li></ol><p>If another player touches your ghost first, the blast has 50% more power and both of you get the energy and dash refill. Ghostline costs 30 energy and takes 18 seconds to recharge. You do not need to select an enemy.</p></details><details class="info-card"><summary>Combining attacks</summary><p>Weaken makes an enemy take 20% more damage for 8 seconds. Area blast uses the weakening damage bonus, then ends that effect. Power shot deals 35% extra damage to stunned enemies and ends their stun. Finishing shot deals 60% extra damage to enemies at 30% health or less. Drain health heals you for 40% of the damage it deals.</p><p>Armor reduces damage taken. Armor penetration ignores some enemy armor. Damage returned as health heals you when you attack. Combo bonuses increase the extra damage from attack combinations. A percentage point adds directly to a chance: +3 points changes a 5% critical-hit chance to 8%.</p></details><details class="info-card"><summary>What happens when you die?</summary><p>Outside dungeons, you lose 5% of your gold, rounded up to a maximum of 50. After five seconds, choose BECOME A GHOST. Follow the marker back to your body and get within 12 m with nothing blocking your view. Choose RETURN TO LIFE to recover at 50% health and energy, with no extra cost.</p><p>The graveyard healer offers a shortcut. It costs another 10% of your remaining gold, rounded up to a maximum of 100. You return at 25% health and energy. For 60 seconds while alive and playing, you deal half damage and move 25% slower. As a ghost, you are safe from damage and can use lifts. Esc opens recovery options.</p><p>In a dungeon, another player can revive you. If everyone dies, the current chapter restarts after five seconds.</p></details><p class="guide-note">VOICES turns spoken dialogue on or off. Written dialogue stays visible. Use Settings → TEST VOICE to check speech playback. Some browser voices need an internet connection.</p>`,'HELP / CONTROLS','guide');
}
function questObjective(q){return objectiveText(questView(q,simulation.character).step,data);}
function questCard(q,c,atNpc=false){
  const view=questView(q,c),{accepted,ready}=view,done=c.completed.includes(q.id),available=availableQuest(q,c);
  const thread=questThread(q,data);
  const steps=view.staged?`<ol class="quest-steps">${q.steps.map((s,i)=>`<li class="${done||ready||accepted&&i<view.index?'complete':accepted&&i===view.index?'current':''}">${esc(s.text)}${s.type==='hold'?` · ${s.count}s`:''}${accepted&&!ready&&i===view.index?` <strong>${view.progress}/${s.count}${s.type==='hold'?'s':''}</strong>`:''}</li>`).join('')}</ol>`:'';
  const rewardXp=done?q.reward.xp:founderXpReward(c,q.reward.xp,data.rules).xp,biome=data.world.biomes.find(b=>b.id===q.biome);
  return `<article class="quest-row ${!accepted&&!available&&!done?'locked':''}"><span class="quest-level">LV ${q.level}${done?' / COMPLETE':''}</span><h3>${esc(q.title)}</h3>${biome?`<small class="muted">${esc(biome.name)} · ${esc(data.npcs.find(n=>n.id===q.giver).name)}</small>`:""}<p>${esc(done?decisionOutcome(q,c,data):q.briefing)}</p><details class="quest-thread" data-story-section="quest:${q.id}"><summary tabindex="0">STORY CONNECTION · ${esc(thread.title)}</summary><p>${esc(thread.question)}</p></details>${steps||`<div class="quest-objective">${esc(questObjective(q))}${accepted?` · ${view.progress}/${view.step.count}`:''}</div>`}<div class="quest-meta"><span>+${rewardXp} XP${rewardXp>q.reward.xp?' · HALO BONUS INCLUDED':''}</span><span>${q.reward.gold} BASE GOLD · YOUR CHOICE CHANGES THE PAYMENT</span></div><button class="small-button" data-do="quest-voice" data-id="${q.id}">HEAR ${done?'ENDING':'QUEST DETAILS'} ♫</button>${decisionPanel(q,c,data,atNpc&&ready)}${atNpc&&available?`<button class="small-button" data-do="quest-accept" data-id="${q.id}">ACCEPT QUEST ↗</button>`:accepted?`<small class="muted">${ready?'Return to '+esc(data.npcs.find(n=>n.id===q.giver)?.name):'Quest in progress'}</small>`:!done?`<small class="muted">${available?'Available from '+esc(data.npcs.find(n=>n.id===q.giver)?.name):'Requires level '+q.level+(q.requires.length?' and completion of '+q.requires.map(id=>esc(data.quests.find(prior=>prior.id===id)?.title||id)).join(', '):'')+'.'}</small>`:''}</article>`;
}
function showJournal(filter=journalFilter){
  if(!simulation)return;journalFilter=filter;const c=simulation.character;
  const applicable=data.quests.filter(q=>(!q.faction||q.faction===c.faction)&&(!q.race||q.race===c.race));
  const guide=openingGuide(c,data,simulation.worldEvents),lesson=guide?.social;
  const training=guide?.tutorial?`<article class="info-card"><small>TUTORIAL · ${guide.view.index+1}/${guide.view.total}</small><h3>${esc(guide.chapter)}</h3><p>${esc(guide.instruction)}</p><p>${esc(guide.hint)}</p><button class="small-button" data-do="map-region" data-id="city">LOCATE ON MAP ↗</button></article>`:'';
  const social=lesson?`<article class="info-card"><small>MEET YOUR NEIGHBORS · OPTIONAL</small><p>${esc(lesson.hint)}</p><button class="small-button" data-do="social-lesson">${esc(lesson.label)}</button></article>`:'';
  let list=filter==='active'?applicable.filter(q=>c.activeQuests[q.id]!==undefined):filter==='available'?applicable.filter(q=>availableQuest(q,c)):filter==='history'?applicable.filter(q=>c.completed.includes(q.id)):filter==='basin'?applicable.filter(q=>q.biome):applicable.filter(q=>!q.biome&&!q.neighborhood);
  panel(filter==='story'?data.lore.campaign.title:'Quest journal.',`${training}${social}<div class="tabs">${[['story','STORY'],['morality','REPUTATION & CHOICES'],['active','ACTIVE'],['available','AVAILABLE'],['campaign','MAIN QUESTS'],['neighborhoods','NEIGHBORHOODS'],['basin','BASIN'],['history','COMPLETED']].map(([id,name])=>`<button class="${id===filter?'selected':''}" data-do="journal-filter" data-id="${id}" aria-current="${id===filter?'page':'false'}">${name}</button>`).join('')}</div>${filter==='story'?campaignPanel(c,data,simulation.worldEvents):filter==='morality'?moralStandingPanel(c,data):filter==='neighborhoods'?neighborhoodJournal():list.length?list.map(q=>questCard(q,c)).join(''):'<p class="muted">No quests here yet. Open Story to see what to do next, or visit a local quest contact.</p>'}<p class="panel-description">Quests are jobs that earn experience (XP) and gold. Accept a quest from its contact, follow the steps, then return to that person and choose an ending to collect your reward. Map markers show where to go. Local and Basin quests are open to all characters who meet the level requirement.</p>`,'QUEST JOURNAL / '+c.completed.length+' COMPLETE','journal');
}
function neighborhoodJournal(){
  const c=simulation.character;
  return `<p class="panel-description">Each neighborhood has three quests. Select a resident and press E to talk. Visit the named quest contact to accept work. Completed quests change what residents do and say when you return.</p>${data.citylife.neighborhoods.map(n=>{
    const stage=cityStage(n,c.completed),contact=data.npcs.find(p=>p.id===n.contact),quests=data.quests.filter(q=>q.neighborhood===n.id),next=quests.find(q=>!c.completed.includes(q.id))||quests.at(-1),incident=simulation.worldEvents.find(e=>e.neighborhood===n.id&&e.phase!=='idle'),event=incident?{name:incident.name,detail:incidentStatus(incident,data.events.rules,simulation.time)}:cityEvent(n,worldClock.now());
    return `<details class="neighborhood-entry" data-story-section="neighborhood:${n.id}" style="--neighborhood-color:${n.color}" ${world.district(c.position).id===n.id?'open':''}><summary tabindex="0">${esc(n.name)} <small>${n.stages.indexOf(stage)}/3 · ${esc(neighborhoodOutcome(n.id,c,data)?'Choice saved':stage.status)}</small></summary><p>${esc(n.premise)}</p>${neighborhoodOutcome(n.id,c,data)?`<p class="npc-quote">${esc(neighborhoodOutcome(n.id,c,data))}</p>`:''}<p class="neighborhood-now">ON THE STREET · ${esc(event.name)}<br><span ${incident?`data-incident-status="${incident.id}"`:""}>${esc(event.detail)}</span></p><p class="muted">${esc(contact.name)} · ${Math.round(distance(c.position,contact.position))} m · ${contact.position[1]?'24 m skyway · use the Night crew ramp or Transit lift':'Street level'}</p>${questCard(next,c)}<button class="small-button" data-do="map-region" data-id="city">LOCATE ON CITY MAP ↗</button></details>`;
  }).join('')}`;
}
function npcDialogue(npc){
  return storyDialogue(npc,simulation.character,data);
}
function talk(npc,narrate=true){
  if(npc.id==='merchant')return showShop();const c=simulation.character;
  const quests=data.quests.filter(q=>q.giver===npc.id&&((c.activeQuests[q.id]!==undefined)||availableQuest(q,c)));
  const dialogue=npcDialogue(npc);
  panel(npc.name,`<div class="npc-quote">“${esc(dialogue)}”</div>${quests.length?quests.map(q=>questCard(q,c,true)).join(''):npc.neighborhood?'<p class="muted">The neighborhood journal records your work here. Take a walk through the block and talk to the people keeping it going.</p>':'<p class="muted">I have no new work for you yet. Your journal shows the level and previous quest you need.</p>'}<button class="small-button" data-do="speak" data-id="${npc.id}">HEAR ${esc(npc.name.toUpperCase())} ♫</button>`,npc.title.toUpperCase(),'npc:'+npc.id);
  if(narrate)audio.speak(dialogue,npc.id);
}
function talkResident(actor){
  const conversation=cityLife.conversation(actor,worldClock.now()),n=conversation.neighborhood;
  if(actor.activity==='flee'){toast(`${actor.name}: ${actor.line}`);return;}
  const contact=n&&data.npcs.find(p=>p.id===n.contact);
  panel(actor.name,`<p class="neighborhood-now">${esc(conversation.role)} · ${esc(actor.title)} · ${esc(conversation.treatment.label)}</p><div class="npc-quote">“${esc(conversation.personal)}”</div>${conversation.building?`<h3>${esc(conversation.building.name)}</h3><p>${esc(conversation.building.history)}</p>`:''}${n?`<h3>Life in ${esc(n.name)}</h3><p>“${esc(conversation.stage.line)}”</p><p class="muted">${esc(conversation.event.name)} · ${esc(conversation.event.detail)}</p><p>Talk to ${esc(contact.name)} about the work here. ${Math.round(distance(simulation.character.position,contact.position))} m${contact.position[1]?' · on the 24 m skyway':''}.</p><button class="small-button" data-do="journal-filter" data-id="neighborhoods">NEIGHBORHOOD JOURNAL ↗</button>`:''}`,n?.name.toUpperCase()||'VESPER / NEIGHBORS','resident:'+actor.id);
  audio.speak(conversation.personal);
}
function showTalents(){
  const c=simulation.character;
  panel('Choose your talents.',economyRetry()+talentPanel(c,data,talentBranch,nearPatch(data,c))+classPanel(c,data),'TALENTS / SIX GROUPS','talents');
}
function economyRetry(){return community.pending?'<p role="status">The server has not confirmed your last action. Retry to check it without paying twice.</p><button class="small-button" data-do="retry-economy">RETRY PENDING ACTION</button>':'';}
function showCrafting(){panel('Patch’s workbench.',economyRetry()+craftingPanel(simulation.character,data,catalogQueries.crafting),'ECONOMY / CRAFTING','crafting');}
function showOrders(){panel('Patch’s work orders.',workOrdersPanel(simulation.character,data),'REPEATABLE JOBS / GOLD & XP','orders');}
function showBestiary(){panel('Enemies and loot.',bestiaryPanel(simulation.character,data,bestiaryQuery)+modularDropsPanel(data,bestiaryQuery),'ENEMIES / POSSIBLE REWARDS','bestiary');}
function showInventory(){
  const c=simulation.character,s=simulation.playerStats;
  panel('Equipment and supplies.',`${economyRetry()}${economyTabs('inventory')}<div class="inventory-summary"><div><strong>${c.gold}</strong><small>GOLD</small></div><div><strong>${c.medkits}</strong><small>MEDKITS / ${data.rules.inventory.slots}</small></div><div><strong>${c.weaponRank}</strong><small>WEAPON UPGRADES</small></div></div>${founderGear(c)}<div class="info-card" style="margin-top:20px"><span class="tag">CHARACTER TYPE BONUS</span><h3>${esc(data.races.find(r=>r.id===c.race).passive.name)}</h3><p>${esc(data.races.find(r=>r.id===c.race).passive.description)}</p></div><div class="guide-grid" style="margin-top:20px">${[['Health',s.health],['Energy',s.energy],['Chance of a critical hit',s.crit+'%'],['Ability damage',Math.round(s.damage*100)+'%'],['Weapon bonus','+'+(c.weaponRank*data.rules.inventory.weaponUpgradeDamage)],['Movement speed',Math.round(s.speed*100)+'%'],...['armor','haste','efficiency','penetration','leech','combo','goldFind'].map(k=>[statNames[k],Math.round(s[k]*100)+'%'+(statCaps[k]?' / '+Math.round(statCaps[k]*100)+'% cap':'')])].map(([k,v])=>`<div class="guide-row"><span>${k}</span><strong>${v}</strong></div>`).join('')}</div><p class="panel-description">Visit Patch in Afterlight Commons to buy medkits, upgrade your weapon, make equipment, or reset your talents. Medkits restore ${data.rules.inventory.medkitHeal} health. Wait ${data.rules.inventory.medkitCooldown} seconds between uses.</p><button class="small-button" data-do="use-medkit">USE MEDKIT [H]</button>${inventoryPanel(c,data,catalogQueries.inventory)}`,'EQUIPMENT / INVENTORY','inventory');
}
function showShop(){
  const c=simulation.character;
  panel('Patch’s shop.',`<p class="npc-quote">“${esc(vendorPercent(c)<100?'The block speaks well of you. I can give you the neighbor rate.':vendorPercent(c)>100?'Your choices have hurt people here. I still sell supplies, but you will pay more.':data.npcs.find(n=>n.id==='merchant').dialogue)}”</p><p class="quest-meta">YOUR BALANCE · ${c.gold} gold · ${vendorPercent(c)}% OF NORMAL PRICES (rounded up)</p><div class="card-grid"><article class="info-card"><span style="color:var(--green)">${icon('medkit')}</span><h3>Medkit</h3><p>Restore ${data.rules.inventory.medkitHeal} health. Carry up to ${data.rules.inventory.slots}.</p><button class="small-button" data-do="buy" data-id="medkit">BUY / ${moralPrice(c,data.rules.inventory.medkitPrice)} gold</button></article><article class="info-card"><span style="color:var(--cyan)">${icon('bolt')}</span><h3>Weapon upgrade</h3><p>Permanent +${data.rules.inventory.weaponUpgradeDamage} damage. Upgrades bought: ${c.weaponRank} of ${data.rules.inventory.maxWeaponRank}.</p><button class="small-button" data-do="buy" data-id="upgrade">UPGRADE / ${moralPrice(c,data.rules.inventory.weaponUpgradePrice*(c.weaponRank+1))} gold</button></article></div><div class="settings-actions"><button class="small-button" data-do="crafting">CRAFTING WORKBENCH</button><button class="small-button" data-do="talents">TALENTS / RESET POINTS</button><button class="small-button" data-do="orders">WORK ORDERS / EARN GOLD</button><button class="small-button" data-do="inventory">SELL INVENTORY ITEMS</button></div>`,'SHOP / AFTERLIGHT COMMONS','shop');
}
function showMap(region=mapRegion){
  mapRegion=region;
  panel('World map.',`<div class="tabs">${[['city','CITY / NEIGHBORHOODS'],['basin','PALE BASIN']].map(([id,name])=>`<button class="${mapRegion===id?'selected':''}" data-do="map-region" data-id="${id}">${name}</button>`).join('')}</div><canvas id="full-map" class="map-view" width="900" height="720" aria-label="Map of Vesper with local quest contacts, objectives, lifts, stairs, ramps, and hills"></canvas><div class="map-legend"><span><i></i> YOU</span><span><i style="background:#e8c983"></i> OBJECTIVES</span><span><i style="background:#7dbfc0"></i> LIFTS</span><span><i style="background:#efb778"></i> QUEST CONTACTS</span><span><i style="background:#ddb27c"></i> STAIRS / RAMPS / HILLS</span></div><p class="panel-description">Quest contacts appear even in places you have not visited. Press J and choose Neighborhoods to see their quests. Last Connection is on a walkway 24 m above the street; use the Night crew ramp or Transit lift. Green door markers show buildings you can enter. Yellow lines show stairs, ramps, and hills. The Pale Basin tab shows the land outside the city.</p>`,'WORLD MAP / '+(mapRegion==='city'?'VESPER':'PALE BASIN'),'map');
  drawMap($('#full-map'),true);
}
function showSettings(){
  panel('Settings.',`<div class="setting-row"><label for="setting-music">Sound & music<small>Turn background music and game sounds on or off.</small></label><input id="setting-music" type="checkbox" ${audio.enabled?'checked':''}></div><div class="setting-row"><label for="setting-voice">Character voices<small id="voice-status" role="status">${esc(audio.voiceMessage)}</small><small>Local English voices are preferred; other browser voices may use an online speech service. No microphone is needed.</small></label><input id="setting-voice" type="checkbox" ${audio.narration?'checked':''}></div><div class="settings-actions"><button class="small-button" data-do="test-voice">TEST VOICE ♫</button></div><div class="setting-row"><label for="setting-quality">Graphics quality<small>Choose Low if the game looks choppy or runs slowly.</small></label><select id="setting-quality"><option value="1" ${renderer.quality===1?'selected':''}>High</option><option value="0.75" ${renderer.quality===.75?'selected':''}>Balanced</option><option value="0.5" ${renderer.quality===.5?'selected':''}>Low</option></select></div><div class="setting-row"><label for="setting-volume">Light beams<small>Show beams of sunlight and lamplight. Low graphics quality hides the lamp beams.</small></label><input id="setting-volume" type="checkbox" ${renderer.volumetric?'checked':''}></div><div class="setting-row"><label for="setting-sensitivity">Camera turn speed</label><input type="range" id="setting-sensitivity" min="0.001" max="0.006" step="0.0005" value="${input.sensitivity}"></div><div class="setting-row"><label for="setting-camera">View your character from behind<small>Turn off to see through your character’s eyes. Press V to switch.</small></label><input id="setting-camera" type="checkbox" ${thirdPerson?'checked':''}></div><div class="settings-actions"><button class="small-button" data-do="guide">CONTROLS</button><button class="small-button" data-do="intro">REPLAY INTRO</button><button class="small-button" data-do="export">DOWNLOAD CHARACTER FILE</button><button class="small-button" data-do="chat">NEARBY & ZONE CHAT</button><button class="small-button" data-do="gestures">GESTURES</button><button class="small-button" data-do="community">COMMUNITY</button><button class="small-button" data-do="dungeons">DUNGEONS / GROUP FINDER</button><button class="small-button" data-do="leave">RETURN TO TITLE</button></div><p class="panel-description">Progress saved online · ${input.connected?'Standard controller connected.':'Keyboard, mouse, touch, and standard controllers supported.'} Sloperberpunk is GPL-3.0-or-later. There is no warranty. <a href="/LICENSE" target="_blank" rel="noopener">Read the license ↗</a></p>`,'OPTIONS','settings');
  updateVoiceButton();
}
async function showAccount(mode='login'){
  await sessionReady;
  if(account)return enter();
  refreshFounderOffer();
  panel(mode==='register'?'Create an account.':'Sign in.',`<div class="tabs"><button class="${mode==='login'?'selected':''}" data-do="account-login">SIGN IN</button><button class="${mode==='register'?'selected':''}" data-do="account-register">CREATE ACCOUNT</button></div>${mode==='register'?`<p class="founder-account-note"><strong>First Signal Halo · first 1,000 accounts.</strong><br>Exclusive permanent cosmetic. +5% combat &amp; quest XP from level 1 until level 10.<br><span data-founder-status>${esc(founderOfferView(founderOffer,account).status)}</span></p>`:''}<form id="account-form" data-mode="${mode}"><div class="form-row"><label for="username">USERNAME</label><input id="username" name="username" autocomplete="username" minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+" required placeholder="Your username"></div><div class="form-row"><label for="password">PASSWORD / 12–128 CHARACTERS</label><input id="password" name="password" type="password" autocomplete="${mode==='register'?'new-password':'current-password'}" minlength="12" maxlength="128" required></div><div id="account-error" class="form-error" role="alert"></div><button type="submit" class="button primary">${mode==='register'?'CREATE ACCOUNT':'SIGN IN'} ↗</button></form><p class="form-note">Your characters and progress are saved on the server. Sign in to play from any device.</p>`,'YOUR ACCOUNT', 'account');
}

function refreshPanel(){
  if(dialogPage.startsWith('npc:'))talk(data.npcs.find(n=>n.id===dialogPage.split(':')[1]));
  else if(dialogPage==='talents')showTalents();else if(dialogPage==='shop')showShop();else if(dialogPage==='orders')showOrders();else if(dialogPage==='inventory')showInventory();else if(dialogPage==='crafting')showCrafting();
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
  $('#repeat-guidance').onclick=()=>{if(currentGuide)replayVoice(currentGuide.line,currentGuide.speaker);};
  $('#story-social-action').onclick=()=>{const lesson=currentGuide?.social;if(lesson)liveChat.open(lesson.channel,lesson.id==='gesture');};
  $('#voice-toggle').onclick=()=>{audio.narration=!audio.narration;if(audio.narration&&currentGuide)replayVoice(currentGuide.line,currentGuide.speaker);updateVoiceButton();};
  $('#interaction').onclick=()=>perform('interact');
  $('#character-form').addEventListener('change',()=>{selectedRace=$('input[name="race"]:checked').value;selectedFaction=$('input[name="faction"]:checked').value;updateChoices();});
  $('#character-form').addEventListener('submit',async e=>{
    e.preventDefault();audio.unlock().catch(()=>{});const button=e.submitter;button.disabled=true;$('#character-error').textContent='';
    try{const name=$('#character-name').value.trim();const c=(await api('/characters',{name,race:selectedRace,faction:selectedFaction})).character;await startGame(c,true);}
    catch(error){$('#character-error').textContent=error.message;$('#character-name').focus();}finally{button.disabled=false;}
  });
  $('#dialog-content').addEventListener('submit',e=>{
    const view=e.target.dataset.economyForm;if(!view)return;e.preventDefault();const query=Object.fromEntries(new FormData(e.target));if(view==='bestiary'){bestiaryQuery=query;showBestiary();}else if(view in catalogQueries){catalogQueries[view]=query;view==='inventory'?showInventory():showCrafting();}
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
      else if(action==='quest-accept'||action==='quest-complete'){act({type:'quest',id,operation:action==='quest-accept'?'accept':'complete',...(action==='quest-complete'?{choice:button.dataset.choice}:{})});}
      else if(action==='moral-gear'){act({type:'moralGear',id});}
      else if(action==='learn-talent'){act({type:'talent',id});setTimeout(refreshPanel,250);}
      else if(action==='talent-branch'){talentBranch=id;showTalents();}
      else if(action==='talents')showTalents();
      else if(action==='orders')showOrders();
      else if(action==='work-order'){act({type:'workOrder',id,operation:button.dataset.operation});setTimeout(refreshPanel,250);}
      else if(action==='catalog-page'){const view=button.dataset.view;if(view in catalogQueries){catalogQueries[view].page=Number(id);view==='inventory'?showInventory():showCrafting();}else if(view==='bestiary'){bestiaryQuery.page=Number(id);showBestiary();}}
      else if(action==='inventory')showInventory();
      else if(action==='crafting')showCrafting();
      else if(action==='bestiary')showBestiary();
      else if(action==='auctions')await community.open('auctions');
      else if(action==='retry-economy'&&community.pending){try{await community.mutate(community.pending,false);}finally{refreshPanel();}}
      else if(['equip','unequip','consume','craft','sell','salvage','respec'].includes(action)){
        button.disabled=true;
        try{await community.mutate({action,...(action==='unequip'?{slot:id}:{item:id}),...(action==='sell'?{quantity:1}:{})},false);}
        finally{button.disabled=false;refreshPanel();}
      }
      else if(action==='buy'){act({type:'buy',item:id});setTimeout(refreshPanel,250);}
      else if(action==='use-medkit'){act({type:'medkit'});setTimeout(showInventory,250);}
      else if(action==='speak')replayVoice(npcDialogue(data.npcs.find(n=>n.id===id)),id);
      else if(action==='test-voice')replayVoice('Welcome to Vesper. Character voices are ready.');
      else if(action==='quest-voice'){const q=data.quests.find(q=>q.id===id);if(q)replayVoice(simulation.character.completed.includes(id)?decisionOutcome(q,simulation.character,data):q.briefing,q.giver);}
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
      else if(action==='chat'||action==='gestures')perform(action);
      else if(action==='social-lesson'){const lesson=openingGuide(simulation.character,data,simulation.worldEvents)?.social;if(lesson){closePanel();liveChat.open(lesson.channel,lesson.id==='gesture');}}
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
    if(t.id==='setting-voice'){audio.narration=t.checked;if(t.checked)replayVoice('Character voices are ready.');updateVoiceButton();}
    if(t.id==='setting-quality')renderer.quality=Number(t.value);
    if(t.id==='setting-volume')renderer.volumetric=t.checked;
    if(t.id==='setting-sensitivity')input.sensitivity=Number(t.value);
    if(t.id==='setting-camera')thirdPerson=t.checked;
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden){if(connection)connection.send({type:'move',forward:0,strafe:0,yaw,jump:false,dash:false,sprint:false,sequence:++connection.sequence});}});
  window.addEventListener('graphicslost',()=>{input.clear();toast('The game lost access to your device’s graphics. It will reload when graphics are available again.');});
}
function updateMusicButton(){$('#music-button').innerHTML=`<span>♫</span> SOUND ${audio.enabled?'ON':'OFF'}`;$('#music-button').setAttribute('aria-pressed',String(audio.enabled));}

function replayVoice(text,speaker='narrator'){
  audio.narration=true;audio.unlock().catch(()=>{});
  if(!audio.speak(text,speaker))toast(audio.voiceMessage);
  const setting=$('#setting-voice');if(setting)setting.checked=true;
  updateVoiceButton();
}
function updateVoiceButton(){
  $('#voice-toggle').textContent=`VOICES ${audio.narration?'ON':'OFF'}`;
  $('#voice-toggle').setAttribute('aria-pressed',String(audio.narration));
  $('#voice-toggle').title=audio.voiceMessage;
  const status=$('#voice-status');if(status)status.textContent=audio.voiceMessage;
}
function updateStoryGuide(){
  const c=simulation.character;
  currentGuide=c.health>0&&!simulation.inDungeon?openingGuide(c,data,simulation.worldEvents):null;
  const campaign=campaignLead(c,data,simulation.worldEvents);
  $('#campaign-chapter').textContent=currentGuide?.tutorial?`TUTORIAL · ${currentGuide.view.index+1}/${currentGuide.view.total}`:`MAIN STORY · ${campaign.complete?'COMPLETE':`${campaign.index+1}/5`}`;
  $('#campaign-lead').hidden=Boolean(currentGuide);
  $('#campaign-lead').textContent=campaign.instruction;
  $('#story-guide').hidden=!currentGuide;
  $('#tracked-quests').hidden=Boolean(currentGuide);
  if(!currentGuide)return;
  const g=currentGuide,d=g.destination;
  $('#story-chapter').textContent=(g.chapter||g.quest?.story?.chapter||'Your first quests')+(g.view.accepted&&!g.view.ready?` · ${g.view.index+1}/${g.view.total}`:'');
  const instruction=g.instruction+(g.view.step.type==='hold'&&g.view.accepted&&!g.view.ready?` (${g.view.progress}/${g.view.step.count}s)`:'');
  if($('#story-instruction').textContent!==instruction)$('#story-instruction').textContent=instruction;
  $('#story-direction').textContent=d?`${bearing(c.position,d.position,yaw)} ${Math.ceil(distance(c.position,d.position))} m · ${d.name}${Math.abs(d.position[1]-c.position[1])>5?' · follow the marked stairs, ramps, or lifts':''}`:'';
  $('#story-hint').textContent=g.hint;
  $('#story-social').hidden=!g.social;
  if(g.social){$('#story-social-hint').textContent=g.social.hint;$('#story-social-action').textContent=g.social.label;}
  if(state==='playing'&&g.key!==storyCue&&!$('#panel-dialog').open&&!audio.speaking){storyCue=g.key;audio.speak(g.line,g.speaker);}
}
function showSpiritHealer(){
  const view=recoveryView(simulation.character,data,world,worldClock.now());
  if(!view?.atHealer)return;
  const r=data.rules.death;
  panel('Revive here for gold?',`<div class="npc-quote">“I can bring you back to life here for a fee. You will be weak for a minute. Walking back to your body costs no extra gold.”</div><p>Return to life here for <strong>${view.healerCost} gold</strong> (${r.healerLossFraction*100}% of your remaining gold, capped at ${r.healerLossCap} gold). Return with ${r.healerHealthFraction*100}% health and energy.</p><p><strong>Weakened for ${r.sicknessSeconds} seconds while alive and playing.</strong> Damage is reduced by ${(1-r.sicknessDamageMultiplier)*100}% and movement by ${(1-r.sicknessSpeedMultiplier)*100}%. Leaving the game pauses this timer.</p><p class="muted">Recovering your body instead restores ${r.corpseHealthFraction*100}% health and energy, with no additional gold cost or sickness.</p><div class="settings-actions"><button class="button primary" data-do="healer-confirm">REVIVE HERE / ${view.healerCost} gold</button><button class="small-button" data-do="close-panel">KEEP LOOKING FOR MY BODY</button></div>`,'HEALER / '+view.graveyard.name.toUpperCase(),'spirit-healer');
  audio.speak('I can bring you back to life here for a fee. You will be weak for a minute. Walking back to your body costs no extra gold.','keeper');
}
function showRecoveryMenu(){
  const view=recoveryView(simulation.character,data,world,worldClock.now());
  if(!view?.spirit)return;
  panel('Return to life.',`<p>Your body is ${view.distance} m away. Return within ${data.rules.death.reclaimRadius} m with nothing blocking your view to return to life. You can use lifts as a ghost.</p><div class="settings-actions"><button class="button primary" data-do="reclaim-corpse" ${view.canReclaim?'':'disabled'}>RETURN TO LIFE</button><button class="small-button" data-do="return-graveyard">BACK TO GRAVEYARD</button><button class="small-button" data-do="spirit-healer" ${view.atHealer?'':'disabled'}>HEALER / ${view.healerCost} gold + TEMPORARY WEAKNESS</button><button class="small-button" data-do="map-region" data-id="${Math.max(Math.abs(simulation.character.death.corpse[0]),Math.abs(simulation.character.death.corpse[2]))>data.world.cityRadius?'basin':'city'}">LOCATE BODY</button><button class="small-button" data-do="settings">SETTINGS</button></div>`,'GHOST / RETURN TO LIFE','recovery');
}
function updateRecoveryUI(){
  const c=simulation.character,view=recoveryView(c,data,world,worldClock.now()),spirit=isSpirit(c),r=data.rules.death;
  const screen=$('#death-screen'),wasHidden=screen.hidden;
  screen.hidden=c.health>0||spirit;
  $('#world').classList.toggle('spirit-world',spirit);
  $('#death-description').textContent=simulation.inDungeon?'Another player can revive you. If everyone dies, this chapter restarts after five seconds.':`You lost ${c.death?.goldLost||0} gold. Become a ghost at ${view?.graveyard?.name||'the nearest graveyard'}, then follow the marker to your body. Return with ${r.corpseHealthFraction*100}% health and energy at no extra cost. The graveyard healer offers a paid shortcut with a temporary penalty.`;
  $('#respawn').disabled=simulation.inDungeon||!view||view.wait>0;
  $('#respawn').textContent=simulation.inDungeon?'WAIT FOR REVIVAL':view?.wait>0?`BECOME A GHOST IN ${view.wait}s`:'BECOME A GHOST ↗';
  $('#death-dungeons').hidden=!simulation.inDungeon;
  if(!screen.hidden&&wasHidden){input.clear();screen.focus();}
  $('#recovery-panel').hidden=!spirit;
  if(spirit&&view){
    $('#corpse-direction').textContent=`${bearing(c.position,c.death.corpse,yaw)} YOUR BODY · ${view.distance} m`;
    $('#recovery-description').textContent=view.canReclaim?'Your body is close enough. Choose RETURN TO LIFE to recover with 50% health and energy. You can also select your body and press E (controller: X; touch: USE).':`Get within ${r.reclaimRadius} m of your body with nothing blocking your view. As a ghost, you cannot take damage and can use lifts. Your body is ${Math.round(c.death.corpse[1])} m above street level. Press M for the map or Esc for recovery options.`;
    $('#reclaim-corpse').disabled=!view.canReclaim;
    $('#spirit-healer').hidden=!view.atHealer;
    $('#spirit-healer').textContent=`HEALER · ${view.healerCost} gold + ${r.sicknessSeconds}s WEAKNESS`;
  }
  $('#sickness-status').hidden=!(c.resurrectionSickness>0);
  const sickness=`WEAKENED · ${Math.ceil(c.resurrectionSickness||0)}s · −${(1-r.sicknessDamageMultiplier)*100}% damage / −${(1-r.sicknessSpeedMultiplier)*100}% movement`;
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
  $('#health-fill').style.width=`${clamp(c.health/s.health*100,0,100)}%`;$('#health-text').textContent=`HEALTH ${Math.ceil(c.health)}/${Math.ceil(s.health)}${simulation.shield?' +'+Math.ceil(simulation.shield)+' SHIELD':''}`;
  $('#energy-fill').style.width=`${clamp(c.energy/s.energy*100,0,100)}%`;$('#energy-text').textContent=`ENERGY ${Math.floor(c.energy)}/${Math.ceil(s.energy)}`;
  $('#gold').textContent=`${c.gold} gold`;$('#medkit-count').textContent=String(c.medkits);
  $('#xp-fill').style.width=`${c.level===60?100:c.xp/experienceFor(c.level,data.rules)*100}%`;$('#xp-text').textContent=c.level===60?'LEVEL 60 / MAX LEVEL':`LEVEL ${c.level} · ${c.xp.toLocaleString('en-US')} / ${experienceFor(c.level,data.rules).toLocaleString('en-US')} XP`;
  $('#founder-xp-status').hidden=!founderBoostActive(c);
  const district=world.district(c.position),interior=world.interiorAt(c.position),training=!simulation.inDungeon&&world.inTutorial(c.position);
  $('#zone-name').textContent=training?data.world.tutorial.name.toUpperCase():interior?interior.identity.name.split(' · ')[0]:district.name;
  $('#zone-subtitle').textContent=training?'SAFE TRAINING AREA · MOVE / USE / SHOOT':interior?`${interior.identity.address} · ${Math.floor(c.position[1]/data.world.interiors.height)===0?'Shop / stairs inside':interior.identity.upper[Math.min(1,Math.floor(c.position[1]/data.world.interiors.height)-1)]}`:district.subtitle;
  const neighborhood=cityLife.neighborhoods.get(district.id),street=$('#street-life');
  const incident=simulation.worldEvents.filter(e=>e.phase!=='idle'&&Math.abs(c.position[1]-e.position[1])<6&&distance(c.position,e.position)<data.events.rules.triggerRadius).sort((a,b)=>distance(c.position,a.position)-distance(c.position,b.position))[0];
  street.hidden=training||(!neighborhood&&!incident)||simulation.inDungeon;street.classList.toggle('has-incident',Boolean(incident));
  if(incident){
    const next=incident.controls.filter(s=>!incident.repaired.includes(s.id)).sort((a,b)=>distance(c.position,a.position)-distance(c.position,b.position))[0];
    street.textContent=`EMERGENCY · ${incident.name}\n${incidentStatus(incident,data.events.rules,simulation.time)}${incident.phase==='active'&&next?`\nE · ${next.name} · ${Math.round(distance(c.position,next.position))} m`:''}`;
    street.style.setProperty('--neighborhood-color',incident.color);
  }else if(neighborhood){const event=cityEvent(neighborhood,worldClock.now());street.textContent=`${neighborhood.name} · ${event.name} · J: Neighborhoods`;street.style.setProperty('--neighborhood-color',neighborhood.color);}
  for(const node of document.querySelectorAll("[data-incident-status]")){const event=simulation.worldEvents.find(e=>e.id===node.dataset.incidentStatus);if(event)node.textContent=incidentStatus(event,data.events.rules,simulation.time);}
  const ds=simulation.dungeon,run=ds?.run,definition=run&&data.dungeons.entries.find(d=>d.id===run.dungeon);
  if(simulation.inDungeon){$('#zone-name').textContent=definition.name;$('#zone-subtitle').textContent=definition.chapters[run.chapter].name;}
  $('.quest-tracker').hidden=simulation.inDungeon||c.health<=0;$('.minimap-heading>span').textContent=simulation.inDungeon?'DUNGEON':district.kind?district.name:district.id==='basin'?'PALE BASIN':'VESPER';
  const status=$('#dungeon-status');status.hidden=!run&&!ds?.queue;
  status.textContent=run?run.phase==='ready'?`GROUP FOUND · ${Math.max(0,Math.ceil(run.deadline-simulation.time))}s · G TO JOIN`:run.phase==='active'?`CHAPTER ${run.chapter+1} · EVIDENCE ${run.evidence.length}/2 · PLAYERS WHO READ EVIDENCE ${run.signed.length}/${run.members.length} · G DETAILS`:`${run.phase==='wipe'?'GROUP REVIVING':run.phase==='complete'?'DUNGEON COMPLETE':run.phase==='decision'?'YOUR CHOICE':'CHAPTER READY'} · G DETAILS`:ds?.queue?`DUNGEON QUEUE · ${ds.queue.waiting}/${ds.queue.required} · G TO VIEW`:'';
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
    for(const node of document.querySelectorAll('[data-dungeon-vitals]')){const member=run?.members.find(m=>m.id===node.dataset.dungeonVitals);if(member)node.textContent=member.health<=0?'DEAD':`${Math.ceil(member.health)}/${Math.ceil(member.maxHealth)} HEALTH`;}
  }
  $('#role-label').textContent=data.factions.find(f=>f.id===c.faction).name.toUpperCase()+' / PLAYER'+(talentBudget(c,data.rules)>Object.values(c.talents).reduce((sum,n)=>sum+n,0)?' · T: USE TALENT POINTS':'');
  $('#elevation').textContent=interior?`FLOOR ${Math.min(3,Math.floor(c.position[1]/data.world.interiors.height)+1)} / 3 · ${Math.round(c.position[1])} M`:Math.abs(c.position[1])<.1?'STREET LEVEL':`ELEVATION ${Math.round(c.position[1])} M`;
  const target=selectedTarget(),problem=targetProblem(target,c,world);$('#target-frame').hidden=!target;
  if(target){
    const object=target.object,health=Number.isFinite(object.health)&&object.maxHealth>0;
    $('#target-name').textContent=object.name;$('#target-level').textContent=object.level!==undefined?`LV ${object.level}${object.exposedUntil>simulation.time?' · WEAKENED':''}${object.stunUntil>simulation.time?' · STUNNED':''}`:target.kind==='resident'?'RESIDENT':target.kind==='npc'?'CONTACT':'OBJECT';
    $('#target-health-bar').hidden=!health;
    if(health){$('#target-health').style.width=`${clamp(object.health/object.maxHealth*100,0,100)}%`;$('#target-health').style.background=target.kind==='enemy'?'#c07871':'#8ce7d0';}
    $('#target-status').textContent=`${Math.ceil(distance(c.position,target.position))} m · ${problem||target.action}`;
  }
  const tracked=data.quests.filter(q=>c.activeQuests[q.id]!==undefined).slice(0,3);
  $('#tracked-quests').innerHTML=tracked.length?tracked.map(q=>{
    const view=questView(q,c),npc=data.npcs.find(n=>n.id===q.giver),dest=questDestination(q,c,data,simulation.worldEvents);
    return `<div class="tracked-quest"><strong>${esc(q.title)}${view.staged&&!view.ready?` · ${view.index+1}/${view.total}`:''}</strong><span>${view.ready?'↳ Return and choose an ending with '+esc(npc.name):esc(questObjective(q))+' · '+view.progress+'/'+view.step.count+(view.step.type==='hold'?'s':'')}</span>${dest?`<small>◇ ${Math.round(distance(c.position,dest.position))} m / ${esc(dest.name)}</small>`:''}</div>`;
  }).join(''):`<div class="tracked-quest"><small>Press J → Story to see what to do next.</small></div>`;
  updateStoryGuide();
  $('#interaction').hidden=!target?.action||$('#panel-dialog').open||c.health<=0&&!isSpirit(c);
  $('#interaction').disabled=Boolean(problem);
  $('#interaction-key').textContent=input.connected?'X':'E';
  if(target)$('#interaction-text').textContent=`${target.action} · ${target.object.name}${problem?' · '+problem:''}`;
  for(const a of data.abilities){const b=$(`[data-action="ability:${a.id}"]`),remaining=Math.max(0,(simulation.cooldowns[a.id]||0)-simulation.time);b.classList.toggle('locked',c.level<a.level);b.querySelector('.cooldown-shade').style.transform=`scaleY(${Math.min(1,remaining/(a.cooldown*(1-s.haste)))})`;b.querySelector('.cooldown-number').textContent=remaining>0?Math.ceil(remaining):'';b.querySelector('.locked-level').textContent=c.level<a.level?'LV '+a.level:'';}
  const ghost=simulation.ghostlines.find(g=>g.owner===c.id&&simulation.time<=g.started+g.path.at(-1).time),charge=simulation.ghostCharge;
  const ghostCooldown=Math.max(0,(simulation.cooldowns.ghostline||0)-simulation.time),ghostKey=input.connected?'R3':'R',g=data.rules.ghostline,ghostCost=data.abilities.find(a=>a.id==='ghostline').cost*(1-s.efficiency);
  $('#ghostline-status').textContent=c.health<=0?'GHOSTLINE · UNAVAILABLE WHILE DEAD':ghost?'GHOSTLINE ACTIVE · TOUCH YOUR BLUE GHOST TO BLAST ENEMIES':ghostCooldown>0?`GHOSTLINE · RECHARGING ${Math.ceil(ghostCooldown)}s`:c.energy<ghostCost?`GHOSTLINE · NEED ${Math.ceil(ghostCost)} ENERGY`:charge?.ready?`${ghostKey} · GHOSTLINE READY · USE, THEN TOUCH YOUR BLUE GHOST`:`GHOSTLINE · MOVE ${Math.min(g.minDistance,Math.floor(charge?.meters||0))}/${g.minDistance} m · ${Math.min(g.minSeconds,charge?.seconds||0).toFixed(1)}/${g.minSeconds} s`;
  updateRecoveryUI();
  input.menu=inputBlocked();
  $('#input-label').textContent=input.connected?'Y SELECT · X USE · RT SHOOT':'CLICK TO SELECT · HOLD RIGHT MOUSE TO LOOK · E TO USE';
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
  for(const route of data.world.routes||[]){const a=p(route.start),b=p(route.end);ctx.strokeStyle='#ddb27c';ctx.lineWidth=full?2:3;ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();if(!full){ctx.font='8px monospace';ctx.fillStyle='#e5c49a';ctx.fillText(`${Math.round(route.end[1])}m`,b[0]+5,b[1]);}}
  if(!simulation.inDungeon&&data.world.tutorial){const area=data.world.tutorial,[x,y]=p(area.center);ctx.strokeStyle=area.color;ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,area.radius*scale,0,Math.PI*2);ctx.stroke();if(full&&mapRegion==='city'){ctx.fillStyle=area.color;ctx.font='10px monospace';ctx.textAlign='center';ctx.fillText('TUTORIAL COURTYARD',x,y-area.radius*scale-8);}}
  for(const lift of data.world.lifts){const [x,y]=p(lift.position);ctx.fillStyle='#77c4cd';ctx.fillRect(x-2,y-2,4,4);}
  if(simulation.inDungeon){const r=data.dungeons.rules,run=simulation.dungeon.run,d=data.dungeons.entries.find(d=>d.id===run.dungeon);const [x,y]=p(r.arena);ctx.strokeStyle='#d3dbba';ctx.strokeRect(x-r.arenaRadius*scale,y-r.arenaRadius*scale,r.arenaRadius*scale*2,r.arenaRadius*scale*2);for(const point of [...d.chapters[run.chapter].evidence.map(e=>dungeonPosition(r,e.position)),r.recoveryPosition]){const [x,y]=p(point);ctx.fillStyle=d.color;ctx.fillRect(x-3,y-3,6,6);}for(const other of otherPlayers){const [x,y]=p(other.position);ctx.fillStyle=other.health>0?'#81dce0':'#ee9b9f';ctx.fillRect(x-2,y-2,4,4);}}
  for(const npc of data.npcs){if(!world.isDiscovered(npc.position))continue;const [x,y]=p(npc.position);ctx.fillStyle=npc.color;ctx.fillRect(x-1.5,y-1.5,3,3);}
  if(!simulation.inDungeon){
    if(!full)for(const resident of cityLife.actors){if(Math.abs(resident.position[1]-c.position[1])>5||!world.isDiscovered(resident.position))continue;const [x,y]=p(resident.position);ctx.fillStyle=resident.activity==='flee'?'#e4b083':'#a1bab9';ctx.fillRect(x-1,y-1,2,2);}
    if(full&&mapRegion==='city')for(const n of data.citylife.neighborhoods){const contact=data.npcs.find(p=>p.id===n.contact),[x,y]=p(contact.position);ctx.fillStyle=n.color;ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();ctx.font='11px monospace';ctx.textAlign='center';ctx.fillText(n.name.toUpperCase(),x,y-20);ctx.font='9px monospace';ctx.fillText(`${contact.name}${contact.position[1]?' · SKYWAY':''}`,x,y-8);}
  }
  for(const q of data.quests)if(c.activeQuests[q.id]!==undefined){const dest=questDestination(q,c,data,simulation.worldEvents);if(dest){const [x,y]=p(dest.position);ctx.strokeStyle='#e7cb7b';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.stroke();}}
  if(!simulation.inDungeon){
    const lead=c.health>0?campaignLead(c,data,simulation.worldEvents).next:null;
    const guide=c.health>0?openingGuide(c,data,simulation.worldEvents)||(!lead?.locked?lead:null):null;
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
  if(!simulation||state!=='playing')return;const c=simulation.character,target=selectedTarget();let html='';
  if(target&&visibleTargets([target],c,world,renderer).length){const b=targetBounds(target,p=>renderer.project(p));html+=`<div class="target-marker" style="left:${b.left}px;top:${b.top}px;width:${b.right-b.left}px;height:${b.bottom-b.top}px;border-color:${target.kind==='enemy'?'#efbd7d':'#8ce7d0'}"></div>`;}
  const waypoint=c.death?{name:'YOUR BODY',position:c.death.corpse}:currentGuide?.destination;
  if(waypoint&&!simulation.inDungeon){const p=renderer.project([waypoint.position[0],waypoint.position[1]+3.5,waypoint.position[2]]);if(p&&p[2]<=1)html+=`<div class="world-label story-waypoint" style="left:${p[0]}px;top:${p[1]}px">◇ ${esc(waypoint.name)}<small>${Math.ceil(distance(c.position,waypoint.position))} m${c.death?' · RETURN TO LIFE':currentGuide?.tutorial?' · TUTORIAL':' · STORY'}</small></div>`;}
  if(isSpirit(c)){const g=data.world.graveyards.find(g=>g.id===c.death.graveyard),p=g&&renderer.project([g.position[0],g.position[1]+3.5,g.position[2]]);if(p&&p[2]<=1)html+=`<div class="world-label" style="left:${p[0]}px;top:${p[1]}px;color:#bce8fa">GRAVEYARD HEALER<small>${esc(g.name)} · SELECT, THEN E (CONTROLLER: X · TOUCH: USE)</small></div>`;}
  if(simulation.inDungeon){const run=simulation.dungeon.run,d=data.dungeons.entries.find(d=>d.id===run.dungeon),r=data.dungeons.rules;for(const e of [...d.chapters[run.chapter].evidence.map(e=>({...e,position:dungeonPosition(r,e.position)})),{name:'HEAL HERE · SELECT, THEN E',position:r.recoveryPosition}]){const p=renderer.project([e.position[0],e.position[1]+3,e.position[2]]);if(p)html+=`<div class="world-label" style="left:${p[0]}px;top:${p[1]}px">${esc(e.name)}</div>`;}for(const other of otherPlayers.filter(p=>p.health<=0)){const p=renderer.project([other.position[0],other.position[1]+1,other.position[2]]);if(p)html+=`<div class="world-label" style="left:${p[0]}px;top:${p[1]}px">${esc(other.name)}<small>DEAD · SELECT, THEN E TO REVIVE</small></div>`;}}
  for(const npc of data.npcs){if(distance(c.position,npc.position)>75||!world.lineOfSight(c.position,npc.position))continue;const p=renderer.project([npc.position[0],npc.position[1]+3,npc.position[2]]);if(!p||p[2]>1)continue;const has=data.quests.some(q=>q.giver===npc.id&&(availableQuest(q,c)||c.activeQuests[q.id]>=q.objective.count));html+=`<div class="world-label" style="left:${p[0]}px;top:${p[1]}px;color:${npc.color}">${has?'<span class="quest-mark">!</span>':''}${esc(npc.name)}<small>${esc(npc.title)}</small></div>`;}
  if(!simulation.inDungeon){
    const shops=world.buildings.map(b=>({b,door:[b.x,0,b.z+(c.position[2]<b.z?-1:1)*(b.d/2+.9)]})).filter(({door})=>distance(c.position,door)<38).sort((a,b)=>distance(c.position,a.door)-distance(c.position,b.door)).slice(0,2);
    for(const {b,door}of shops){if(!world.lineOfSight(c.position,door))continue;const p=renderer.project([door[0],4.9,door[2]]);if(p&&p[2]<=1)html+=`<div class="world-label street-site" style="left:${p[0]}px;top:${p[1]}px;color:${b.identity.trim}">${esc(b.identity.name)}<small>${b.interior?'OPEN · 3 FLOORS · STAIRS INSIDE':'SERVICE BUILDING · NO PUBLIC ENTRY'}</small></div>`;}
    for(const route of data.world.routes||[]){const end=distance(c.position,route.start)<distance(c.position,route.end)?route.start:route.end;if(distance(c.position,end)>30||!world.lineOfSight(c.position,end))continue;const p=renderer.project([end[0],end[1]+2.5,end[2]]);if(p&&p[2]<=1)html+=`<div class="world-label street-site" style="left:${p[0]}px;top:${p[1]}px;color:#ddb27c">${esc(route.name)}<small>${Math.round(route.start[1])} M ↔ ${Math.round(route.end[1])} M · WALK TO CLIMB</small></div>`;}
    const overheard=!$('#panel-dialog').open&&cityLife.overheard(c.position,worldClock.now());
    const resident=target?.kind==='resident'?target.object:null;
    for(const actor of [overheard,resident].filter((a,i,all)=>a&&all.findIndex(b=>b?.id===a.id)===i)){
      if(!world.lineOfSight(c.position,actor.position))continue;
      const p=renderer.project([actor.position[0],actor.position[1]+3,actor.position[2]]);
      if(p&&p[2]<=1)html+=`<div class="world-label resident-label" style="left:${p[0]}px;top:${p[1]}px;color:${actor.color}">${esc(actor.name)}<small>${esc(actor.title)}</small>${actor===overheard?`<span class="street-speech">“${esc(Math.floor(worldClock.now()/23000)%2?actor.line:actor.personal||data.citylife.roles[actor.role].line)}”</span>`:''}</div>`;
    }
    for(const event of simulation.worldEvents){
      if(event.phase==='idle'||distance(c.position,event.position)>100||!world.lineOfSight(c.position,event.position))continue;
      const p=renderer.project([event.position[0],event.position[1]+9,event.position[2]]);
      if(p&&p[2]<=1)html+=`<div class="world-label incident-label" style="left:${p[0]}px;top:${p[1]}px;color:${event.color}">${esc(event.name)}<small>${esc(incidentStatus(event,data.events.rules,simulation.time))}</small></div>`;
      if(event.hazard){const h=event.hazard,p=renderer.project([h.position[0],h.position[1]+1,h.position[2]]);if(p&&p[2]<=1)html+=`<div class="world-label" style="left:${p[0]}px;top:${p[1]}px;color:#ff9c67">DANGER · ${Math.max(0,Math.ceil(h.hitsAt-simulation.time))}s<small>LEAVE THE MARKED CIRCLE</small></div>`;}
    }
    for(const site of data.world.landmarks.filter(l=>l.neighborhood||Object.values(data.world.tutorial||{}).includes(l.id))){
      if(distance(c.position,site.position)>32||!world.lineOfSight(c.position,site.position))continue;
      const p=renderer.project([site.position[0],site.position[1]+4.6,site.position[2]]);
      if(p&&p[2]<=1)html+=`<div class="world-label street-site" style="left:${p[0]}px;top:${p[1]}px;color:${site.color}">${esc(site.name)}<small>${site.kind==='practice'?'PRACTICE · SELECT, THEN SHOOT':site.kind==='training-pad'?'WALK ONTO THIS MARKER':site.id===data.world.tutorial?.exit?'LEAVE TRAINING · SELECT, THEN USE':site.id===data.world.tutorial?.terminal?'TRAINING · SELECT, THEN USE':'READ RECORD · SELECT, THEN E'}</small></div>`;
    }
  }
  for(const e of simulation.enemies){if(e.health<=0||distance(c.position,e.position)>80||!world.lineOfSight(c.position,e.position))continue;const p=renderer.project([e.position[0],e.position[1]+3.4,e.position[2]]);if(!p||p[2]>1)continue;html+=`<div class="world-label" style="left:${p[0]}px;top:${p[1]}px;color:${targetKey===`enemy:${e.id}`?'#f1d0a4':'#d4b7a0'}">${esc(e.name)} <small>LV ${e.level}</small><div class="enemy-bar"><i style="width:${e.health/e.maxHealth*100}%"></i></div></div>`;}
  for(const other of otherPlayers){if(other.health<=0||distance(c.position,other.position)>80||!world.lineOfSight(c.position,other.position))continue;const p=renderer.project([other.position[0],other.position[1]+2.8,other.position[2]]);if(p)html+=`<div class="world-label" style="left:${p[0]}px;top:${p[1]}px">${esc(other.name)}${other.guild?`<small>〈${esc(other.guild.name)}〉</small>`:''}</div>`;}
  for(const ghost of simulation.ghostlines){if(simulation.time>ghost.started+ghost.path.at(-1).time)continue;const position=ghostPosition(ghost,simulation.time);if(distance(c.position,position)>80)continue;const p=renderer.project([position[0],position[1]+3.2,position[2]]);if(p)html+=`<div class="world-label ghostline-label" style="left:${p[0]}px;top:${p[1]}px">${esc(ghost.name)} · GHOSTLINE<small>${simulation.time<ghost.started+data.rules.ghostline.armSeconds?'GETTING READY':'TOUCH TO BLAST ENEMIES'}</small></div>`;}
  for(const f of floaters){const age=time-f.time,p=renderer.project([f.position[0],f.position[1]+3+age*2,f.position[2]]);if(p)html+=`<div class="float-number ${f.critical?'critical':''}" style="left:${p[0]}px;top:${p[1]}px;color:${f.color};opacity:${1-age/f.duration}">${esc(f.text)}</div>`;}
  html+=liveChat.feed.labels(c,otherPlayers,world,renderer,worldClock.now());
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
  if(state==='playing')for(const actor of actors){if(actor.health>0)actor.gesture=liveChat.feed.gesture(actor.id,worldClock.now());}
  if(state==='playing'&&simulation.inDungeon)cityLife.clear();
  else if(state!=='creation')actors.push(...cityLife.update(worldClock.now(),state==='playing'?simulation.character.position:[camera.target[0],0,camera.target[2]],{enemies:state==='playing'?simulation.enemies:[],incidents:state==='playing'?simulation.worldEvents:[],completed:state==='playing'?simulation.character.completed:[],morality:state==='playing'?simulation.character.morality:null,quality:renderer.quality,focus:dialogPage.startsWith('resident:')?dialogPage.slice(9):null}));
  if(state==='playing'){uiAccumulator+=dt;if(uiAccumulator>.1){uiAccumulator=0;updateHUD();}}
  effects=effects.filter(e=>time-e.time<e.duration);floaters=floaters.filter(f=>time-f.time<f.duration);
  renderer.render(camera,actors,effects,time,worldClock.now(),state==='playing'?simulation.ghostlines:[],simulation?.time||0,state==='playing'&&simulation?.inDungeon?{catalog:data.dungeons,run:simulation.dungeon.run}:null,state==='playing'&&!simulation.inDungeon?{events:simulation.worldEvents,rules:data.events.rules}:null);updateLabels();interfaceUI.render(timestamp);requestAnimationFrame(frame);
}
async function boot(){
  const names=['rules','world','races','factions','quests','talents','abilities','enemies','npcs','intro','audio','lore','dungeons','citylife','events','economy','morality'];
  const manifest=await fetch('/data/manifest.json').then(r=>r.json());
  if(manifest.format!=='sloperberpunk-content-manifest'||manifest.version!==2||[...names,'models'].some(name=>manifest.files?.[name]!==1))throw new Error('Unsupported content schema version.');
  const values=await Promise.all(names.map(async name=>{const response=await fetch(`/data/${name}.json`);if(!response.ok)throw new Error(`Could not load ${name}.`);return response.json();}));data=Object.fromEntries(names.map((n,i)=>[n,values[i]]));
  validateDungeons(data.dungeons,data);
  validateEconomy(data);
  validateProgression(data);
  validateStory(data);
  validateMorality(data);
  const models=await fetch('/assets/models.json').then(r=>r.json());world=new World(data.world);validateWorldEvents(data.events,data,world);validateCityLife(data.citylife,data,world);cityLife=new CityLife(world,data.citylife,data);renderer=new Renderer($('#world'),world,models,cityLife);renderer.reducedMotion=reducedMotion;audio=new AudioEngine(data.audio);
  audio.onVoiceStatus=status=>{updateVoiceButton();if(['blocked','unavailable','error'].includes(status))toast(audio.voiceMessage);};
  audio.onCaption=caption=>{$('#voice-caption').hidden=!caption||state!=='playing'||$('#panel-dialog').open;if(caption){$('#voice-speaker').textContent=caption.speaker;$('#voice-line').textContent=caption.text;}};
  community=new Community({character:()=>simulation?.character,online:()=>Boolean(connection?.open),showPanel:panel,isOpen:()=>dialogPage==='community'&&$('#panel-dialog').open,toast,races:data.races,data,now:()=>worldClock.now()});
  input=new Input($('#world'),perform,(dx,dy)=>{yaw-=dx;pitch=clamp(pitch+dy,-.45,1.05);});
  liveChat=new LiveSocial({root:$('#live-chat'),character:()=>simulation?.character,send:message=>Boolean(connection?.send(message)),onMode:()=>{input.menu=inputBlocked();input.clear();},toast,community:()=>community.open().catch(e=>toast(e.message)),now:()=>worldClock.now()});
  initialUI();wireEvents();interfaceUI=new WebGLUI($('#interface'),$('#interface-source'));$('#loading').hidden=true;setState('landing');requestAnimationFrame(frame);
  refreshFounderOffer();
  api('/health').then(health=>worldClock.sync(health.serverTime)).catch(()=>{});
  sessionReady=api('/session').then(session=>{account={username:session.username,founderHalo:session.founderHalo};$('#account-label').textContent=account.username;updateFounderOffer();}).catch(error=>{if(error.status!==401)toast('The server is unavailable. Try signing in again when your connection returns.');});
}
boot().catch(error=>{console.error(error);$('#loading').innerHTML='';const box=document.createElement('div');box.className='fatal';box.textContent=`Unable to load the game. ${error.message}`;$('#loading').append(box);});
