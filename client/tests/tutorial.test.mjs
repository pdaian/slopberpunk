// Buildless, in-memory tutorial checks; no browser or generated files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World } from '../src/world.js';
import { Prediction } from '../src/prediction.js';
import { openingGuide } from '../src/quests.js';
import { collectTargets, targetProblem } from '../src/targeting.js';
import { tutorialGeometry } from '../src/scenery.js';

const data=Object.fromEntries(['world','rules','races','factions','talents','quests','npcs','abilities','dungeons','events'].map(name=>[name,JSON.parse(readFileSync(new URL(`../data/${name}.json`,import.meta.url)))]));
const world=new World(data.world),area=data.world.tutorial;
const character=()=>({id:'new-runner',name:'New Runner',race:'human',faction:'relay',level:0,xp:0,gold:45,health:140,energy:100,position:[...area.spawn],yaw:0,talents:{},activeQuests:{},completed:[],introSeen:true,tutorialStage:'move'});
const site=id=>data.world.landmarks.find(l=>l.id===id);

test('new-character route is walkable, separated from enemies and hazards, and on the ground',()=>{
  const points=[area.spawn,...[area.beacon,area.terminal,area.target,area.exit].map(id=>site(id).position)];
  for(const p of points){
    assert.ok(world.inTutorial(p));
    assert.equal(world.collides(...p),false);
    assert.equal(world.floorAt(p[0],p[2],p[1]+.1,p[1]-.1),p[1]);
    for(const enemy of data.world.enemySpawns)assert.ok(Math.hypot(...p.map((n,i)=>n-enemy.position[i]))>data.rules.combat.aggroRadius);
  }
  for(let i=1;i<points.length;i++){
    const from=points[i-1],to=points[i];
    assert.ok(world.lineOfSight(from,to));
    for(let step=0;step<=100;step++){
      const p=from.map((n,axis)=>n+(to[axis]-n)*step/100);
      assert.equal(world.collides(...p),false,`blocked route at ${p}`);
      assert.ok(world.inTutorial(p));
    }
  }
  for(const event of data.events.entries)for(const id of event.controls){
    const p=site(id).position;
    assert.ok(Math.hypot(p[0]-area.center[0],p[2]-area.center[2])>area.radius+data.events.rules.hazardRadius);
  }
  assert.equal(world.inTutorial(data.world.spawn),false);
  assert.equal(world.inTutorial([area.center[0],24,area.center[2]]),false,'the skyway remains outside training');
});

test('every faction and lineage gets saved, ordered guidance without changing campaign progress',()=>{
  const stages=['move','interact','combat','exit'],destinations=[area.beacon,area.terminal,area.target,area.exit];
  for(const race of data.races)for(const faction of data.factions){
    const c={...character(),race:race.id,faction:faction.id};
    for(const [index,tutorialStage]of stages.entries()){
      c.tutorialStage=tutorialStage;
      const guide=openingGuide(JSON.parse(JSON.stringify(c)),data);
      assert.equal(guide.tutorial,true);
      assert.equal(guide.view.index,index);
      assert.equal(guide.view.total,4);
      assert.equal(guide.destination.id,destinations[index]);
      assert.doesNotMatch(guide.hint,/controller|stick|touch|tap/i);
      assert.match(guide.hint,/leave training at any time/);
    }
    assert.deepEqual(c.completed,[]);assert.deepEqual(c.activeQuests,{});
    delete c.tutorialStage;
    assert.equal(openingGuide(c,data).quest.id,`${faction.id}-00`,'older and finished characters continue the existing opening');
  }
});

test('all tutorial stages and spoken instructions show only the active device controls',()=>{
  const expected={keyboard:[/WASD/,/press E/,/press 1/,/Press J/],gamepad:[/left stick/,/then X/,/then RT/,/Press View/],touch:[/touch pad/,/then USE/,/then SHOOT/,/Tap QUESTS/]};
  const forbidden={keyboard:/stick|\btap\b|\bRT\b|Press View/i,gamepad:/WASD|mouse|\bclick\b|\btap\b|press [EJM1]\b/i,touch:/WASD|mouse|\bclick\b|\bRT\b|press [EJM1]\b/i};
  const c=character(),saved=structuredClone(c);
  for(const [device,patterns]of Object.entries(expected))for(const [index,stage]of ['move','interact','combat','exit'].entries()){
    const guide=openingGuide({...c,tutorialStage:stage},data,[],device);
    assert.match(guide.hint,patterns[index]);assert.match(guide.line,patterns[index]);
    assert.doesNotMatch(guide.hint,forbidden[device]);assert.doesNotMatch(guide.line,forbidden[device]);
    assert.match(guide.hint,/leave training at any time/);
  }
  assert.deepEqual(c,saved,'changing prompt devices must not alter saved progress');
});

test('opening quest and optional social lessons retain the same device after training',()=>{
  const c=character();delete c.tutorialStage;
  for(const device of ['keyboard','gamepad','touch']){
    let guide=openingGuide(c,data,[],device);
    assert.match(guide.hint,device==='keyboard'?/press E/:device==='gamepad'?/then X/:/then USE/);
    assert.match(guide.social.hint,device==='keyboard'?/Press B/:device==='gamepad'?/Choose TRY A WAVE/:/Tap TRY A WAVE/);
    c.socialTutorial={gesture:true};guide=openingGuide(c,data,[],device);
    assert.match(guide.social.hint,device==='keyboard'?/Press Enter/:device==='gamepad'?/Choose SAY HELLO/:/Tap SAY HELLO/);
    if(device!=='keyboard')assert.doesNotMatch(guide.hint+' '+guide.social.hint+' '+guide.social.label,/press [EJMH]|ENTER| · B/i);
    delete c.socialTutorial;
  }
  for(const q of data.quests)for(const step of q.steps||[])assert.doesNotMatch(step.text+' '+(step.voice||''),/press E\b/i,'authored objectives and narration must not override the active device hints');
});

test('movement prediction never completes a tutorial or grants rewards before the server confirms it',()=>{
  const c=character(),simulation=new Prediction(data,world,c);
  for(let i=0;i<40;i++)simulation.tick(.05,{forward:1});
  assert.ok(c.position[2]<area.spawn[2]);
  assert.equal(c.tutorialStage,'move');
  assert.equal(c.xp,0);assert.equal(c.gold,45);
});

test('the practice target uses normal selection with courtyard, distance, and sightline checks',()=>{
  const c={...character(),tutorialStage:'combat'},simulation=new Prediction(data,world,c);
  const targets=collectTargets(data,simulation),target=targets.find(t=>t.object.id===area.target);
  assert.equal(target.kind,'practice');assert.equal(target.action,'Shoot');
  assert.equal(targetProblem(target,c,world),null);
  assert.equal(targetProblem(target,c,{inTutorial:()=>true,lineOfSight:()=>false}),'Something is blocking your view');
  c.position=[0,0,-36];
  assert.equal(targetProblem(target,c,world),'Enter the training courtyard');
  const gate=targets.find(t=>t.object.id===area.exit);
  assert.equal(gate.action,'Leave tutorial');
  assert.equal(targetProblem(gate,c,world),`Move within ${data.rules.interactionRadius} m`);
  c.position=[...gate.position];
  assert.equal(targetProblem(gate,c,world),null);
  c.health=0;
  assert.equal(collectTargets(data,simulation).length,0);
});

test('courtyard signs, floor markings, gate, and practice target produce finite original geometry',()=>{
  const vertices=[];tutorialGeometry(vertices,data.world);
  assert.ok(vertices.length>1000);assert.ok(vertices.every(Number.isFinite));
});
