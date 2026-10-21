// Behavioral checks; keys, fixtures, HTTP responses and meshes remain in memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WorldClock, daylight, clockLabel, DAY_MS } from '../client/src/clock.js';
import { decodeLocal, encodeLocal, migrateCharacter, localSigningIdentity, signLocalExport, verifyExport } from '../client/src/persistence.js';
import { Community } from '../client/src/social.js';
import { tabardParts, tabardPreview } from '../client/src/tabard.js';
import { Renderer } from '../client/src/renderer.js';

test('UTC lighting repeats after exactly 24 real hours and survives background suspension', () => {
  const start = Date.UTC(2026,9,21), noon = start + DAY_MS/2;
  assert.equal(daylight(start).label,'NIGHT');assert.equal(daylight(noon).label,'DAY');
  assert.equal(daylight(start+DAY_MS/4).label,'DAWN');assert.equal(daylight(start+DAY_MS*.75).label,'DUSK');
  for(let hour=0;hour<24;hour++)assert.deepEqual(daylight(start+hour*3600000),daylight(start+DAY_MS+hour*3600000));
  let mono=500,wall=start;const clock=new WorldClock(()=>wall,()=>mono);
  clock.sync(noon);mono+=3*3600000;wall-=500000;
  assert.equal(clock.now(),noon+3*3600000);assert.match(clockLabel(clock.now(),true),/SERVER 15:00:00 UTC/);
  clock.sync(NaN);assert.equal(clock.now(),noon+3*3600000);
  clock.reset();assert.equal(clock.now(),wall);
});
test('legacy saves migrate without loss; future or malformed envelopes cannot be silently rewritten', () => {
  const character={id:'runner',name:'Keepsake',credits:41,completed:['relay-00'],position:[1,2,3]};
  const migrated=decodeLocal(JSON.stringify([character]));
  assert.deepEqual(migrated,[{...character,version:2,revision:0}]);
  assert.deepEqual(decodeLocal(encodeLocal(migrated)),migrated);
  assert.throws(()=>decodeLocal('{"format":"sloperberpunk-local-characters","version":3,"characters":[]}'),/Unsupported/);
  assert.throws(()=>migrateCharacter({...character,version:3}),/Unsupported/);
  assert.throws(()=>decodeLocal('{broken'));
});
test('startup signing identity survives reload and detects tampered or untrusted exports', async () => {
  const map=new Map(),storage={getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)};
  const first=await localSigningIdentity(storage),second=await localSigningIdentity(storage);
  assert.equal(map.size,1);assert.equal(first.publicKey,second.publicKey);
  const simulation={character:{id:'runner',version:2,credits:37,medkits:3,completed:['human-00']},cooldowns:{arc:15},globalReady:12,dashReady:20,time:10};
  const exported=await signLocalExport(simulation,second),payload=await verifyExport(exported,first.publicKey);
  assert.equal(payload.character.credits,37);assert.equal(payload.authority,'local');assert.ok(payload.cooldowns.arc>0);
  assert.equal(exported.privateKey,undefined);assert.equal(exported.signature.length,128);
  await assert.rejects(()=>verifyExport({...exported,payload:exported.payload.replace('"credits":37','"credits":999')},first.publicKey),/invalid/);
  await assert.rejects(()=>verifyExport(exported,'00'.repeat(32)),/untrusted/);
  await assert.rejects(()=>verifyExport({...exported,version:99},first.publicKey),/Unsupported/);
  const record=JSON.parse(map.values().next().value);record.version=99;map.set('sloperberpunk.signing-key.v2',JSON.stringify(record));
  await assert.rejects(()=>localSigningIdentity(storage),/Unsupported/);
});
test('signing never substitutes a new identity when persistent key storage fails', async () => {
  await assert.rejects(()=>localSigningIdentity({getItem:()=>null,setItem:()=>{throw new Error('Storage full');}}),/Storage full/);
});
test('community text and guild tabard previews cannot inject markup', () => {
  const malicious='<img src=x onerror=alert(1)>',context={view:'chat',character:()=>({id:'self'}),query:{}};
  const html=Community.prototype.rows.call(context,{items:[{id:1,name:malicious,body:malicious,created:10}]});
  assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;img'));
  const preview=tabardPreview({base:'" onload="alert(1)',trim:'red',emblem:'<svg>',pattern:'broken'});
  assert.ok(!preview.includes('onload'));assert.ok(!preview.includes('alert('));
});
test('tabards appear on both sides of the avatar with finite bounded geometry', async () => {
  const models=JSON.parse(await readFile(new URL('../client/assets/models.json',import.meta.url),'utf8'));
  const actor={position:[12,0,-8],model:'humanoid',yaw:1.4,color:'#ffffff'},base=[];
  Renderer.prototype.actor.call({models},base,actor,0);
  for(const pattern of ['stripe','cross','split'])for(const emblem of ['signal','star','tower']){
    const tabard={base:'#234567',trim:'#abcdef',pattern,emblem},v=[];
    Renderer.prototype.actor.call({models},v,{...actor,guild:{tabard}},0);
    assert.ok(v.every(Number.isFinite));assert.ok(v.length>base.length);assert.ok(v.length/10<650);
    assert.ok(tabardParts(tabard).length<25);
  }
});
test('all editable content files have a declared supported schema version', async () => {
  const manifest=JSON.parse(await readFile(new URL('../client/data/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.version,2);
  for(const [name,version] of Object.entries(manifest.files)){
    const path=name==='models'?'assets/models':'data/'+name;
    const document=JSON.parse(await readFile(new URL(`../client/${path}.json`,import.meta.url),'utf8'));
    assert.equal(version,1);assert.equal(document.version??1,version);
  }
});
test('uncertain monetary responses retain the same request ID and reject a different action until retried', async () => {
  const originalFetch=globalThis.fetch,originalDocument=globalThis.document,requests=[];
  const context={busy:false,pending:null,character:()=>({id:'player'}),path:()=>'/characters/player/social',isOpen:()=>false};
  globalThis.document={querySelector:()=>null};
  globalThis.fetch=async(url,options)=>{requests.push(JSON.parse(options.body));throw new Error('Connection lost after commit');};
  try {
    await assert.rejects(()=>Community.prototype.mutate.call(context,{action:'gift',target:'other',amount:15},false),/Connection lost/);
    assert.ok(context.pending.requestId);const requestId=context.pending.requestId;
    await assert.rejects(()=>Community.prototype.mutate.call(context,{action:'gift',target:'other',amount:16},false),/pending/);
    globalThis.fetch=async(url,options)=>{requests.push(JSON.parse(options.body));return{ok:true,json:async()=>({version:2,result:{ok:true}})};};
    await Community.prototype.mutate.call(context,context.pending,false);
    assert.equal(requests.length,2);assert.equal(requests[0].requestId,requestId);assert.deepEqual(requests[0],requests[1]);assert.equal(context.pending,null);
  } finally {globalThis.fetch=originalFetch;globalThis.document=originalDocument;}
});
