// Sloperberpunk browser application. GPL-3.0-or-later. See LICENSE.
import { World } from './world.js';
import { Renderer } from './renderer.js';
import { Simulation,createCharacter,availableQuest,experienceFor,stats } from './simulation.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { Connection,api } from './network.js';
import { icon,escapeHtml as esc } from './icons.js';
import { clamp,distance,mix3,lerp } from './math.js';
import { Community } from './social.js';
import { WorldClock,clockLabel } from './clock.js';
import { decodeLocal,encodeLocal,localSigningIdentity,signLocalExport,downloadCharacter } from './persistence.js';
import { ghostPosition } from './ghostline.js';
import { hasFounderHalo, founderBoostActive, founderXpReward, founderOfferView } from './founders.js';
import { validateDungeons, dungeonPanel, dungeonPosition } from './dungeons.js';

const $=selector=>document.querySelector(selector),storageKey='sloperberpunk.characters.v2',legacyStorageKey='sloperberpunk.characters.v1';
let data,world,renderer,input,audio,simulation=null,connection=null,account=null,serverAvailable=false;
let state='landing',selectedRace='human',selectedFaction='relay',targetId=null,nearest=null,online=false;
let time=0,lastFrame=0,uiAccumulator=0,saveAccumulator=0,yaw=0,pitch=.15,thirdPerson=true,introTime=0,introShot=-1;
let toastTimer,dialogPage='',journalFilter='active',otherPlayers=[],effects=[],floaters=[],log=[],deleteArmed=null;
let community,myGuild=null,localIdentity=null,localKeyError='',localSaveError='',founderOffer=null;
let dungeonPanelKey='';
const worldClock=new WorldClock();
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;

