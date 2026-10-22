// In-memory regression checks. No browser profile, cache, screenshots or build output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { glyphs, pixelGlyph, GlyphAtlas } from '../src/pixel-font.js';
import { WebGLUI, rgba, intersection, clippedQuad, wrapLines } from '../src/webgl-ui.js';
import { Input } from '../src/input.js';
import { Community } from '../src/social.js';

function globals(t,values) {
  const previous=Object.fromEntries(Object.keys(values).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  for(const [key,value]of Object.entries(values))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  t.after(()=>{for(const [key,descriptor]of Object.entries(previous)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
}

test('original font covers printable ASCII, lowercase descenders and game symbols',()=>{
  for(let c=32;c<127;c++)assert.ok(pixelGlyph(String.fromCharCode(c)),String.fromCharCode(c));
  for(const rows of Object.values(glyphs)){assert.ok(rows.length<=9);assert.ok(rows.every(n=>Number.isInteger(n)&&n>=0&&n<32));}
  for(const c of 'gjpqy')assert.equal(pixelGlyph(c).length,9);
  assert.notDeepEqual(pixelGlyph('a'),pixelGlyph('A'));
  for(const c of '→←↑↓↗✓¤♫☰…•')assert.ok(pixelGlyph(c));
  assert.equal(pixelGlyph('’'),pixelGlyph("'"));
  assert.equal(pixelGlyph('界'),undefined,'international characters use the local Unicode fallback');
});

test('glyph atlas is bounded, reuses glyphs and never discards cached UVs',t=>{
  let fallback='';
  globals(t,{document:{createElement:()=>({getContext:()=>({fillRect(){},fillText(c){fallback=c;},measureText:()=>({width:18})})})}});
  const atlas=new GlyphAtlas(),a=atlas.get('A');
  assert.strictEqual(atlas.get('A'),a);
  atlas.get('界');assert.equal(fallback,'界');
  for(let i=0;i<1500;i++)atlas.get(String.fromCodePoint(0x400+i));
  assert.equal(atlas.entries.size,1023);
  assert.strictEqual(atlas.get('A'),a);
  assert.strictEqual(atlas.get('🛰'),atlas.get('□'));
  assert.ok([...atlas.entries.values()].flat().every(n=>Number.isFinite(n)&&n>=0&&n<=1));
});

test('visible international text gets another atlas page instead of losing characters',t=>{
  globals(t,{document:{createElement:()=>({getContext:()=>({fillRect(){},fillText(){},measureText:()=>({width:18})})})}});
  const atlas=new GlyphAtlas();for(let i=0;i<1100;i++)atlas.get(String.fromCodePoint(0x400+i));
  const ui=Object.create(WebGLUI.prototype),quads=[];
  Object.assign(ui,{fontPages:[{atlas,texture:{}}],clip:{x:0,y:0,w:100,h:100},texture:()=>({}),quad:(...args)=>quads.push(args)});
  ui.glyph('界',{x:0,y:0,w:18,h:18},[1,1,1,1]);
  assert.equal(ui.fontPages.length,2);assert.ok(ui.fontPages[1].atlas.entries.has('界'));
  assert.strictEqual(quads[0][3],ui.fontPages[1].texture);
  ui.glyph('語',{x:500,y:500,w:18,h:18},[1,1,1,1]);assert.equal(ui.fontPages[1].atlas.entries.has('語'),false);
});

test('UI colors preserve alpha and clip scrolled glyphs without stretching their UVs',()=>{
  assert.deepEqual(rgba('#ffffff80',.5),[1,1,1,128/255*.5]);
  assert.deepEqual(rgba('rgba(20, 40, 60, 0.5)',.5),[20/255,40/255,60/255,.25]);
  assert.deepEqual(rgba('rgb(100% 0% 50% / 25%)'),[1,0,.5,.25]);
  assert.deepEqual(rgba('transparent'),[0,0,0,0]);
  assert.deepEqual(intersection({x:0,y:0,w:10,h:10},{x:20,y:20,w:10,h:10}),{x:20,y:20,w:0,h:0});
  const q=clippedQuad({x:0,y:0,w:20,h:40},[0,0,1,1],{x:5,y:10,w:10,h:20});
  assert.deepEqual(q,{rect:{x:5,y:10,w:10,h:20},uv:[.25,.25,.5,.5]});
  assert.equal(clippedQuad({x:0,y:0,w:0,h:10},[0,0,1,1],{x:0,y:0,w:10,h:10}),null);
});

test('composing lines preserve whitespace, newlines and native Unicode selection offsets',()=>{
  const measure=s=>[...s].length;
  assert.deepEqual(wrapLines('hello world',6,measure),[{text:'hello ',start:0},{text:'world',start:6}]);
  assert.deepEqual(wrapLines('abcdefgh',3,measure),[{text:'abc',start:0},{text:'def',start:3},{text:'gh',start:6}]);
  assert.deepEqual(wrapLines('a\n\n',10,measure),[{text:'a',start:0},{text:'',start:2},{text:'',start:3}]);
  assert.deepEqual(wrapLines('界🚀ab',2,measure),[{text:'界🚀',start:0},{text:'ab',start:3}]);
  assert.deepEqual(wrapLines('',10,measure),[{text:'',start:0}]);
});

test('password rendering emits only masking glyphs and clips text to the field',t=>{
  const node={tagName:'INPUT',type:'password',value:'secret-value',scrollLeft:0,scrollTop:0,selectionStart:12,selectionEnd:12};
  globals(t,{document:{activeElement:node}});
  const painted=[],rects=[],ui=Object.create(WebGLUI.prototype);
  Object.assign(ui,{clip:{x:0,y:0,w:400,h:100},measure:{measureText:()=>({width:8})},glyph:c=>painted.push(c),quad:(r)=>rects.push({...r})});
  ui.control(node,{color:'#ffffff',fontSize:'16px',font:'16px monospace',lineHeight:'24px',paddingLeft:'10px',paddingRight:'10px',paddingTop:'8px',paddingBottom:'8px'}, {x:0,y:0,w:220,h:44},1);
  assert.equal(painted.join(''),'•'.repeat(12));
  assert.ok(rects.length,'focused fields have a visible caret');
  assert.deepEqual(ui.clip,{x:0,y:0,w:400,h:100},'control clipping must not leak to the next widget');
});

function renderer(t) {
  globals(t,{innerWidth:800,innerHeight:600,devicePixelRatio:1.5,document:{getSelection:()=>null}});
  const calls={uploads:0,deleted:0,draws:[],textures:0};let current;
  const gl=new Proxy({
    createBuffer:()=>({}),bindBuffer:(_,buffer)=>{current=buffer;},
    bufferData:(_,array)=>{assert.ok(array.every(Number.isFinite));current.data=array;calls.uploads++;},
    deleteBuffer:()=>calls.deleted++,deleteTexture:()=>calls.textures++,
    drawArrays:(_,__,count)=>{assert.equal(count%6,0);calls.draws.push(current);},
    getUniformLocation:()=>0,
  },{get:(object,key)=>key in object?object[key]:(()=>{})});
  const ui=Object.create(WebGLUI.prototype),background={id:'hud-frame',tagName:'DIV'},modal={id:'panel-dialog',tagName:'DIALOG',open:true};
  let roots=[background,modal];
  Object.assign(ui,{gl,canvas:{},fontTexture:{},program:{},atlas:{dirty:false},layers:new Map(),resources:new Set(),attributes:[0,1,2],allDirty:true,roots:()=>roots});
  ui.fontPages=[{atlas:ui.atlas,texture:ui.fontTexture}];
  ui.element=()=>ui.quad({x:20,y:20,w:100,h:50},[1,1,1,1]);
  return {ui,calls,background,modal,setRoots:r=>roots=r};
}

test('WebGL UI caches static geometry, draws modal last and stays sharp independently of world resolution',t=>{
  const {ui,calls,background,modal,setRoots}=renderer(t);
  setRoots([modal,background]);ui.render(0); // Deliberately invert insertion order.
  assert.equal(ui.canvas.width,1200);assert.equal(ui.canvas.height,900);
  const uploads=calls.uploads;calls.draws=[];
  setRoots([background,modal]);ui.render(16);
  assert.equal(calls.uploads,uploads,'unchanged geometry should not be reuploaded');
  assert.strictEqual(calls.draws.at(-1),ui.layers.get(modal).batches.at(-1).buffer);
  assert.equal(ui.layers.get(modal).batches[0].count,12,'modal backdrop plus panel');
  ui.source={};background.nodeType=1;background.parentElement=ui.source;
  ui.observer={takeRecords:()=>[{target:background}]};ui.render(20);
  assert.ok(calls.uploads>uploads,'same-frame HUD mutations must be painted before the observer microtask');
  ui.observer=null;
  globalThis.innerWidth=400;ui.render(32);
  assert.equal(ui.canvas.width,600);assert.ok(calls.uploads>uploads);
  const deleted=calls.deleted;setRoots([background]);ui.render(48);assert.ok(calls.deleted>deleted);
  ui.resources.add({node:{isConnected:false},texture:{}});ui.render(64);assert.equal(calls.textures,1);
  const count=calls.draws.length;ui.lost=true;ui.render(80);assert.equal(calls.draws.length,count);
});

test('UI painter emits finite triangle data and rejects fully clipped widgets',t=>{
  const {ui}=renderer(t);ui.batches=[];ui.clip={x:10,y:10,w:40,h:40};
  ui.quad({x:0,y:0,w:30,h:30},[1,.5,.2,1],[0,0,1,1]);
  assert.equal(ui.batches.length,1);assert.equal(ui.batches[0].vertices.length,48);
  assert.ok(ui.batches[0].vertices.every(Number.isFinite));
  ui.quad({x:100,y:100,w:20,h:20},[1,1,1,1]);assert.equal(ui.batches[0].vertices.length,48);
  assert.deepEqual(ui.batches[0].vertices.slice(0,4),[10,10,1/3,1/3]);
});

function keyboard(t) {
  const listeners=new Map(),actions=[];
  globals(t,{window:{addEventListener:(name,fn)=>listeners.set(name,fn)},document:{addEventListener(){},querySelector:()=>null},navigator:{getGamepads:()=>[]}});
  const input=new Input({addEventListener(){}},a=>actions.push(a),()=>{});
  input.active=true;
  const key=(code,extra={})=>{const e={code,target:{tagName:'BUTTON'},preventDefault(){this.prevented=true;},...extra};listeners.get('keydown')(e);return e;};
  return {input,actions,key,listeners};
}

test('menu Tab/Space/arrows remain native and never cast, move, use medkits or cycle enemies',t=>{
  const {input,actions,key}=keyboard(t);
  for(const code of ['Tab','Space','ArrowDown','Digit1','KeyH','KeyW','KeyC'])assert.equal(key(code).prevented,undefined);
  assert.deepEqual(actions,[]);assert.equal(input.keys.size,0);
  assert.deepEqual(input.sample(.016),{forward:0,strafe:0,jump:false,dash:false,sprint:false});
});

test('gameplay bindings, guild shortcut, Escape, text entry and composition do not conflict',t=>{
  const {input,actions,key,listeners}=keyboard(t);input.menu=false;
  assert.equal(key('Tab').prevented,true);key('KeyU');assert.deepEqual(actions,['target','guild']);
  for(const extra of [{ctrlKey:true},{metaKey:true},{altKey:true},{isComposing:true},{defaultPrevented:true},{target:{tagName:'INPUT'}}])key('KeyC',extra);
  assert.deepEqual(actions,['target','guild']);
  key('KeyW');assert.equal(input.sample(.016).forward,1);
  listeners.get('keyup')({code:'KeyW'});assert.equal(input.sample(.016).forward,0);
  input.menu=true;key('Escape',{target:{tagName:'TEXTAREA'}});assert.equal(actions.at(-1),'escape');
  const count=actions.length;key('Escape',{defaultPrevented:true});assert.equal(actions.length,count);
});

function form(action,values) {
  const elements=Object.entries(values).map(([name,value])=>({name,value:typeof value==='object'?value.value:value,type:typeof value==='object'?value.type:'text'}));
  elements.namedItem=name=>elements.find(f=>f.name===name);
  return {dataset:{communityForm:action},elements,querySelectorAll:()=>elements.filter(f=>f.type==='hidden')};
}
function social(t,forms=[]) {
  const c=Object.create(Community.prototype);let character={id:'runner-a'};
  globals(t,{document:{querySelectorAll:()=>forms,querySelector:()=>null}});
  Object.assign(c,{character:()=>character,owner:character.id,view:'chat',query:{},drafts:new Map(),pending:null,pendingDraft:null,busy:false,isOpen:()=>false});
  return {c,setCharacter:value=>character=value};
}

test('community drafts survive tab changes, remain channel-specific, and are bounded',t=>{
  const chat=form('chat',{channel:{type:'hidden',value:'world'},body:'Find me at the kitchen.'});
  const {c}=social(t,[chat]);c.saveDrafts();
  chat.elements.namedItem('body').value='';c.restoreDrafts();assert.equal(chat.elements.namedItem('body').value,'Find me at the kitchen.');
  chat.elements.namedItem('channel').value='guild:8';chat.elements.namedItem('body').value='';c.restoreDrafts();assert.equal(chat.elements.namedItem('body').value,'');
  for(let i=0;i<90;i++){chat.elements.namedItem('channel').value='guild:'+i;c.saveDrafts();}
  assert.equal(c.drafts.size,64);
});

test('switching characters cannot capture the previous character’s draft',t=>{
  const chat=form('chat',{channel:{type:'hidden',value:'world'},body:'Private draft'});
  const {c,setCharacter}=social(t,[chat]);c.saveDrafts();assert.equal(c.drafts.size,1);
  c.reset('runner-a');assert.equal(c.drafts.size,1,'reconnecting the same character retains the draft');
  c.reset('runner-b');assert.equal(c.drafts.size,0);
  setCharacter({id:'runner-b'});c.saveDrafts();assert.equal(c.drafts.size,0);
});

test('failed community sends retain drafts and retries reuse the identical request ID',async t=>{
  const chat=form('chat',{channel:{type:'hidden',value:'world'},body:'Keep this message'});
  const {c}=social(t,[chat]);const key=c.draftKey(chat),requests=[];let fail=true;
  globals(t,{fetch:async(_,options)=>{requests.push(JSON.parse(options.body));return {ok:!fail,status:fail?503:200,json:async()=>fail?{error:'Unavailable'}:{ok:true}};}});
  await assert.rejects(c.mutate({action:'chat',channel:'world',body:'Keep this message'},true,key),/Unavailable/);
  assert.ok(c.drafts.has(key));assert.ok(c.pending);const id=c.pending.requestId;
  fail=false;await c.mutate(c.pending);
  assert.equal(requests.length,2);assert.equal(requests[1].requestId,id);assert.deepEqual(requests[1],requests[0]);
  assert.equal(c.pending,null);assert.equal(c.pendingDraft,null);assert.equal(c.drafts.has(key),false);
});

test('late community responses cannot replace the latest section’s membership state',async t=>{
  const {c}=social(t),responses=[];
  Object.assign(c,{epoch:0,online:()=>true,isOpen:()=>true,showPanel(){},render(){},refresh:async()=>{},browse:()=>new Promise(resolve=>responses.push(resolve))});
  const first=c.open('guild'),second=c.open('party');
  responses[1]({marker:'current'});await second;
  responses[0]({marker:'stale'});await first;
  assert.equal(c.summary.marker,'current');assert.equal(c.view,'party');
});

test('numeric text controls retain integer and amount bounds before any social request',async t=>{
  const {c}=social(t);let invalid='',reported=false;
  const input={value:'1000001',dataset:{min:'1',max:'1000000'},setCustomValidity:value=>invalid=value,reportValidity:()=>reported=true};
  const form={querySelectorAll:()=>[input]};
  await c.submit(form);assert.match(invalid,/1 to 1000000/);assert.equal(reported,true);
  input.value='1.5';reported=false;await c.submit(form);assert.equal(reported,true);
});

test('social rendering keeps all sections and permissioned guild management available',t=>{
  const {c}=social(t);let html='';
  Object.assign(c,{character:()=>({id:'runner-a',race:'human',credits:20,medkits:2}),races:[{id:'human',name:'Afterborn'}],showPanel:(_,value)=>html=value,summary:{deliveries:0,inbox:[],contacts:[],blocked:[],members:[],channels:['world','trade','race:human'],guildInvites:[],partyInvites:[]}});
  for(const view of ['chat','dm','guild','party','auctions','forum','people','deliveries']) {
    c.view=view;c.query={};c.render();
    for(const tab of ['chat','dm','guild','party','auctions','forum','people','deliveries'])assert.ok(html.includes(`data-view="${tab}"`));
    assert.ok(html.includes('community-main'));
  }
  c.summary.guild={id:7,name:'<Signal>',owner:'runner-a',members:{'runner-a':'leader','runner-b':'member'},tabard:{base:'#284d42',trim:'#c7ed99',pattern:'stripe',emblem:'signal'}};
  c.view='guild';c.render();
  for(const action of ['guild_invite','guild_promote','guild_transfer','guild_kick','guild_tabard','guild_leave','lineage_reward'])assert.ok(html.includes(action),action);
  assert.ok(html.includes('&lt;Signal&gt;'));assert.equal(html.includes('type="color"'),false);
  assert.ok(html.includes('data-social="swatch"'));
  c.summary.guild.owner='runner-b';c.summary.guild.members['runner-a']='member';c.render();
  for(const action of ['guild_promote','guild_transfer','guild_kick','guild_tabard'])assert.equal(html.includes(action),false,action);
  c.view='auctions';c.render();assert.ok(html.includes('inputmode="numeric"'));assert.ok(html.includes('data-min="1"'));assert.ok(html.includes('data-max="1000000"'));
});

test('the entry route goes directly to the game and all game surfaces share WebGL rendering',()=>{
  const entry=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const page=readFileSync(new URL('../play.html',import.meta.url),'utf8');
  assert.match(entry,/http-equiv="refresh" content="0;url=\/play.html"/);
  assert.match(page,/<canvas id="interface" aria-hidden="true">/);
  for(const id of ['landing','creation','cinematic','hud','panel-dialog','toast'])assert.ok(page.indexOf(`id="${id}"`)>page.indexOf('id="interface-source"'));
  assert.equal(/<iframe|<webview|https?:\/\/.*(?:font|script)/i.test(page),false);
});
