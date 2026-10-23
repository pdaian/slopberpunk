// Buildless customization, earned ownership, rendering and mutation checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appearanceKey,appearanceProblem,collection,defaultAppearance,forgeProgress,partUnlocked,showcaseEntries,validateForge} from '../src/forge.js';
import {frameParts} from '../src/frame-parts.js';
import {CharacterMeshes,motionPose} from '../src/character.js';
import {FrameForge,partCard,showcasePanel} from '../src/forge-ui.js';
const read=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
const catalog=read('../data/forge.json'),models=read('../assets/models.json');
const runner=()=>({id:'me',name:'Pilot',race:'human',level:0,completed:[],mobKills:{},ordersCompleted:0,dungeonHistory:{},forge:{appearance:null,loadouts:[null,null,null]}});
const master=()=>({...runner(),level:60,completed:Array.from({length:60},(_,i)=>'q'+i),mobKills:{drone:2000},ordersCompleted:60,dungeonHistory:Object.fromEntries(Array.from({length:6},(_,i)=>['d'+i,{clears:5}]))});

test('catalog supplies six complete slots, three chassis and eighteen earned original parts',()=>{
  validateForge(catalog);
  assert.equal(catalog.frames.length,3);assert.equal(catalog.items.length,30);
  assert.equal(catalog.items.filter(i=>i.unlock).length,18);
  for(const slot of catalog.slots){assert.equal(catalog.items.filter(i=>i.slot===slot.id).length,5);assert.equal(catalog.items.filter(i=>i.slot===slot.id&&!i.unlock).length,2);}
  assert.equal(appearanceProblem(defaultAppearance(catalog),catalog,runner()),'');
  assert.equal(read('../data/manifest.json').files.forge,1);
});
test('every milestone has exact boundaries, gives prestige once and grants all legacy-earned parts',()=>{
  const start=collection(runner(),catalog);assert.equal(start.score,0);assert.equal(start.earned.length,12);
  for(const item of catalog.items.filter(i=>i.unlock)) {
    const {stat,target}=item.unlock;
    assert.equal(partUnlocked(item,{[stat]:target-1}),false,item.id);
    assert.equal(partUnlocked(item,{[stat]:target}),true,item.id);
  }
  const c=master(),all=collection(c,catalog);assert.equal(all.earned.length,30);assert.equal(all.score,660);assert.equal(all.rank.name,'Living legend');assert.equal(all.next,undefined);
  c.forge.loadouts=Array.from({length:3},()=>defaultAppearance(catalog));assert.equal(collection(c,catalog).score,660);
  c.completed.push(...c.completed);assert.equal(forgeProgress(c).contracts,60);
  c.dungeonHistory.empty={clears:0};assert.equal(forgeProgress(c).routes,6);assert.equal(forgeProgress(c).expeditions,30);
});
test('every finite milestone is achievable by each lineage and faction through real prerequisites',()=>{
  const races=read('../data/races.json'),factions=read('../data/factions.json'),quests=read('../data/quests.json'),rules=read('../data/rules.json'),dungeons=read('../data/dungeons.json');
  for(const race of races)for(const faction of factions) {
    const reachable=new Set();let previous=-1;
    while(previous!==reachable.size){
      previous=reachable.size;
      for(const q of quests)if((!q.race||q.race===race.id)&&(!q.faction||q.faction===faction.id)&&q.level<=rules.levelCap&&q.requires.every(id=>reachable.has(id)))reachable.add(q.id);
    }
    const caps={level:rules.levelCap,contracts:reachable.size,routes:dungeons.entries.length};
    for(const item of catalog.items)if(item.unlock?.stat in caps)assert.ok(item.unlock.target<=caps[item.unlock.stat],`${item.name} must be reachable for ${race.id} / ${faction.id}`);
  }
});
test('locked, missing, cross-slot and malformed configurations are rejected without mutating defaults',()=>{
  for(const item of catalog.items.filter(i=>i.unlock)) {
    const a=defaultAppearance(catalog);a.parts[item.slot]=item.id;
    assert.ok(appearanceProblem(a,catalog,runner()));assert.equal(appearanceProblem(a,catalog,master()),'');
    assert.equal(appearanceProblem(a,catalog),'','locked pieces can be rendered as previews');
  }
  for(const change of [a=>a.frame='unknown',a=>a.primary='#fff',a=>a.finish='unknown',a=>a.pattern='unknown',a=>a.parts.head='road-greaves',a=>delete a.parts.head,a=>a.parts.extra='road-visor',a=>a.score=999]) {
    const a=defaultAppearance(catalog);change(a);assert.ok(appearanceProblem(a,catalog,master()));
  }
  assert.equal(catalog.default.parts.head,'road-visor');
});
test('invalid catalogs fail before exposing unusable parts',()=>{
  for(const change of [c=>c.default.parts.head='solar-crown',c=>c.items[0].design='unknown',c=>c.items[1].design=c.items[0].design,c=>c.items.find(i=>i.unlock).unlock.stat='gold',c=>c.colors[0].hex='red',c=>c.frames[0].width=10,c=>c.rarities[1].score=-1]) {
    const c=structuredClone(catalog);change(c);assert.throws(()=>validateForge(c),/Invalid Frame Forge/);
  }
});
test('each collectible has distinct geometry, paints and markings change the actual rig',()=>{
  const rigs=new CharacterMeshes(models);rigs.forge=catalog;
  const pose=motionPose(4,.8,true,0,0);
  for(const slot of catalog.slots) {
    const shapes=new Set();
    for(const item of catalog.items.filter(i=>i.slot===slot.id)) {
      const a=defaultAppearance(catalog);a.parts[slot.id]=item.id;
      shapes.add(JSON.stringify(frameParts(catalog,a)));
      for(const detail of [false,true]) {
        const v=[];rigs.draw(v,{model:'humanoid',position:[1,2,3],yaw:.4,forge:{appearance:a}},pose,detail);
        assert.ok(v.length>0&&v.length%30===0,item.id);assert.ok(v.every(Number.isFinite),item.id);
        assert.ok(v.length<500000,'bounded per-character geometry');
      }
    }
    assert.equal(shapes.size,5,slot.id);
  }
  const a=defaultAppearance(catalog),first=rigs.frame(a,true);
  a.primary='ember';assert.notDeepEqual(rigs.frame(a,true),first);
  const clean=frameParts(catalog,{...a,pattern:'clean'});for(const pattern of ['stripe','chevron','circuit'])assert.notDeepEqual(frameParts(catalog,{...a,pattern}),clean);
  for(const finish of ['alloy','carbon'])assert.notDeepEqual(frameParts(catalog,{...a,finish}),frameParts(catalog,{...a,finish:'enamel'}));
});
test('legacy runners, ghosts, reduced detail and bounded mesh retention remain supported',()=>{
  const rigs=new CharacterMeshes(models),pose=motionPose(0,0),actor={model:'humanoid',race:'human',position:[0,0,0]};
  const legacy=[];rigs.draw(legacy,actor,pose,true);rigs.forge=catalog;
  const preserved=[];rigs.draw(preserved,actor,pose,true);assert.deepEqual(legacy,preserved);
  const a=defaultAppearance(catalog),ghost=[];rigs.draw(ghost,{...actor,forge:{appearance:a},ghost:true,color:'#71e7ed'},pose,true);
  for(let i=9;i<ghost.length;i+=10)assert.equal(ghost[i],.8);
  for(const primary of catalog.colors)for(const secondary of catalog.colors)rigs.frame({...a,primary:primary.id,secondary:secondary.id},false);
  assert.equal(rigs.forgeMeshes.size,144);
  const first=defaultAppearance(catalog),reordered={...first,parts:Object.fromEntries(Object.entries(first.parts).reverse())};
  assert.equal(appearanceKey(first),appearanceKey(reordered));
});
test('nearby standings use authoritative prestige, share ties, include self once and escape names',()=>{
  const c=runner(),players=[{id:'a',name:'<Pilot>',forge:{score:40}},{id:'b',name:'Beta',forge:{score:40}},{...c,forge:{score:999}}];
  const list=showcaseEntries(c,players,catalog);assert.deepEqual(list.map(p=>p.place),[1,1,3]);assert.equal(list.at(-1).score,0);
  const html=showcasePanel(c,players,catalog);assert.ok(html.includes('&lt;Pilot&gt;'));assert.ok(html.includes('INSPECT'));assert.ok(html.includes('currently visible in your shard'));
  assert.ok(showcasePanel(c,[],catalog).includes('No other runners are nearby'));
  const item=catalog.items.find(i=>i.unlock),card=partCard(item,catalog,forgeProgress(c),false);
  assert.ok(card.includes('Try on only'));assert.ok(card.includes('role="progressbar"'));assert.ok(!card.includes('disabled'));
});
function forgeHarness(c=runner()) {
  const f=Object.create(FrameForge.prototype),requests=[],messages=[];
  Object.assign(f,{catalog,character:()=>c,creationCharacter:runner,players:()=>[],gameDraft:defaultAppearance(catalog),creationDraft:defaultAppearance(catalog),mode:'game',owner:c.id,slot:'head',view:'assembly',filter:'all',angle:0,pose:'idle',rotate:false,busy:false,render(){},isOpen:()=>true,toast:m=>messages.push(m)});
  f.community={busy:false,pending:null,async mutate(r){requests.push(r);return {result:{forge:{...c.forge,appearance:r.appearance||c.forge.loadouts[r.slot]}}};}};
  return {f,c,requests,messages};
}
test('draft edits and locked previews never send writes; apply submits an isolated validated snapshot',async()=>{
  const {f,requests,c}=forgeHarness();
  await f.click({dataset:{forge:'part',id:'solar-crown'}});assert.equal(f.draft.parts.head,'solar-crown');assert.equal(requests.length,0);
  await assert.rejects(f.commit('apply',''),/Solar crown/);assert.equal(c.forge.appearance,null);
  await f.click({dataset:{forge:'reset'}});await f.click({dataset:{forge:'paint',id:'ember',channel:'primary'}});
  assert.equal(requests.length,0);await f.commit('apply','');assert.equal(requests.length,1);assert.equal(requests[0].appearance.primary,'ember');
  f.draft.primary='cobalt';assert.equal(requests[0].appearance.primary,'ember');assert.equal(c.forge.appearance.primary,'ember');
});
test('save failures preserve drafts and retry the exact pending request, while late responses cannot switch characters',async()=>{
  const {f,c}=forgeHarness();let request;
  f.community.mutate=async r=>{f.community.pending=request=r;throw new Error('Offline');};
  f.draft.primary='gold';await assert.rejects(f.commit('save','1'),/Offline/);assert.equal(f.busy,false);assert.equal(f.draft.primary,'gold');assert.equal(c.forge.loadouts[1],null);
  f.community.mutate=async r=>{assert.equal(r,request);f.community.pending=null;return {result:{forge:{...c.forge,loadouts:[null,r.appearance,null]}}};};
  await f.commit('retry','');assert.equal(c.forge.loadouts[1].primary,'gold');
  let finish;f.community.mutate=()=>new Promise(resolve=>finish=resolve);
  const pending=f.commit('apply',''),other={...runner(),id:'other'};f.character=()=>other;
  finish({result:{forge:{appearance:defaultAppearance(catalog)}}});await pending;assert.equal(other.forge.appearance,null);
});
test('inspecting and copying a rare look remains a preview until the viewer earns its parts',async()=>{
  const {f,requests}=forgeHarness(),a=defaultAppearance(catalog);a.parts.head='solar-crown';
  f.players=()=>[{id:'legend',name:'Legend',forge:{appearance:a,score:660}}];f.view='showcase';
  await f.click({dataset:{forge:'inspect',id:'legend'}});
  const html=f.html();assert.ok(html.includes('Solar crown'));assert.ok(html.includes('TRY THIS LOOK'));assert.ok(!html.includes('APPLY FRAME'));assert.ok(!html.includes('LOADOUT 1'));
  await f.click({dataset:{forge:'try-look'}});assert.equal(f.inspect,null);assert.equal(f.draft.parts.head,'solar-crown');
  assert.equal(requests.length,0);await assert.rejects(f.commit('apply',''),/Solar crown/);
  f.draft.primary='gold';assert.equal(a.primary,'cobalt','copied looks do not mutate the inspected player');
});
test('creation, paint, collection and loadout controls remain native, labeled and WebGL-backed',()=>{
  const {f}=forgeHarness();
  for(const view of ['assembly','paint','collection','showcase']){f.view=view;const html=f.html();assert.ok(html.includes('data-forge-preview'));assert.ok(html.includes('aria-label="Frame Forge sections"'));assert.ok(html.includes('LOADOUT 3'));assert.ok(!html.includes('type="color"'));}
  f.mode='creation';f.view='assembly';const html=f.html();assert.ok(!html.includes('LOADOUT 3'));assert.ok(!html.includes('data-id="solar-crown"'));
  const a=f.creationAppearance();a.parts.head='solar-crown';assert.equal(f.creationDraft.parts.head,'road-visor');
  const page=readFileSync(new URL('../play.html',import.meta.url),'utf8');assert.ok(page.indexOf('id="creation-forge"')>page.indexOf('id="interface-source"'));
});