function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
function loadLocal(){
  try{const list=decodeLocal(localStorage.getItem(storageKey)??localStorage.getItem(legacyStorageKey));localSaveError='';return list.filter(c=>c&&typeof c.id==='string'&&typeof c.name==='string'&&[...c.name].length<=24&&Array.isArray(c.position)&&c.position.length===3&&c.position.every(Number.isFinite)&&Number.isInteger(c.level)&&c.level>=0&&c.level<=60&&data.races.some(r=>r.id===c.race)&&data.factions.some(f=>f.id===c.faction)&&['health','energy','xp','credits','weaponRank','medkits'].every(k=>Number.isFinite(c[k])&&c[k]>=0)&&c.talents&&c.activeQuests&&Array.isArray(c.completed)).slice(0,8);}catch(error){localSaveError=error.message;return [];}
}
function saveLocal(character){
  const list=loadLocal(),i=list.findIndex(c=>c.id===character.id);if(i>=0)list[i]=character;else list.push(character);
  if(localSaveError){toast(localSaveError);return;}
  character.revision=(character.revision||0)+1;
  try{localStorage.setItem(storageKey,encodeLocal(list));}catch{toast('Browser storage is unavailable. Export your character from Settings before leaving.');}
}
function setState(next){
  state=next;for(const name of ['landing','creation','cinematic','hud'])$(`#${name}`).hidden=next!==(name==='hud'?'playing':name);
  if(input){input.active=next==='playing'||next==='cinematic';input.menu=next!=='playing'||$('#panel-dialog').open;input.clear();}
}
function closePanel(){if($('#panel-dialog').open)$('#panel-dialog').close();dialogPage='';audio?.stopVoice();if(input){input.menu=state!=='playing';input.clear();}}
function panel(title,html,eyebrow='SLOPERBERPUNK / FIELD TERMINAL',page=''){
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
  if(!online){loadLocal();if(localSaveError)return toast(localSaveError);}
  closePanel();if(!online&&loadLocal().length>=8)return toast('All 8 local character slots are occupied. Remove a character to make room.');
  $('#character-error').textContent='';$('#creation-storage').textContent=online?`Server character · account ${account.username}`:'Local character · saved in this browser. Accounts use the connected Rust server.';
  if(online&&hasFounderHalo(account))$('#creation-storage').textContent+=' · First Signal Halo included.';
  setState('creation');$('#character-name').focus();
}
async function enter(){
  online=Boolean(account);const chars=online?await api('/characters').then(r=>r.characters):loadLocal();
  if(chars.length)showCharacters(chars);else openCreation();
}
function showCharacters(chars){
  panel('Choose your signal.',`<p class="muted">${online?'Account: '+esc(account.username):'These characters live in this browser.'}</p>${online&&hasFounderHalo(account)?'<p class="founder-account-note"><strong>First Signal Halo unlocked.</strong> Your numbered halo is worn automatically by every character on this account. +5% XP from level 1 until reaching level 10.</p>':''}${chars.map(c=>`<div class="character-row"><div class="grow"><strong>${esc(c.name)}</strong><small>LEVEL ${c.level} · ${esc(data.races.find(r=>r.id===c.race)?.name||c.race)} · ${esc(data.factions.find(f=>f.id===c.faction)?.name||c.faction)}</small></div><button class="small-button" data-do="play-character" data-id="${esc(c.id)}">ENTER ↗</button><button class="small-button danger" data-do="delete-character" data-id="${esc(c.id)}">${deleteArmed===c.id?'CONFIRM DELETE':'DELETE'}</button></div>`).join('')}<div class="settings-actions"><button class="button primary" data-do="new-character" ${chars.length>=8?'disabled':''}>NEW CHARACTER +</button>${online?'<button class="small-button" data-do="logout">SIGN OUT</button>':''}</div>`,'IDENTITY ARCHIVE / '+(online?'SERVER':'LOCAL'),'characters');
}
async function startGame(character,newCharacter=false){
  closePanel();connection?.close();connection=null;otherPlayers=[];targetId=null;effects=[];floaters=[];
  myGuild=null;community?.reset();worldClock.reset();
  simulation=new Simulation(data,world,structuredClone(character),onEvent);yaw=character.yaw||0;pitch=.15;
  if(online){
    connection=new Connection(character.id,onSnapshot,onEvent,()=>{
      setState('landing');panel('Signal interrupted.','<p>Your server connection closed. Reconnect to continue from the server save.</p><button class="button primary" data-do="reconnect">RECONNECT ↗</button>','CONNECTION LOST','disconnected');
    });
    try{await connection.connect();}catch(error){connection.close();connection=null;simulation=null;setState('landing');toast(error.message);return;}
  }
  $('#network-label').textContent=online?'ONLINE':'LOCAL';
  if(newCharacter||!character.introSeen){introTime=0;introShot=-1;setState('cinematic');audio.unlock().catch(()=>{});}
  else{setState('playing');toast('Welcome back. Follow your faction’s signal.');}
  updateHUD();
}
function onSnapshot(message){
  if(!simulation||!message.character)return;
  const previous=simulation.character.position,server=message.character;
  if(state==='playing'&&distance(previous,server.position)<3)server.position=mix3(previous,server.position,.12);
  simulation.character=server;simulation.enemies=message.enemies||[];otherPlayers=message.players||[];
  const previousRun=simulation.dungeonState?.run;simulation.dungeonState=message.dungeon||null;
  const currentRun=simulation.dungeonState?.run;
  if(previousRun?.id!==currentRun?.id||previousRun?.phase==='ready'&&currentRun?.phase!=='ready'||previousRun?.phase==='wipe'&&currentRun?.phase==='briefing'){targetId=null;simulation.velocity=[0,0,0];simulation.dash=0;simulation.ghostTrail.clear();}
  simulation.cooldowns=message.cooldowns||{};simulation.time=message.time||0;simulation.shield=message.shield||0;
  simulation.ghostlines=message.ghostlines||[];simulation.ghostCharge=message.ghostCharge||{seconds:0,meters:0,ready:false};simulation.dashReady=message.dashReady??simulation.dashReady;
  worldClock.sync(message.serverTime);myGuild=message.guild||null;
}
function finishIntro(){
  if(state!=='cinematic')return;audio.stopVoice();simulation.character.introSeen=true;
  if(online)connection.send({type:'intro_seen'});else saveLocal(simulation.character);
  setState('playing');toast('Welcome to Vesper. E to talk · J for your journal · Move, then R to cast a Ghostline.');
}
function act(action){
  if(!simulation)return;
  if(online)connection?.send(action);else simulation.action(action);
  if(['quest','talent','buy'].includes(action.type)&&!online){saveLocal(simulation.character);updateHUD();}
}
function onEvent(event){
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
  if(event.type==='questAccepted'){toast(`Contract accepted · ${event.quest.title}`);audio.speak(event.quest.briefing);}
  if(event.type==='questProgress'){addLog(`${event.quest.title} · ${event.progress}/${event.quest.objective.count}`);if(event.progress>=event.quest.objective.count)toast('Objective complete. Return to your contact.');}
  if(event.type==='questComplete'){toast(`Contract complete · +${event.xp??event.quest.reward.xp} XP / +${event.quest.reward.credits} ¤`);audio.effect('confirm');audio.speak(event.quest.completion);addLog(event.quest.title+' · complete');}
  if(event.type==='reward')addLog(`Recovered ${event.credits} ¤ · +${event.xp} XP`);
}
function addLog(text){log.push(text);log=log.slice(-5);$('#combat-log').innerHTML=log.map(t=>`<div>${esc(t)}</div>`).join('');}
function perform(action,event){
  if(action==='escape'){
    if(state==='cinematic')return finishIntro();
    if($('#panel-dialog').open)return closePanel();
    if(state==='creation')return setState('landing');
    if(state==='playing')return showSettings();return;
  }
  if(state!=='playing')return;
  if(action.startsWith('ability:')){if(!$('#panel-dialog').open)act({type:'ability',id:action.split(':')[1],target:targetId});return;}
  const panels={journal:showJournal,talents:showTalents,inventory:showInventory,map:showMap,dungeons:showDungeons,community:()=>community.open().catch(e=>toast(e.message))};if(panels[action])return panels[action]();
  if(action==='camera'){thirdPerson=!thirdPerson;return;}
  if(action==='medkit'){act({type:'medkit'});return;}
  if(action==='target'){
    const visible=simulation.enemies.filter(e=>e.health>0&&distance(e.position,simulation.character.position)<80&&world.lineOfSight(e.position,simulation.character.position));
    if(visible.length){const i=visible.findIndex(e=>e.id===targetId);targetId=visible[(i+1)%visible.length].id;}else targetId=null;return;
  }
  if(action==='pick'){
    let best=45;for(const e of simulation.enemies){const p=renderer.project([e.position[0],e.position[1]+1.5,e.position[2]]);if(p&&e.health>0){const d=Math.hypot(p[0]-event.clientX,p[1]-event.clientY);if(d<best){best=d;targetId=e.id;}}}return;
  }
  if(action==='interact'&&nearest){
    if(['evidence','recover','revive'].includes(nearest.kind)){const run=simulation.dungeon?.run;return act({type:'dungeon',operation:nearest.kind==='evidence'?'interact':nearest.kind,run:run.id,chapter:run.chapter,attempt:run.attempt,target:nearest.object.id});}
    if(nearest.kind==='npc')return talk(nearest.object);
    act({type:nearest.kind==='lift'?'lift':'interact',id:nearest.object.id});
  }
}

function showDungeons(){
  if(!simulation)return;
  panel('Expedition casebook',dungeonPanel(data,simulation.character,simulation.dungeon,online,simulation.time),'DUNGEONS / GROUP FINDER','dungeons');
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
  panel('A runner’s field guide.',`<div class="guide-grid">${controls.map(([a,b])=>`<div class="guide-row"><span>${a}</span><kbd>${b}</kbd></div>`).join('')}</div><p class="guide-note">CONTROLLER · Left stick moves, right stick looks. A jumps, B dashes, X interacts, Y cycles targets. RT fires; LB surges; RB heals; LT shields. D-pad up uses a medkit, down opens the map, left/right use unlocked abilities. Right-stick press (R3) casts Ghostline. View opens the journal. Menu opens settings. In menus, use the D-pad and A.</p><p class="guide-note">TOUCH · Use the left movement pad and drag the world to look. Tap the action bar to cast. TARGET chooses a nearby enemy; USE talks to contacts, activates terminals, or rides a lift.</p><article class="info-card ghostline-guide"><span class="tag">GHOSTLINE / LEVEL 0 / R · R3 · TOUCH HOTBAR</span><h3>Your past is someone else’s opening.</h3><p>Move at least 12 m over 2 seconds, then cast Ghostline. A cyan runner replays up to 6 seconds of your route. After its 0.6-second arming delay, cross it to braid: a 10 m shockwave hits visible enemies, restores your dash, and returns 20 energy. Another player crossing it adds 50% power and restores both runners. Costs 30 energy; 18-second cooldown. No target needed.</p><p>Try it: sprint past an enemy, press R, turn, and dash back through your afterimage. With a friend, lay your route through their fight and let them make contact. Follow the dotted cyan trail and the moving runner, also shown on the minimap.</p></article><div class="card-grid"><article class="info-card"><h3>Build a role, not a cage.</h3><p>Everyone carries an arc carbine, a disruption pulse, a healing protocol, and a kinetic shield. Earn a talent point every five levels. Specialize in holding ground, restoring allies, breaking enemy rhythm, or moving between them.</p></article><article class="info-card"><h3>Every shot is a roll.</h3><p>Position and range matter. A d100 resolves misses and critical hits. Stronger enemies are harder to hit. Watch your energy, interrupt incoming attacks, and save a dash for the way out.</p></article></div><p class="guide-note">Local speech is optional and uses an installed device voice. Standard USB controllers require browser support and a secure origin. GPL-3.0-or-later. Source and original assets are yours to modify under the license.</p>`,'CONTROLS / SYSTEMS','guide');
}
function questObjective(q){const o=q.objective;const names={drone:'orphaned surveyors',warden:'debt wardens',scavenger:'wirejacks'};const target=data.world.landmarks.find(l=>l.id===o.target)?.name||names[o.target]||o.target;return `${o.type==='kill'?'Disable':o.type==='explore'?'Visit':'Connect to'} ${target}${o.count>1?' × '+o.count:''}`;}
function questCard(q,c,atNpc=false){
  const accepted=c.activeQuests[q.id]!==undefined,done=c.completed.includes(q.id),ready=accepted&&c.activeQuests[q.id]>=q.objective.count,available=availableQuest(q,c);
  const rewardXp=done?q.reward.xp:founderXpReward(c,q.reward.xp,data.rules).xp,biome=data.world.biomes.find(b=>b.id===q.biome);
  return `<article class="quest-row ${!accepted&&!available&&!done?'locked':''}"><span class="quest-level">LV ${q.level}${done?' / COMPLETE':''}</span><h3>${esc(q.title)}</h3>${biome?`<small class="muted">${esc(biome.name)} · ${esc(data.npcs.find(n=>n.id===q.giver).name)}</small>`:""}<p>${esc(done?q.completion:q.briefing)}</p><div class="quest-objective">${esc(questObjective(q))}${accepted?` · ${c.activeQuests[q.id]}/${q.objective.count}`:''}</div><div class="quest-meta"><span>+${rewardXp} XP${rewardXp>q.reward.xp?' · HALO BONUS INCLUDED':''}</span><span>+${q.reward.credits} ¤</span></div>${atNpc&&available?`<button class="small-button" data-do="quest-accept" data-id="${q.id}">ACCEPT CONTRACT ↗</button>`:atNpc&&ready?`<button class="button primary" data-do="quest-complete" data-id="${q.id}">COMPLETE CONTRACT ↗</button>`:accepted?`<small class="muted">${ready?'Return to '+esc(data.npcs.find(n=>n.id===q.giver)?.name):'Contract in progress'}</small>`:!done?`<small class="muted">${available?'Available from '+esc(data.npcs.find(n=>n.id===q.giver)?.name):'Requires level '+q.level+' and the preceding chapter.'}</small>`:''}</article>`;
}
function showJournal(filter=journalFilter){
  if(!simulation)return;journalFilter=filter;const c=simulation.character;
  const applicable=data.quests.filter(q=>(!q.faction||q.faction===c.faction)&&(!q.race||q.race===c.race));
  let list=filter==='active'?applicable.filter(q=>c.activeQuests[q.id]!==undefined):filter==='available'?applicable.filter(q=>availableQuest(q,c)):filter==='history'?applicable.filter(q=>c.completed.includes(q.id)):filter==='basin'?applicable.filter(q=>q.biome):applicable.filter(q=>!q.biome);
  panel('Your unfinished business.',`<div class="tabs">${[['active','ACTIVE'],['available','AVAILABLE'],['campaign','CAMPAIGNS'],['basin','BASIN'],['history','COMPLETED']].map(([id,name])=>`<button class="${id===filter?'selected':''}" data-do="journal-filter" data-id="${id}">${name}</button>`).join('')}</div>${list.length?list.map(q=>questCard(q,c)).join(''):'<p class="muted">No contracts here yet. Meet your faction contact and Oru in Afterlight Commons, or find the basin contacts on your map.</p>'}<p class="panel-description">Faction and lineage chapters run from level 0 through 60. Basin stories are open to every faction and lineage at their listed levels. Accept and turn in each contract with its named contact; map markers show the destination.</p>`,'QUEST JOURNAL / '+c.completed.length+' COMPLETE','journal');
}
function talk(npc){
  if(npc.id==='merchant')return showShop();const c=simulation.character;
  const quests=data.quests.filter(q=>q.giver===npc.id&&((c.activeQuests[q.id]!==undefined)||availableQuest(q,c)));
  panel(npc.name,`<div class="npc-quote">“${esc(npc.dialogue)}”</div>${quests.length?quests.map(q=>questCard(q,c,true)).join(''):'<p class="muted">I have no new work for your signal right now. Check your journal for the next level gate.</p>'}<button class="small-button" data-do="speak" data-id="${npc.id}">READ DIALOGUE ♫</button>`,npc.title.toUpperCase(),'npc:'+npc.id);
  audio.speak(npc.dialogue);
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
function showMap(){panel('The ground beneath the account.','<canvas id="full-map" class="map-view" width="900" height="720" aria-label="Map of Vesper, the Pale Basin, and four nature biomes with local quest contacts"></canvas><div class="map-legend"><span><i></i> YOU</span><span><i style="background:#e8c983"></i> OBJECTIVES</span><span><i style="background:#7dbfc0"></i> LIFTS</span><span><i style="background:#86b9a0"></i> BIOMES / CONTACTS</span></div><p class="panel-description">Mourning Fen lies east, Cinderwood west, Glassroot Steppe north, and Brine Bloom south. Follow the roads out of Vesper and the open paths through each biome to its contact. Yellow markers show active destinations and turn-ins. Lifts connect the city’s streets, 24 m skyways, and 48 m crowns.</p>','WORLD MAP / PALE BASIN','map');drawMap($('#full-map'),true);}
function showSettings(){
  panel('Keep your signal clear.',`<div class="setting-row"><label for="setting-music">Sound & music<small>Original locally synthesized ambient score and effects.</small></label><input id="setting-music" type="checkbox" ${audio.enabled?'checked':''}></div><div class="setting-row"><label for="setting-voice">Local narration<small>${audio.voices.length?'Installed device voices only. Dialogue remains visible.':'No local voice detected. Install an offline system voice to enable narration.'}</small></label><input id="setting-voice" type="checkbox" ${audio.narration?'checked':''}></div><div class="setting-row"><label for="setting-quality">Render resolution<small>Lower this on mobile hardware to improve frame pacing.</small></label><select id="setting-quality"><option value="1" ${renderer.quality===1?'selected':''}>High</option><option value="0.75" ${renderer.quality===.75?'selected':''}>Balanced</option><option value="0.5" ${renderer.quality===.5?'selected':''}>Low</option></select></div><div class="setting-row"><label for="setting-volume">Volumetric light<small>Atmospheric sunlight and Commons lamp shafts. Low resolution skips lamp shafts.</small></label><input id="setting-volume" type="checkbox" ${renderer.volumetric?'checked':''}></div><div class="setting-row"><label for="setting-sensitivity">Look sensitivity</label><input type="range" id="setting-sensitivity" min="0.001" max="0.006" step="0.0005" value="${input.sensitivity}"></div><div class="setting-row"><label for="setting-camera">Third person camera<small>Toggle at any time with V.</small></label><input id="setting-camera" type="checkbox" ${thirdPerson?'checked':''}></div><div class="settings-actions"><button class="small-button" data-do="guide">CONTROLS</button><button class="small-button" data-do="intro">REPLAY INTRO</button><button class="small-button" data-do="export">EXPORT SIGNED CHARACTER</button><button class="small-button" data-do="community">COMMUNITY</button><button class="small-button" data-do="dungeons">DUNGEONS / GROUP FINDER</button><button class="small-button" data-do="leave">RETURN TO TITLE</button></div><p class="panel-description">${online?'Server':'Local browser'} character · ${input.connected?'Standard controller connected.':'Keyboard, mouse, touch, and standard controllers supported.'} Sloperberpunk is GPL-3.0-or-later. There is no warranty. <a href="/LICENSE" target="_blank" rel="noopener">Read the license ↗</a></p>`,'OPTIONS / SIGNAL PREFERENCES','settings');
}
async function showAccount(mode='login'){
  if(account){online=true;return showCharacters((await api('/characters')).characters);}
  refreshFounderOffer();
  panel(mode==='register'?'Start a new signal.':'Welcome back, runner.',`<div class="tabs"><button class="${mode==='login'?'selected':''}" data-do="account-login">SIGN IN</button><button class="${mode==='register'?'selected':''}" data-do="account-register">CREATE ACCOUNT</button></div>${!serverAvailable?'<p class="guide-note">The account server is offline. You can play and save a local character while it is unavailable.</p>':''}${mode==='register'?`<p class="founder-account-note"><strong>First Signal Halo · first 1,000 accounts.</strong><br>Exclusive permanent cosmetic. +5% combat &amp; quest XP from level 1 until level 10.<br><span data-founder-status>${esc(founderOfferView(founderOffer,account).status)}</span></p>`:''}<form id="account-form" data-mode="${mode}"><div class="form-row"><label for="username">USERNAME</label><input id="username" name="username" autocomplete="username" minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+" required placeholder="Your callsign"></div><div class="form-row"><label for="password">PASSWORD / 12–128 CHARACTERS</label><input id="password" name="password" type="password" autocomplete="${mode==='register'?'new-password':'current-password'}" minlength="12" maxlength="128" required></div><div id="account-error" class="form-error" role="alert"></div><button type="submit" class="button primary">${mode==='register'?'CREATE ACCOUNT':'ESTABLISH LINK'} ↗</button></form><p class="form-note">Account characters are saved on the server. Local characters have their own browser save and cannot be imported to the server.</p><button class="text-button" data-do="play-local">PLAY LOCALLY →</button>`,'ACCOUNT / SECURE IDENTITY', 'account');
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
  $('#respawn').onclick=()=>act({type:'respawn'});
  $('#interaction').onclick=()=>perform('interact');
  $('#character-form').addEventListener('change',()=>{selectedRace=$('input[name="race"]:checked').value;selectedFaction=$('input[name="faction"]:checked').value;updateChoices();});
  $('#character-form').addEventListener('submit',async e=>{
    e.preventDefault();audio.unlock().catch(()=>{});const button=e.submitter;button.disabled=true;
    try{const name=$('#character-name').value.trim();let c=createCharacter(name,selectedRace,selectedFaction,data);if(online)c=(await api('/characters',{name,race:selectedRace,faction:selectedFaction})).character;else saveLocal(c);await startGame(c,true);}
    catch(error){$('#character-error').textContent=error.message;}finally{button.disabled=false;}
  });
  $('#dialog-content').addEventListener('click',async e=>{
    const button=e.target.closest('[data-do]');if(!button)return;const action=button.dataset.do,id=button.dataset.id;
    try{
      if(action==='enter'){closePanel();await enter();}
      else if(action==='new-character')openCreation();
      else if(action==='account-login')await showAccount('login');else if(action==='account-register')await showAccount('register');
      else if(action==='play-local'){online=false;const chars=loadLocal();chars.length?showCharacters(chars):openCreation();}
      else if(action==='play-character'){const chars=online?(await api('/characters')).characters:loadLocal();const c=chars.find(c=>c.id===id);if(c)await startGame(c);}
      else if(action==='delete-character'){
        if(deleteArmed!==id){deleteArmed=id;button.textContent='CONFIRM DELETE';return;}
        if(online)await api('/characters/'+encodeURIComponent(id),{},'DELETE');else{const chars=loadLocal();if(localSaveError)throw new Error(localSaveError);localStorage.setItem(storageKey,encodeLocal(chars.filter(c=>c.id!==id)));}
        deleteArmed=null;showCharacters(online?(await api('/characters')).characters:loadLocal());
      }
      else if(action==='logout'){await api('/logout',{});account=null;online=false;$('#account-label').textContent='ACCOUNT';updateFounderOffer();refreshFounderOffer();closePanel();}
      else if(action==='reconnect'){if(simulation)await startGame(simulation.character);}
      else if(action==='journal-filter')showJournal(id);
      else if(action==='quest-accept'||action==='quest-complete'){act({type:'quest',id,operation:action==='quest-accept'?'accept':'complete'});if(!online)refreshPanel();else setTimeout(refreshPanel,250);}
      else if(action==='learn-talent'){act({type:'talent',id});if(!online)showTalents();else setTimeout(refreshPanel,250);}
      else if(action==='buy'){act({type:'buy',item:id});if(!online)showShop();else setTimeout(refreshPanel,250);}
      else if(action==='use-medkit'){act({type:'medkit'});if(!online)showInventory();}
      else if(action==='speak'){audio.narration=true;if(!audio.speak(data.npcs.find(n=>n.id===id).dialogue))toast('No local speech voice is installed. Dialogue is available on screen.');}
      else if(action==='guide')showGuide();
      else if(action==='lineages')showLineages();
      else if(action==='intro'){closePanel();introTime=0;introShot=-1;setState('cinematic');}
      else if(action==='export'){
        button.disabled=true;
        try{if(!online&&!localIdentity)throw new Error(localKeyError||'Local signing is unavailable in this browser.');const id=simulation.character.id;const envelope=online?await api(`/characters/${encodeURIComponent(id)}/export`):await signLocalExport(simulation,localIdentity);downloadCharacter(envelope,id);}
        finally{button.disabled=false;}
      }
      else if(action==='community')await community.open();
      else if(action==='dungeons')showDungeons();
      else if(action==='dungeon'){
        act({type:'dungeon',operation:button.dataset.operation,dungeon:button.dataset.dungeon,run:Number(button.dataset.run),chapter:Number(button.dataset.chapter),attempt:Number(button.dataset.attempt),target:button.dataset.target,choice:button.dataset.choice});
        if(button.dataset.operation==='begin')closePanel();else if(!online)showDungeons();
      }
      else if(action==='leave'){if(!online)saveLocal(simulation.character);connection?.close();connection=null;simulation=null;closePanel();setState('landing');}
    }catch(error){toast(error.message);}
  });
  $('#dialog-content').addEventListener('submit',async e=>{
    if(e.target.id!=='account-form')return;e.preventDefault();const form=e.target,button=e.submitter,fields=new FormData(form);button.disabled=true;
    try{const result=await api('/'+form.dataset.mode,{username:fields.get('username'),password:fields.get('password')});account={username:result.username,founderHalo:result.founderHalo};serverAvailable=true;online=true;$('#account-label').textContent=account.username;updateFounderOffer();refreshFounderOffer();showCharacters((await api('/characters')).characters);if(form.dataset.mode==='register'&&hasFounderHalo(account))toast('First Signal Halo unlocked · your permanent early-signup reward.');}
    catch(error){$('#account-error').textContent=error.message;}finally{button.disabled=false;}
  });
  $('#dialog-content').addEventListener('change',async e=>{
    const t=e.target;
    if(t.id==='setting-music'){if(t.checked!==audio.enabled)await audio.toggle();updateMusicButton();}
    if(t.id==='setting-voice'){audio.narration=t.checked;if(t.checked&&!audio.voices.length)toast('No local voice is available. NPC dialogue stays on screen.');if(!t.checked)audio.stopVoice();}
    if(t.id==='setting-quality')renderer.quality=Number(t.value);
    if(t.id==='setting-volume')renderer.volumetric=t.checked;
    if(t.id==='setting-sensitivity')input.sensitivity=Number(t.value);
    if(t.id==='setting-camera')thirdPerson=t.checked;
  });
  window.addEventListener('beforeunload',()=>{if(simulation&&!online)saveLocal(simulation.character);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){audio.stopVoice();if(simulation&&!online)saveLocal(simulation.character);if(connection)connection.send({type:'move',forward:0,strafe:0,yaw,jump:false,dash:false,sprint:false,sequence:++connection.sequence});}});
  window.addEventListener('graphicslost',()=>{input.clear();toast('Graphics context lost. The renderer will reload when your device restores it.');if(simulation&&!online)saveLocal(simulation.character);});
}
function updateMusicButton(){$('#music-button').innerHTML=`<span>♫</span> SOUND ${audio.enabled?'ON':'OFF'}`;$('#music-button').setAttribute('aria-pressed',String(audio.enabled));}

function findNearest(){
  if(!simulation)return null;const p=simulation.character.position;let best=null,range=data.rules.interactionRadius;
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
    if(d<range){range=d;best={kind,object};}
  }
  return best;
}
function updateHUD(){
  if(!simulation)return;const c=simulation.character,s=simulation.playerStats;
  $('#player-name').textContent=c.name;$('#player-level').textContent=c.level;$('#player-origin').textContent=data.races.find(r=>r.id===c.race).name.toUpperCase();
  $('#server-clock').textContent=clockLabel(worldClock.now(),online);
  $('#server-clock').dateTime=new Date(worldClock.now()).toISOString();
  $('#health-fill').style.width=`${clamp(c.health/s.health*100,0,100)}%`;$('#health-text').textContent=`${Math.ceil(c.health)} / ${s.health}${simulation.shield?' +'+Math.ceil(simulation.shield):''}`;
  $('#energy-fill').style.width=`${clamp(c.energy/s.energy*100,0,100)}%`;$('#energy-text').textContent=`${Math.floor(c.energy)} / ${s.energy}`;
  $('#credits').textContent=`${c.credits} ¤`;$('#medkit-count').textContent=`${c.medkits} PACKS`;
  $('#xp-fill').style.width=`${c.level===60?100:c.xp/experienceFor(c.level,data.rules)*100}%`;$('#xp-text').textContent=c.level===60?'LEVEL 60 / SIGNAL COMPLETE':`LEVEL ${c.level} · ${c.xp} / ${experienceFor(c.level,data.rules)} XP`;
  $('#founder-xp-status').hidden=!founderBoostActive(c);
  const district=world.district(c.position);$('#zone-name').textContent=district.name;$('#zone-subtitle').textContent=district.subtitle;
  const ds=simulation.dungeon,run=ds?.run,definition=run&&data.dungeons.entries.find(d=>d.id===run.dungeon);
  if(simulation.inDungeon){$('#zone-name').textContent=definition.name;$('#zone-subtitle').textContent=definition.chapters[run.chapter].name;}
  $('.quest-tracker').hidden=simulation.inDungeon;$('.minimap-heading>span').textContent=simulation.inDungeon?'EXPEDITION':district.kind?district.name:district.id==='basin'?'PALE BASIN':'VESPER';
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
  $('#elevation').textContent=c.position[1]>40?'CROWN / 48 M':c.position[1]>20?'SKYWAY / 24 M':'STREET LEVEL';
  const target=simulation.enemies.find(e=>e.id===targetId&&e.health>0);$('#target-frame').hidden=!target;
  if(target){$('#target-name').textContent=target.name;$('#target-level').textContent=`LV ${target.level}`;$('#target-health').style.width=`${target.health/target.maxHealth*100}%`;}
  const tracked=data.quests.filter(q=>c.activeQuests[q.id]!==undefined).slice(0,3);
  $('#tracked-quests').innerHTML=tracked.length?tracked.map(q=>{
    const complete=c.activeQuests[q.id]>=q.objective.count,npc=data.npcs.find(n=>n.id===q.giver),dest=complete?npc:data.world.landmarks.find(l=>l.id===q.objective.target);
    return `<div class="tracked-quest"><strong>${esc(q.title)}</strong><span>${complete?'↳ Return to '+esc(npc.name):esc(questObjective(q))+' · '+c.activeQuests[q.id]+'/'+q.objective.count}</span>${dest?`<small>◇ ${Math.round(distance(c.position,dest.position))} m / ${esc(dest.name)}</small>`:''}</div>`;
  }).join(''):`<div class="tracked-quest"><strong>Make contact</strong><span>Meet ${esc(data.npcs.find(n=>n.id===data.factions.find(f=>f.id===c.faction).giver).name)} and Oru at Afterlight Commons.</span><small>J · Open your journal</small></div>`;
  nearest=findNearest();$('#interaction').hidden=!nearest||$('#panel-dialog').open||c.health<=0;
  if(nearest)$('#interaction-text').textContent=`${nearest.kind==='npc'?'Talk to ':nearest.kind==='lift'?'Ride ':''}${nearest.object.name}`;
  for(const a of data.abilities){const b=$(`[data-action="ability:${a.id}"]`),remaining=Math.max(0,(simulation.cooldowns[a.id]||0)-simulation.time);b.classList.toggle('locked',c.level<a.level);b.querySelector('.cooldown-shade').style.transform=`scaleY(${Math.min(1,remaining/a.cooldown)})`;b.querySelector('.cooldown-number').textContent=remaining>0?Math.ceil(remaining):'';b.querySelector('.locked-level').textContent=c.level<a.level?'LV '+a.level:'';}
  const ghost=simulation.ghostlines.find(g=>g.owner===c.id&&simulation.time<=g.started+g.path.at(-1).time),charge=online?simulation.ghostCharge:simulation.ghostTrail.charge;
  const ghostCooldown=Math.max(0,(simulation.cooldowns.ghostline||0)-simulation.time),ghostKey=input.connected?'R3':'R',g=data.rules.ghostline,ghostCost=data.abilities.find(a=>a.id==='ghostline').cost;
  $('#ghostline-status').textContent=c.health<=0?'GHOSTLINE · SIGNAL OFFLINE':ghost?'ECHO LIVE · CROSS THE CYAN RUNNER TO BRAID':ghostCooldown>0?`GHOSTLINE · RECHARGING ${Math.ceil(ghostCooldown)}s`:c.energy<ghostCost?`GHOSTLINE · NEED ${ghostCost} ENERGY`:charge?.ready?`${ghostKey} · GHOSTLINE READY · CAST, THEN CROSS YOUR ECHO`:`GHOSTLINE · MOVE ${Math.min(g.minDistance,Math.floor(charge?.meters||0))}/${g.minDistance} m · ${Math.min(g.minSeconds,charge?.seconds||0).toFixed(1)}/${g.minSeconds} s`;
  const wasHidden=$('#death-screen').hidden;$('#death-screen').hidden=c.health>0;
  $('#respawn').disabled=simulation.inDungeon;$('#respawn').textContent=simulation.inDungeon?'WAIT FOR AN ALLY OR CREW RECOVERY':'RECONSTITUTE ↗';
  $('#death-dungeons').hidden=!simulation.inDungeon;
  if(c.health<=0&&wasHidden)$('#respawn').focus();
  input.menu=state!=='playing'||$('#panel-dialog').open||c.health<=0;
  $('#input-label').textContent=input.connected?'CONTROLLER · A JUMP · X USE · RT FIRE':'WASD MOVE · RMB LOOK · SPACE JUMP · Q DASH';
  drawMap($('#minimap'),false);
}
function drawMap(canvas,full){
  if(!canvas||!simulation)return;const ctx=canvas.getContext('2d'),c=simulation.character,w=canvas.width,h=canvas.height,scale=simulation.inDungeon?(full?9:2.5):full?Math.min(w,h)/(data.world.bounds*2+160):.65,center=simulation.inDungeon?data.dungeons.rules.arena:full?[0,0,0]:c.position;
  const p=pos=>[w/2+(pos[0]-center[0])*scale,h/2+(pos[2]-center[2])*scale];
  ctx.fillStyle='#0b1b16';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#7a9a5833';ctx.lineWidth=1;
  if(!simulation.inDungeon)for(const b of data.world.biomes){const [x,y]=p(b.center);ctx.fillStyle=b.ground;ctx.strokeStyle=b.color;ctx.beginPath();ctx.arc(x,y,b.radius*scale,0,Math.PI*2);ctx.fill();ctx.stroke();}
  const city=p([-1120,0,-1120]);ctx.fillStyle='#23362a';ctx.fillRect(city[0],city[1],2240*scale,2240*scale);
  ctx.fillStyle='#65795966';for(const b of world.buildings){const [x,y]=p([b.x,0,b.z]);if(x>-20&&x<w+20&&y>-20&&y<h+20)ctx.fillRect(x-b.w*scale/2,y-b.d*scale/2,b.w*scale,b.d*scale);}
  ctx.strokeStyle='#82b9ae70';for(const road of data.world.platforms){const [x,y]=p(road.position);ctx.strokeRect(x-road.size[0]*scale/2,y-road.size[2]*scale/2,road.size[0]*scale,road.size[2]*scale);}
  for(const lift of data.world.lifts){const [x,y]=p(lift.position);ctx.fillStyle='#77c4cd';ctx.fillRect(x-2,y-2,4,4);}
  if(simulation.inDungeon){const r=data.dungeons.rules,run=simulation.dungeon.run,d=data.dungeons.entries.find(d=>d.id===run.dungeon);const [x,y]=p(r.arena);ctx.strokeStyle='#d3dbba';ctx.strokeRect(x-r.arenaRadius*scale,y-r.arenaRadius*scale,r.arenaRadius*scale*2,r.arenaRadius*scale*2);for(const point of [...d.chapters[run.chapter].evidence.map(e=>dungeonPosition(r,e.position)),r.recoveryPosition]){const [x,y]=p(point);ctx.fillStyle=d.color;ctx.fillRect(x-3,y-3,6,6);}for(const other of otherPlayers){const [x,y]=p(other.position);ctx.fillStyle=other.health>0?'#81dce0':'#ee9b9f';ctx.fillRect(x-2,y-2,4,4);}}
  for(const npc of data.npcs){const [x,y]=p(npc.position);ctx.fillStyle=npc.color;ctx.fillRect(x-1.5,y-1.5,3,3);}
  for(const q of data.quests)if(c.activeQuests[q.id]!==undefined){const dest=c.activeQuests[q.id]>=q.objective.count?data.npcs.find(n=>n.id===q.giver):data.world.landmarks.find(l=>l.id===q.objective.target);if(dest){const [x,y]=p(dest.position);ctx.strokeStyle='#e7cb7b';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.stroke();}}
  if(!full)for(const e of simulation.enemies)if(e.health>0){const [x,y]=p(e.position);ctx.fillStyle='#df8875';ctx.fillRect(x-1.5,y-1.5,3,3);}
  for(const ghost of simulation.ghostlines){if(simulation.time>ghost.started+ghost.path.at(-1).time)continue;ctx.strokeStyle='#81e5ed';ctx.lineWidth=1;ctx.beginPath();ghost.path.forEach((s,i)=>{const [x,y]=p(s.position);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();const [x,y]=p(ghostPosition(ghost,simulation.time));ctx.fillStyle='#81e5ed';ctx.fillRect(x-2,y-2,4,4);}
  if(full&&!simulation.inDungeon){ctx.font='10px monospace';ctx.textAlign='center';const [cx,cy]=p([0,0,0]);ctx.fillStyle='#c4ed92';ctx.fillText('VESPER / COMMONS',cx,cy-12);for(const b of data.world.biomes){const [x,y]=p(b.center),npc=data.npcs.find(n=>n.biome===b.id);ctx.fillStyle=b.color;ctx.fillText(b.name,x,y-b.radius*scale-8);ctx.fillText(`${npc.name} · LV ${data.quests.find(q=>q.biome===b.id).level}`,x,y+b.radius*scale+14);}}
  const [x,y]=p(c.position);ctx.save();ctx.translate(x,y);ctx.rotate(-c.yaw);ctx.fillStyle='#e1f2b3';ctx.beginPath();ctx.moveTo(0,-6);ctx.lineTo(4,5);ctx.lineTo(0,3);ctx.lineTo(-4,5);ctx.closePath();ctx.fill();ctx.restore();
  ctx.fillStyle='#bfd79e';ctx.font='9px monospace';ctx.textAlign='center';ctx.fillText('N',w/2,12);
}
function updateLabels(){
  if(!simulation||state!=='playing')return;const c=simulation.character;let html='';
  if(simulation.inDungeon){const run=simulation.dungeon.run,d=data.dungeons.entries.find(d=>d.id===run.dungeon),r=data.dungeons.rules;for(const e of [...d.chapters[run.chapter].evidence.map(e=>({...e,position:dungeonPosition(r,e.position)})),{name:'RECOVERY · E',position:r.recoveryPosition}]){const p=renderer.project([e.position[0],e.position[1]+3,e.position[2]]);if(p)html+=`<div class="world-label" style="left:${p[0]}px;top:${p[1]}px">${esc(e.name)}</div>`;}for(const other of otherPlayers.filter(p=>p.health<=0)){const p=renderer.project([other.position[0],other.position[1]+1,other.position[2]]);if(p)html+=`<div class="world-label" style="left:${p[0]}px;top:${p[1]}px">${esc(other.name)}<small>DOWN · E TO REVIVE</small></div>`;}}
  for(const npc of data.npcs){if(distance(c.position,npc.position)>75)continue;const p=renderer.project([npc.position[0],npc.position[1]+3,npc.position[2]]);if(!p||p[2]>1)continue;const has=data.quests.some(q=>q.giver===npc.id&&(availableQuest(q,c)||c.activeQuests[q.id]>=q.objective.count));html+=`<div class="world-label" style="left:${p[0]}px;top:${p[1]}px;color:${npc.color}">${has?'<span class="quest-mark">!</span>':''}${esc(npc.name)}<small>${esc(npc.title)}</small></div>`;}
  for(const e of simulation.enemies){if(e.health<=0||distance(c.position,e.position)>80)continue;const p=renderer.project([e.position[0],e.position[1]+3.4,e.position[2]]);if(!p||p[2]>1)continue;html+=`<div class="world-label" style="left:${p[0]}px;top:${p[1]}px;color:${e.id===targetId?'#f1d0a4':'#d4b7a0'}">${esc(e.name)} <small>LV ${e.level}</small><div class="enemy-bar"><i style="width:${e.health/e.maxHealth*100}%"></i></div></div>`;}
  for(const other of otherPlayers){if(other.health<=0||distance(c.position,other.position)>80)continue;const p=renderer.project([other.position[0],other.position[1]+2.8,other.position[2]]);if(p)html+=`<div class="world-label" style="left:${p[0]}px;top:${p[1]}px">${esc(other.name)}${other.guild?`<small>〈${esc(other.guild.name)}〉</small>`:''}</div>`;}
  for(const ghost of simulation.ghostlines){if(simulation.time>ghost.started+ghost.path.at(-1).time)continue;const position=ghostPosition(ghost,simulation.time);if(distance(c.position,position)>80)continue;const p=renderer.project([position[0],position[1]+3.2,position[2]]);if(p)html+=`<div class="world-label ghostline-label" style="left:${p[0]}px;top:${p[1]}px">${esc(ghost.name)} · GHOSTLINE<small>${simulation.time<ghost.started+data.rules.ghostline.armSeconds?'ARMING':'CROSS TO BRAID'}</small></div>`;}
  for(const f of floaters){const age=time-f.time,p=renderer.project([f.position[0],f.position[1]+3+age*2,f.position[2]]);if(p)html+=`<div class="float-number ${f.critical?'critical':''}" style="left:${p[0]}px;top:${p[1]}px;color:${f.color};opacity:${1-age/f.duration}">${esc(f.text)}</div>`;}
  $('#world-labels').innerHTML=html;
}
function gameCamera(dt){
  const c=simulation.character,p=c.position;const look=[p[0]-Math.sin(yaw)*8,p[1]+1.7-Math.sin(pitch)*8,p[2]-Math.cos(yaw)*8];
  if(!thirdPerson)return{eye:[p[0],p[1]+1.8,p[2]],target:look,fov:1.1};
  const desired=[p[0]+Math.sin(yaw)*8*Math.cos(pitch),p[1]+3.3+Math.sin(pitch)*6,p[2]+Math.cos(yaw)*8*Math.cos(pitch)];
  let eye=desired;for(let t=.1;t<=1;t+=.1){const sample=mix3([p[0],p[1]+2,p[2]],desired,t);if(world.collides(sample[0],sample[1],sample[2],.2)){eye=mix3([p[0],p[1]+2,p[2]],desired,Math.max(.1,t-.12));break;}}
  return{eye,target:[p[0]-Math.sin(yaw)*3,p[1]+1.8-Math.sin(pitch)*3,p[2]-Math.cos(yaw)*3],fov:1.04};
}
function frame(timestamp){
  const dt=Math.min((timestamp-lastFrame)/1000||.016,.05);lastFrame=timestamp;time+=dt;
  const controls=input.sample(dt);let actors=data.npcs.map(n=>({...n,model:'humanoid',yaw:Math.atan2(-n.position[0],32-n.position[2])})),camera;
  if(state==='landing'){
    const orbit=reducedMotion?0:Math.sin(time*.018)*14;camera={eye:[135+orbit,81,165],target:[-45,36,-95],fov:.95};
  }else if(state==='creation'){
    camera={eye:[3,2.4,6.5],target:[-3,1.2,0],fov:.62};actors=[{position:[0,0,0],model:'humanoid',yaw:Math.PI*.2+(reducedMotion?0:Math.sin(time*.2)*.15),color:data.races.find(r=>r.id===selectedRace).color,founderHalo:online?account?.founderHalo:null}];
  }else if(state==='cinematic'){
    introTime+=dt;const index=data.intro.shots.findIndex(s=>introTime>=s.start&&introTime<s.end),shot=data.intro.shots[Math.max(0,index)];
    if(index<0){finishIntro();camera=gameCamera(dt);}else{
      const t=clamp((introTime-shot.start)/(shot.end-shot.start),0,1),eased=t*t*(3-2*t);camera={eye:mix3(shot.from,shot.to,eased),target:mix3(shot.lookFrom,shot.lookTo,eased),fov:.88};
      if(introShot!==index){introShot=index;$('#cinema-label').textContent=shot.label;$('#cinema-subtitle').textContent=shot.caption;audio.speak(shot.caption);}
      $('#cinema-progress').style.width=`${introTime/data.intro.duration*100}%`;
    }
  }else if(simulation){
    controls.yaw=yaw;simulation.tick(dt,controls,online);connection?.update(dt,controls);camera=gameCamera(dt);
    if(thirdPerson){const c=simulation.character;actors.push({...c,guild:myGuild,model:'humanoid',yaw:yaw+Math.PI,color:data.races.find(r=>r.id===c.race).color});}
    actors.push(...simulation.enemies,...otherPlayers.filter(p=>p.id!==simulation.character.id).map(p=>({...p,model:'humanoid',color:data.races.find(r=>r.id===p.race)?.color||'#c7ed99'})));
    uiAccumulator+=dt;if(uiAccumulator>.1){uiAccumulator=0;updateHUD();}
    saveAccumulator+=dt;if(saveAccumulator>5){saveAccumulator=0;if(!online)saveLocal(simulation.character);}
  }
  if(!camera)camera={eye:[135,81,165],target:[-45,36,-95]};
  effects=effects.filter(e=>time-e.time<e.duration);floaters=floaters.filter(f=>time-f.time<f.duration);
  renderer.render(camera,actors,effects,time,worldClock.now(),state==='playing'?simulation.ghostlines:[],simulation?.time||0,state==='playing'&&simulation?.inDungeon?{catalog:data.dungeons,run:simulation.dungeon.run}:null);updateLabels();requestAnimationFrame(frame);
}
async function boot(){
  const names=['rules','world','races','factions','quests','talents','abilities','enemies','npcs','intro','audio','lore','dungeons'];
  const manifest=await fetch('/data/manifest.json').then(r=>r.json());
  if(manifest.format!=='sloperberpunk-content-manifest'||manifest.version!==2||[...names,'models'].some(name=>manifest.files?.[name]!==1))throw new Error('Unsupported content schema version.');
  const values=await Promise.all(names.map(async name=>{const response=await fetch(`/data/${name}.json`);if(!response.ok)throw new Error(`Could not load ${name}.`);return response.json();}));data=Object.fromEntries(names.map((n,i)=>[n,values[i]]));
  validateDungeons(data.dungeons,data);
  const models=await fetch('/assets/models.json').then(r=>r.json());world=new World(data.world);renderer=new Renderer($('#world'),world,models);renderer.reducedMotion=reducedMotion;audio=new AudioEngine(data.audio);
  localSigningIdentity(localStorage).then(identity=>localIdentity=identity).catch(error=>{localKeyError=`Local character signing is unavailable: ${error.message}`;});
  community=new Community({character:()=>simulation?.character,online:()=>online&&Boolean(connection?.open),showPanel:panel,isOpen:()=>dialogPage==='community'&&$('#panel-dialog').open,toast,races:data.races,now:()=>worldClock.now()});
  input=new Input($('#world'),perform,(dx,dy)=>{yaw-=dx;pitch=clamp(pitch+dy,-.45,1.05);});
  initialUI();wireEvents();$('#loading').hidden=true;setState('landing');requestAnimationFrame(frame);
  refreshFounderOffer();
  api('/health').then(health=>{serverAvailable=true;worldClock.sync(health.serverTime);return api('/session');}).then(session=>{account={username:session.username,founderHalo:session.founderHalo};$('#account-label').textContent=account.username;updateFounderOffer();}).catch(()=>{});
}
boot().catch(error=>{console.error(error);$('#loading').innerHTML='';const box=document.createElement('div');box.className='fatal';box.textContent=`Unable to establish a signal. ${error.message}`;$('#loading').append(box);});
