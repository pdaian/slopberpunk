// In-memory regression checks. No browser profile, cache, screenshots or build output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { glyphs, pixelGlyph, GlyphAtlas } from '../src/pixel-font.js';
import { WebGLUI, rgba, intersection, clippedQuad, wrapLines } from '../src/webgl-ui.js';
import { Input } from '../src/input.js';
import { controllerLookStorage, controllerLookKey } from '../src/controller-look.js';
import { controlLabel, inputPrompt, updateInputPrompts } from '../src/input-prompts.js';
import { Community } from '../src/social.js';
const economyData={economy:JSON.parse(readFileSync(new URL('../data/economy.json',import.meta.url),'utf8'))};

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
  const bounds=()=>({x:20,y:20,width:100,height:50});
  const ui=Object.create(WebGLUI.prototype),background={id:'hud-frame',tagName:'DIV',getBoundingClientRect:bounds},modal={id:'panel-dialog',tagName:'DIALOG',open:true,getBoundingClientRect:bounds};
  let roots=[background,modal];
  Object.assign(ui,{gl,canvas:{},fontTexture:{},program:{},atlas:{dirty:false},layers:new Map(),resources:new Set(),images:new WeakMap(),attributes:[0,1,2],allDirty:true,roots:()=>roots});
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

test('a fitting-bay canvas gets a fresh texture after closing and reopening its panel',t=>{
  const {ui,calls}=renderer(t),canvas={tagName:'CANVAS',isConnected:true,width:300,height:400};
  ui.texture=()=>({});ui.render(0);
  const first=ui.asset(canvas,{w:300,h:400},{});assert.ok(first);assert.equal(ui.resources.size,1);
  canvas.isConnected=false;ui.render(100);assert.equal(calls.textures,1);assert.equal(ui.resources.size,0);assert.equal(ui.images.has(canvas),false);
  canvas.isConnected=true;const next=ui.asset(canvas,{w:300,h:400},{});
  assert.ok(next);assert.notStrictEqual(next,first);assert.equal(ui.resources.size,1);
});

test('cached HUD panels follow layout changes without a mutation on the moved panel',t=>{
  const {ui,calls,background,setRoots}=renderer(t);
  setRoots([background]);
  ui.element=node=>ui.quad({x:node.getBoundingClientRect().x,y:node.getBoundingClientRect().y,w:100,h:50},[1,1,1,1]);
  ui.render(0);const uploads=calls.uploads;
  background.getBoundingClientRect=()=>({x:20,y:180,width:100,height:50});
  ui.render(16);
  assert.equal(calls.uploads,uploads+1);
  assert.equal(ui.layers.get(background).batches[0].buffer.data[1],180,'text and backgrounds move with the semantic controls');
  ui.render(32);assert.equal(calls.uploads,uploads+1,'stable layouts still reuse geometry');
});

test('panel decoration and list markers do not add stray dashes or bullets',t=>{
  const style={display:'block',visibility:'visible',opacity:'1',backgroundColor:'transparent',color:'#ffffff',fontSize:'16px',outlineStyle:'none',listStyleType:'none',borderTopStyle:'none',borderBottomStyle:'none',borderLeftStyle:'none',borderRightStyle:'none',getPropertyValue:()=> '1'};
  globals(t,{document:{activeElement:null},getComputedStyle:()=>style});
  const ui=Object.create(WebGLUI.prototype),marks=[],quads=[];
  Object.assign(ui,{clip:{x:0,y:0,w:400,h:300},quad:(r,color)=>{if(color[3])quads.push(r);},string:text=>marks.push(text)});
  const node={nodeType:1,tagName:'DIV',classList:{contains:()=>false},getBoundingClientRect:()=>({x:30,y:20,width:180,height:60}),childNodes:[]};
  ui.element(node);assert.equal(quads.length,0,'plain panels do not paint corner strokes');
  node.tagName='SUMMARY';node.parentElement={open:false};ui.element(node);
  node.parentElement.open=true;ui.element(node);
  assert.deepEqual(marks,['→','↓'],'disclosures show direction instead of a minus sign');
  node.tagName='LI';node.parentElement={tagName:'UL'};ui.element(node);
  assert.equal(marks.length,2,'unstyled lists must remain unmarked');
  style.listStyleType='disc';ui.element(node);assert.equal(marks.at(-1),'·');
});

function scrolling(t) {
  const listeners=new Map(),source={addEventListener:(name,fn,options)=>listeners.set(name,{fn,options}),querySelectorAll:()=>[],append(){}};
  globals(t,{getComputedStyle:node=>node.style,document:{createElement:()=>({setAttribute(){}})}});
  const ui=Object.create(WebGLUI.prototype);Object.assign(ui,{source,layers:new Map()});ui.bindControls();
  const element=(parentElement=source,properties={})=>{
    const node={nodeType:1,tagName:'DIV',parentElement,clientWidth:200,scrollWidth:200,clientHeight:100,scrollHeight:400,
      style:{overflowX:'visible',overflowY:'auto',overscrollBehaviorX:'auto',overscrollBehaviorY:'auto',fontSize:'16px',lineHeight:'24px'},...properties};
    let left=0,top=0;
    Object.defineProperties(node,{
      scrollLeft:{get:()=>left,set:value=>{left=Math.max(0,Math.min(value,node.scrollWidth-node.clientWidth));}},
      scrollTop:{get:()=>top,set:value=>{top=Math.max(0,Math.min(value,node.scrollHeight-node.clientHeight));}},
    });
    if(parentElement===source)ui.layers.set(node,{dirty:false});return node;
  };
  const wheel=(target,extra={})=>{
    const e={target,deltaX:0,deltaY:60,deltaMode:0,cancelable:true,defaultPrevented:false,prevented:false,
      preventDefault(){this.defaultPrevented=true;this.prevented=true;},...extra};
    listeners.get('wheel').fn(e);return e;
  };
  return {ui,source,listeners,element,wheel};
}

test('wheel gestures scroll the splash from content or empty space and repaint its WebGL layer',t=>{
  const {ui,listeners,element,wheel}=scrolling(t),landing=element(undefined,{id:'landing'}),text=element(landing,{scrollHeight:100});
  assert.equal(listeners.get('wheel').options.passive,false,'handled gestures must not also scroll natively');
  assert.equal(wheel(text,{deltaY:96}).prevented,true);
  assert.equal(landing.scrollTop,96);assert.equal(text.scrollTop,0);assert.equal(ui.layers.get(landing).dirty,true);
  ui.layers.get(landing).dirty=false;
  wheel(landing,{deltaY:-40});assert.equal(landing.scrollTop,56);assert.equal(ui.layers.get(landing).dirty,true);
  wheel({nodeType:3,parentElement:text},{deltaY:20.25});assert.equal(landing.scrollTop,76.25,'trackpad deltas retain fractional pixels');
});

test('nested panels scroll locally, chain at their limits, and honor scroll containment',t=>{
  const {element,wheel}=scrolling(t),dialog=element(undefined,{tagName:'DIALOG',clientHeight:300,scrollHeight:1200}),stream=element(dialog);
  stream.scrollTop=260;wheel(stream);assert.equal(stream.scrollTop,300);assert.equal(dialog.scrollTop,0);
  wheel(stream);assert.equal(dialog.scrollTop,60,'a full inner panel passes further scrolling to its parent');
  wheel(stream,{deltaY:-60});assert.equal(stream.scrollTop,240);assert.equal(dialog.scrollTop,60);
  stream.scrollTop=0;wheel(stream,{deltaY:-60});assert.equal(dialog.scrollTop,0);
  for(const behavior of ['contain','none']) {
    stream.style.overscrollBehaviorY=behavior;dialog.scrollTop=100;
    assert.equal(wheel(stream,{deltaY:-60}).prevented,true);assert.equal(dialog.scrollTop,100);
    stream.scrollTop=300;assert.equal(wheel(stream).prevented,true);assert.equal(dialog.scrollTop,100);
    stream.scrollTop=0;
  }
});

test('wheel scrolling skips clipped content and only handles panels with overflow',t=>{
  const {ui,source,element,wheel}=scrolling(t),creation=element(undefined,{id:'creation'}),preview=element(creation);
  for(const overflow of ['hidden','clip','visible']) {
    preview.style.overflowY=overflow;creation.scrollTop=0;
    wheel(preview);assert.equal(preview.scrollTop,0);assert.equal(creation.scrollTop,60);
  }
  creation.scrollTop=0;creation.clientHeight=creation.scrollHeight;ui.layers.get(creation).dirty=false;
  assert.equal(wheel(preview).prevented,false);assert.equal(ui.layers.get(creation).dirty,false);
  creation.clientHeight=100;wheel(preview);assert.equal(creation.scrollTop,60,'resizing back to an overflowing layout re-enables scrolling');
  assert.equal(wheel(source).prevented,false,'the overlay itself must not consume world input');
});

test('wheel scrolling supports line and page units, horizontal trackpads and Shift-wheel',t=>{
  const {element,wheel}=scrolling(t),panel=element(undefined,{scrollWidth:1000,scrollHeight:1000});panel.style.overflowX='auto';
  wheel(panel,{deltaMode:1,deltaY:3});assert.equal(panel.scrollTop,72);
  wheel(panel,{deltaMode:2,deltaY:1});assert.equal(panel.scrollTop,172);
  wheel(panel,{deltaMode:1,deltaX:2,deltaY:0});assert.equal(panel.scrollLeft,48);
  wheel(panel,{deltaMode:2,deltaY:1,shiftKey:true});assert.equal(panel.scrollLeft,248);assert.equal(panel.scrollTop,172);
  wheel(panel,{deltaX:12,deltaY:8,shiftKey:true});assert.equal(panel.scrollLeft,260);assert.equal(panel.scrollTop,180);
  panel.style.lineHeight='normal';wheel(panel,{deltaMode:1,deltaY:1});assert.equal(panel.scrollTop,204);
});

test('wheel handling preserves browser zoom, canceled events and native recovery controls',t=>{
  const {ui,element,wheel}=scrolling(t),panel=element();
  for(const extra of [{ctrlKey:true},{metaKey:true},{cancelable:false},{defaultPrevented:true},{deltaX:0,deltaY:0}]) {
    assert.equal(wheel(panel,extra).prevented,false);assert.equal(panel.scrollTop,0);
  }
  ui.lost=true;assert.equal(wheel(panel).prevented,false);assert.equal(panel.scrollTop,0);
  ui.lost=false;wheel(panel);assert.equal(panel.scrollTop,60);
});

function keyboard(t) {
  const listeners=new Map(),documentEvents=new Map(),actions=[];
  globals(t,{window:{addEventListener:(name,fn)=>listeners.set(name,fn)},document:{addEventListener:(name,fn)=>documentEvents.set(name,fn),querySelector:()=>null},navigator:{getGamepads:()=>[]}});
  const input=new Input({addEventListener(){}},a=>actions.push(a),()=>{});
  input.active=true;
  const key=(code,extra={})=>{const e={code,target:{tagName:'BUTTON'},preventDefault(){this.prevented=true;},...extra};documentEvents.get('keydown')(e);listeners.get('keydown')(e);return e;};
  return {input,actions,key,listeners,documentEvents};
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

test('R and right-stick click are unassigned during gameplay',t=>{
  const {input,actions,key}=keyboard(t),pad=standardPad();input.menu=false;
  navigator.getGamepads=()=>[pad];
  key('KeyR');pad.buttons[11].pressed=true;
  for(let i=0;i<3;i++)assert.deepEqual(input.sample(.016),{forward:0,strafe:0,jump:false,dash:false,sprint:false});
  assert.deepEqual(actions,[]);
  pad.buttons[11].pressed=false;input.sample(.016);pad.buttons[11].pressed=true;input.sample(.016);
  assert.deepEqual(actions,[],'pressing the stick again must remain unassigned');
  key('KeyH');pad.buttons[7].pressed=true;input.sample(.016);
  assert.deepEqual(actions,['medkit','ability:arc']);
});

test('chat and gestures open without submitting a focused HUD button or firing gameplay keys',t=>{
  const {input,actions,key}=keyboard(t);input.menu=false;
  assert.equal(key('Enter').prevented,true);key('KeyB');assert.deepEqual(actions,['chat','gestures']);
  for(const code of ['Enter','KeyB','Digit1','KeyW'])key(code,{target:{tagName:'INPUT'}});
  assert.deepEqual(actions,['chat','gestures']);assert.equal(input.sample(.016).forward,0);
  input.menu=true;
  for(const code of ['Enter','KeyB','Digit1','KeyW'])key(code);
  assert.deepEqual(actions,['chat','gestures']);assert.equal(input.sample(.016).forward,0);
});

test('expanded chat paints above the HUD and below modal dialogs',()=>{
  const ui=Object.create(WebGLUI.prototype);
  assert.ok(ui.order({id:'live-chat',dataset:{expanded:'true'}})>ui.order({id:'hotbar'}));
  assert.ok(ui.order({id:'live-chat',dataset:{expanded:'true'}})<ui.order({id:'panel-dialog'}));
});

test('controller navigation stays in expanded chat and B returns without moving or casting',t=>{
  const {input,actions}=keyboard(t);input.menu=true;
  const focused=[],clicked=[],buttons=Array.from({length:16},()=>({pressed:false}));
  const controls=[0,1].map(id=>({getClientRects:()=>[{}],focus(){document.activeElement=this;focused.push(id);},click(){clicked.push(id);}}));
  document.querySelector=selector=>selector==='#live-chat[data-expanded="true"]'?{querySelectorAll:()=>controls}:null;
  navigator.getGamepads=()=>[{id:'Standard',mapping:'standard',axes:[1,1,1,1],buttons}];
  input.sample(.016);assert.deepEqual(focused,[0]);
  buttons[0].pressed=true;input.sample(.016);assert.deepEqual(clicked,[0]);
  buttons[1].pressed=true;
  assert.deepEqual(input.sample(.016),{forward:0,strafe:0,jump:false,dash:false,sprint:false});
  assert.deepEqual(actions,['escape']);
});

function pointer(t) {
  const windowEvents=new Map(),canvasEvents=new Map(),documentEvents=new Map(),actions=[],looks=[],captures=new Set();
  globals(t,{window:{addEventListener:(name,fn)=>windowEvents.set(name,fn)},document:{addEventListener:(name,fn)=>documentEvents.set(name,fn),querySelector:()=>null},navigator:{getGamepads:()=>[]}});
  const canvas={addEventListener:(name,fn)=>canvasEvents.set(name,fn),getBoundingClientRect:()=>({left:0,top:0,right:800,bottom:600}),
    setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id),
    requestPointerLock(){assert.fail('mouse locking is forbidden');}};
  const input=new Input(canvas,(action,event)=>actions.push({action,event}),(x,y)=>looks.push([x,y]));input.active=true;input.menu=false;
  const emit=(name,extra={})=>{
    const event={pointerId:1,pointerType:'mouse',button:0,buttons:1,clientX:100,clientY:100,target:canvas,...extra};
    documentEvents.get(name)?.(event);
    (name==='pointerdown'||name==='dblclick'||name==='lostpointercapture'?canvasEvents:windowEvents).get(name)?.(event);
  };
  return {input,emit,actions,looks,captures,documentEvents};
}

test('mouse clicks select on release; repeated clicks never lock the cursor or fire',t=>{
  const {emit,actions,looks,captures}=pointer(t);
  emit('pointermove');assert.equal(looks.length,0);
  emit('pointerdown');assert.equal(actions.length,0);assert.equal(captures.size,0);
  emit('pointerup');emit('pointerdown');emit('pointerup');emit('dblclick');
  assert.deepEqual(actions.map(a=>a.action),['pick','pick']);assert.equal(looks.length,0);
  emit('pointerdown',{button:2,buttons:2});emit('pointerup',{button:2,buttons:0});
  assert.equal(actions.at(-1).action,'pick-activate');assert.equal(captures.size,0);
});

test('right drag rotates without selecting, even after returning to the start',t=>{
  const {emit,actions,looks}=pointer(t);
  emit('pointerdown',{button:2,buttons:2});
  emit('pointermove',{buttons:2,clientX:140,clientY:120});
  assert.deepEqual(looks[0],[.1,.05]);
  emit('pointermove',{buttons:2});emit('pointerup',{button:2,buttons:0});
  assert.equal(actions.length,0);
  const count=looks.length;emit('pointermove',{buttons:0,clientX:200});assert.equal(looks.length,count);
  emit('pointerdown');emit('pointermove',{clientX:180});emit('pointerup',{clientX:180});
  assert.equal(actions.length,0);assert.equal(looks.length,count,'left drag never rotates the camera');
});

test('touch taps select while touch drags only look and release pointer capture',t=>{
  const {emit,actions,looks,captures}=pointer(t);
  emit('pointerdown',{pointerType:'touch'});assert.equal(captures.size,1);
  emit('pointerup',{pointerType:'touch'});assert.equal(actions[0].action,'pick');assert.equal(captures.size,0);
  emit('pointerdown',{pointerType:'touch'});emit('pointermove',{pointerType:'touch',clientX:130});
  emit('pointerup',{pointerType:'touch',clientX:130});assert.equal(actions.length,1);assert.equal(looks.length,1);assert.equal(captures.size,0);
});

test('cancellation, focus loss, menus, and unrelated pointers cannot leave dragging or activate UI',t=>{
  const {input,emit,actions,looks,captures,documentEvents}=pointer(t);
  emit('pointerdown',{button:2,buttons:2});emit('pointerup',{pointerId:2,button:2});assert.ok(input.drag);
  emit('pointermove',{pointerId:2,buttons:2,clientX:140});assert.equal(looks.length,0);
  emit('pointercancel');assert.equal(input.drag,null);emit('pointerup',{button:2});assert.equal(actions.length,0);
  emit('pointerdown',{button:2,buttons:2});emit('pointermove',{buttons:0});assert.equal(input.drag,null);
  emit('pointerdown');emit('blur');emit('pointerup');assert.equal(actions.length,0);
  emit('pointerdown',{pointerType:'touch'});globalThis.document.hidden=true;documentEvents.get('visibilitychange')();assert.equal(captures.size,0);
  emit('pointerdown');input.menu=true;emit('pointerup');assert.equal(actions.length,0);
  emit('pointerdown');assert.equal(input.drag,null);input.menu=false;
  emit('pointerdown');emit('pointerup',{target:{tagName:'BUTTON'}});assert.equal(actions.length,0);
  emit('pointerdown',{clientX:799});emit('pointerup',{clientX:801});assert.equal(actions.length,0);
  emit('pointerdown',{pointerType:'touch'});emit('lostpointercapture');assert.equal(input.drag,null);
});

function standardPad(index=0) {
  return {id:'Standard',index,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false}))};
}
function assertLook(looks,expected,message) {
  const actual=looks.at(-1);
  assert.ok(actual?.length===2&&actual.every((value,i)=>Math.abs(value-expected[i])<1e-12),message||`expected look ${expected}, got ${actual}`);
}
function calibrateLook(input,pad,move){
  input.menu=true;input.sample(.02);
  const samples=[[-1,0],[1,0],[0,-1],[0,1],[0,0]].map(([x,y])=>{move(x,y);return input.controllerSnapshot();});
  const saved=input.saveControllerLook(samples);input.sample(.02);input.menu=false;
  return {saved,samples};
}

test('calibrated extra axes look in every direction without casting their trigger aliases',t=>{
  const {input,actions,looks}=pointer(t),pad=standardPad();pad.id='358a-0203-Backbone One';pad.axes=[0,0,0,0,0,0,-1,-1];
  navigator.getGamepads=()=>[pad];
  const move=(x,y)=>{pad.axes[4]=x;pad.axes[5]=y;pad.buttons[6]={pressed:x<-.5,value:x<-.5?1:0};pad.buttons[7]={pressed:y<-.5,value:y<-.5?1:0};};
  move(-1,0);input.sample(.02);assert.equal(actions[0].action,'ability:aegis','reproduce the reported shield conflict');assertLook(looks,[0,0]);
  calibrateLook(input,pad,move);actions.length=0;
  for(const [x,y]of [[-1,0],[1,0],[0,-1],[0,1],[-1,1],[0,0]]){
    move(x,y);assert.deepEqual(input.sample(.02),{forward:0,strafe:0,jump:false,dash:false,sprint:false});assertLook(looks,[x*.046,y*.036]);
    input.sample(.02);assertLook(looks,[x*.046,y*.036],'held look remains continuous');
  }
  assert.deepEqual(actions,[],'stick aliases must never cast shield or shoot');
  move(.1,-.1);pad.axes[0]=1;pad.axes[1]=-1;assert.equal(input.sample(.02).forward,1);assertLook(looks,[0,0]);
  pad.buttons[4].pressed=true;input.sample(.02);assert.equal(actions.at(-1).action,'ability:surge','unrelated buttons retain their bindings');
});

test('analog buttons can provide inverted two-axis look without triggering abilities',t=>{
  const {input,actions,looks}=pointer(t),pad=standardPad();navigator.getGamepads=()=>[pad];
  const move=(x,y)=>{pad.buttons[6]={value:(1-x)/2,pressed:x<.8};pad.buttons[7]={value:(y+1)/2,pressed:y>-.8};};
  calibrateLook(input,pad,move);
  for(const [x,y]of [[-1,0],[1,-1],[0,1],[0,0]]){move(x,y);input.sample(.02);assertLook(looks,[x*.046,y*.036]);}
  assert.deepEqual(actions,[]);
  move(-.585,.585);input.sample(.02);assertLook(looks,[-.023,.018],'analog strength retains proportional camera speed');
  looks.length=0;for(let i=0;i<50;i++)input.sample(.02);
  const slow=looks.reduce(([x,y],[dx,dy])=>[x+dx,y+dy],[0,0]);looks.length=0;
  for(let i=0;i<100;i++)input.sample(.01);
  assertLook([looks.reduce(([x,y],[dx,dy])=>[x+dx,y+dy],[0,0])],slow,'calibrated look remains independent of frame rate');
});

test('directional button look works and cannot navigate menus or cast abilities',t=>{
  const {input,actions,looks}=pointer(t),pad=standardPad();navigator.getGamepads=()=>[pad];
  const move=(x,y)=>{for(const [i,pressed]of [[6,x<0],[7,x>0],[14,y<0],[15,y>0]])pad.buttons[i]={pressed,value:Number(pressed)};};
  calibrateLook(input,pad,move);move(-1,1);input.sample(.02);assertLook(looks,[-.046,.036]);assert.deepEqual(actions,[]);
  input.menu=true;looks.length=0;let focused=0;
  document.querySelector=s=>s==='dialog[open]'?{querySelectorAll:()=>[{getClientRects:()=>[{}],focus(){focused++;}}]}:null;
  move(1,-1);input.sample(.02);assert.equal(focused,0);assert.deepEqual(looks,[]);
  input.menu=false;input.sample(.02);assertLook(looks,[.046,-.036]);assert.deepEqual(actions,[]);
});

test('look preferences survive reload and a changed controller slot, and reset restores defaults',t=>{
  const {input,looks}=pointer(t),pad=standardPad(),storage=new Map();pad.axes=[0,0,0,0,0,0];
  globals(t,{localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}});
  navigator.getGamepads=()=>[pad];
  const move=(x,y)=>{pad.axes[4]=x;pad.axes[5]=y;};
  assert.equal(calibrateLook(input,pad,move).saved,true);assert.ok(storage.has(controllerLookStorage));
  const restored=new Input(input.canvas,()=>{},(x,y)=>looks.push([x,y]));restored.menu=false;
  pad.index=2;navigator.getGamepads=()=>[null,null,pad];restored.sample(.02);
  move(-1,1);restored.sample(.02);assertLook(looks,[-.046,.036]);
  const other=standardPad();other.id='Another controller';other.axes=[0,0,1,-1,1,1];
  navigator.getGamepads=()=>[other];restored.sample(.02);assertLook(looks,[.046,-.036],'a different controller keeps its own layout');
  navigator.getGamepads=()=>[pad];move(0,0);restored.sample(.02);restored.resetControllerLook();
  move(-1,1);restored.sample(.02);assertLook(looks,[0,0]);assert.deepEqual(JSON.parse(storage.get(controllerLookStorage)),[]);
});

test('restored button look waits for center on connection and follows activity on the correct pad',t=>{
  const {input,actions,looks}=pointer(t),pad=standardPad(2),idle=standardPad();pad.id='Backbone';
  let pads=[null,null,pad];navigator.getGamepads=()=>pads;
  const move=(x,y)=>{pad.buttons[6]={value:(x+1)/2,pressed:x>-.8};pad.buttons[7]={value:(y+1)/2,pressed:y>-.8};};
  calibrateLook(input,pad,move);
  pads=[];input.sample(.02);
  pads=[idle,null,pad];move(-1,-1);input.sample(.02);assertLook(looks,[0,0],'uninitialized or held inputs cannot turn on reconnect');
  move(0,0);input.sample(.02);move(-1,1);input.sample(.02);
  assert.equal(input.padIndex,2);assertLook(looks,[-.046,.036]);assert.deepEqual(actions,[]);
  input.lastDevice='keyboard';input.sample(.02);assert.equal(input.lastDevice,'keyboard','holding a stick is not new prompt activity');
});

test('bad calibration and unavailable storage preserve usable input',t=>{
  const {input,looks}=pointer(t),pad=standardPad();navigator.getGamepads=()=>[pad];
  globals(t,{localStorage:{getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}}});
  const move=(x,y)=>{pad.axes[2]=x;pad.axes[3]=y;};
  const {samples,saved}=calibrateLook(input,pad,move);assert.equal(saved,false);
  const key=controllerLookKey(pad),profile=input.padLookProfiles.get(key);
  assert.throws(()=>input.saveControllerLook(Array(5).fill(samples[4])),/all four directions/);
  assert.throws(()=>input.saveControllerLook(samples.map((s,i)=>i===2?{...s,key:'another device'}:s)),/same controller/);
  assert.equal(input.padLookProfiles.get(key),profile,'failed calibration must keep the previous working mapping');
  move(1,-1);input.sample(.02);assertLook(looks,[.046,-.036]);
  const restored=new Input(input.canvas,()=>{},(x,y)=>looks.push([x,y]));restored.menu=false;restored.sample(.02);assertLook(looks,[.046,-.036]);
  for(const invalid of [null,{}, {bindings:[null,null,null,null],buttons:[]}, {bindings:profile.bindings.map(b=>({...b,index:99})),buttons:[]}]){
    restored.padLookProfiles.set(key,invalid);restored.sample(.02);assertLook(looks,[.046,-.036],'invalid saved settings fall back to normal look');
  }
  navigator.getGamepads=()=>[];assert.throws(()=>input.controllerSnapshot(),/Connect your controller/);
  navigator.getGamepads=()=>{throw new Error('policy');};assert.doesNotThrow(()=>input.sample(.02));
});

test('Settings completes right-stick setup using controller confirmation and supports cancel and reset',async t=>{
  const {input,actions,looks}=pointer(t),pad=standardPad(),nodes=new Map(),storage=new Map();pad.axes=[0,0,0,0,0,0];
  globals(t,{localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}});
  navigator.getGamepads=()=>[pad];input.sample(.02);
  const node=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{listeners:new Map(),open:false,hidden:false,textContent:'',innerHTML:'',dataset:{},querySelectorAll:()=>[],
      addEventListener(k,fn){this.listeners.set(k,fn);},setAttribute(){},focus(){document.activeElement=this;},showModal(){this.open=true;},close(){this.open=false;}});
    return nodes.get(selector);
  };
  document.querySelector=s=>s==='.ui-select'?null:s==='dialog[open]'?(node('#panel-dialog').open?node('#panel-dialog'):null):node(s);
  document.querySelectorAll=()=>[];
  const context={fixtureInput:input,document,window,inputPrompt,updateInputPrompts,esc:s=>s,matchMedia:()=>({matches:false}),WorldClock:class{},setTimeout(){},clearTimeout(){}};
  let source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'');source=source.slice(0,source.lastIndexOf('boot().catch'));
  runInNewContext(source+`\ninput=fixtureInput;audio={enabled:false,narration:false,voiceMessage:'',stopVoice(){}};renderer={quality:1,volumetric:true};state='playing';wireEvents();globalThis.harness={showSettings,closePanel};`,context);
  const click=action=>node('#dialog-content').listeners.get('click')({target:{closest:()=>({dataset:{do:action}})}});
  node('#controller-look-next').click=()=>click('controller-look-next');
  context.harness.showSettings();assert.match(node('#dialog-content').innerHTML,/SET UP RIGHT STICK/);
  await click('controller-look');assert.equal(input.calibratingLook,true);
  for(const [x,y]of [[-1,0],[1,0],[0,-1],[0,1],[0,0]]){
    pad.axes[4]=x;pad.axes[5]=y;pad.buttons[6]={pressed:x<0,value:Number(x<0)};
    pad.buttons[0].pressed=false;input.sample(.02);pad.buttons[0].pressed=true;input.sample(.02);
  }
  assert.equal(input.calibratingLook,false);assert.match(node('#toast').textContent,/look saved/);assert.equal(input.padLookProfiles.size,1);
  assert.deepEqual(actions,[]);assert.ok(storage.has(controllerLookStorage));
  context.harness.closePanel();pad.buttons[0].pressed=false;input.sample(.02);
  pad.axes[4]=-1;pad.buttons[6]={pressed:true,value:1};input.sample(.02);assertLook(looks,[-.046,0]);assert.deepEqual(actions,[]);
  context.harness.showSettings();await click('controller-look');context.harness.closePanel();assert.equal(input.calibratingLook,false);assert.equal(input.padLookProfiles.size,1);
  context.harness.showSettings();await click('controller-look-reset');assert.equal(input.padLookProfiles.size,0);
});

test('right stick looks continuously and independently of left-stick movement',t=>{
  const {input,looks}=pointer(t),pad=standardPad();pad.axes=[0,0,1,-1];
  navigator.getGamepads=()=>[pad];
  const idle={forward:0,strafe:0,jump:false,dash:false,sprint:false};
  assert.deepEqual(input.sample(.02),idle);
  assertLook(looks,[.046,-.036]);
  input.sample(.02);assertLook(looks,[.046,-.036],'holding the right stick keeps turning');
  pad.axes=[1,-1,-1,1];
  assert.deepEqual(input.sample(.02),{...idle,forward:1,strafe:1});
  assertLook(looks,[-.046,.036],'moving and looking work together in both directions');
  pad.axes=[1,-1,.16,-.16];input.sample(.02);
  assert.deepEqual(looks.at(-1),[0,0],'left-stick movement and right-stick drift do not turn the camera');
  pad.axes=[0,0,1,-1];looks.length=0;
  for(let i=0;i<50;i++)input.sample(.02);
  const slow=looks.reduce(([x,y],[dx,dy])=>[x+dx,y+dy],[0,0]);looks.length=0;
  for(let i=0;i<100;i++)input.sample(.01);
  const fast=looks.reduce(([x,y],[dx,dy])=>[x+dx,y+dy],[0,0]);
  assert.ok(slow.every((value,i)=>Math.abs(value-fast[i])<1e-12),'turn speed is independent of frame rate');
});

test('right-stick activity selects a controller even when an idle controller appears first',t=>{
  const {input,looks}=pointer(t);
  const first=standardPad(),second=standardPad(2);
  navigator.getGamepads=()=>[first,null,second];
  input.sample(.02);assert.equal(input.padIndex,0);
  second.axes[2]=1;input.sample(.02);
  assert.equal(input.padIndex,2);assertLook(looks,[.046,0]);
  second.axes[3]=-1;input.sample(.02);assertLook(looks,[.046,-.036]);
  second.axes=[0,0,0,0];input.sample(.02);assert.equal(input.padIndex,2,'centering the stick retains the selected controller');
  first.axes[0]=.19;input.sample(.02);assert.equal(input.padIndex,2,'drift on another controller cannot take over');
  first.axes[2]=-1;input.sample(.02);
  assert.equal(input.padIndex,0);assertLook(looks,[-.046,0]);
});

test('controller selection follows fresh input without repeating held actions',t=>{
  const {input,actions,looks}=pointer(t);
  const first=standardPad(),second=standardPad(1);
  navigator.getGamepads=()=>[first,second];
  first.buttons[7].pressed=true;input.sample(.02);assert.equal(actions.length,1);
  second.axes[2]=1;input.sample(.02);assert.equal(input.padIndex,1,'fresh look input takes over from a held trigger');
  input.lastDevice='keyboard';input.sample(.02);assert.equal(input.lastDevice,'keyboard','held controls are not new device activity');
  first.axes[2]=-1;input.sample(.02);assert.equal(input.padIndex,0);
  assert.equal(actions.length,1,'switching back must not fire the held trigger again');
  first.connected=false;input.sample(.02);assert.equal(input.padIndex,1);assertLook(looks,[.046,0]);
  navigator.getGamepads=()=>[];looks.length=0;
  assert.equal(input.sample(.02).forward,0);assert.equal(input.connected,'');assert.equal(looks.length,0);
  first.connected=true;first.buttons[7].pressed=false;first.axes=[0,0,0,0];navigator.getGamepads=()=>[first];
  input.sample(.02);first.buttons[7].pressed=true;input.sample(.02);
  assert.equal(actions.length,2,'reconnected controllers recognize new presses');
});

test('controller look pauses in menus and resumes when gameplay resumes',t=>{
  const {input,looks}=pointer(t),pad=standardPad();pad.axes=[1,-1,1,-1];
  navigator.getGamepads=()=>[pad];input.menu=true;
  assert.deepEqual(input.sample(.02),{forward:0,strafe:0,jump:false,dash:false,sprint:false});
  assert.equal(looks.length,0);
  input.menu=false;assert.equal(input.sample(.02).forward,1);assertLook(looks,[.046,-.036]);
});

test('connected controllers, held buttons and released controls do not steal keyboard prompts',t=>{
  const {input,key,actions}=keyboard(t),buttons=Array.from({length:16},()=>({pressed:false}));
  const pad={id:'Standard',index:0,mapping:'standard',axes:[0,0,0,0],buttons};
  navigator.getGamepads=()=>[pad];input.menu=false;
  input.sample(.016);assert.equal(input.connected,'Standard');assert.equal(input.lastDevice,'keyboard');
  buttons[7].pressed=true;input.sample(.016);assert.equal(input.lastDevice,'gamepad');assert.equal(actions.at(-1),'ability:arc');
  key('KeyW');assert.equal(input.lastDevice,'keyboard');
  assert.equal(input.sample(.016).forward,1);assert.equal(input.lastDevice,'keyboard','held trigger is not new activity');
  buttons[7].pressed=false;input.sample(.016);assert.equal(input.lastDevice,'keyboard');
  buttons[2].pressed=true;input.sample(.016);assert.equal(input.lastDevice,'gamepad');
  key('KeyW',{repeat:true});assert.equal(input.lastDevice,'gamepad','keyboard autorepeat is not a new device choice');
  input.menu=true;key('Tab');assert.equal(input.lastDevice,'keyboard','native menu navigation counts');
  buttons[2].pressed=false;buttons[7].pressed=true;input.sample(.016);assert.equal(input.lastDevice,'gamepad');
  key('KeyA',{target:{tagName:'INPUT'}});assert.equal(input.lastDevice,'keyboard','text entry counts');
});

test('sticks require deliberate activity, tolerate drift and jitter, and detect slow movement',t=>{
  const {input,key}=keyboard(t),pad={id:'Standard',index:0,mapping:'standard',axes:[0,0,0,0],buttons:[]};
  navigator.getGamepads=()=>[pad];
  for(const value of [.05,-.08,.16,.19,0]){pad.axes[0]=value;input.sample(.016);assert.equal(input.lastDevice,'keyboard');}
  for(let value=0;value<=.5;value+=.01){pad.axes[0]=value;input.sample(.016);}
  assert.equal(input.lastDevice,'gamepad','slow movement accumulates beyond the activity threshold');
  pad.axes[0]=.8;input.sample(.016);key('Tab');
  for(const value of [.8,.81,.79,.82,.8,0]){pad.axes[0]=value;input.sample(.016);assert.equal(input.lastDevice,'keyboard');}
  pad.axes[2]=-.7;input.sample(.016);assert.equal(input.lastDevice,'gamepad','looking counts as controller use');
  navigator.getGamepads=()=>[];input.sample(.016);assert.equal(input.lastDevice,'keyboard');
  pad.axes=[0,0,0,0];navigator.getGamepads=()=>[pad];input.sample(.016);assert.equal(input.lastDevice,'keyboard','reconnecting an idle pad does not change prompts');
  pad.axes[2]=-.7;input.sample(.016);assert.equal(input.lastDevice,'gamepad','reconnect clears the activity baseline');
});

test('pointer activity on HUDs and menus switches devices without reacting to jitter or synthetic keys',t=>{
  const {input,key,documentEvents}=keyboard(t);
  const emit=(name,extra={})=>documentEvents.get(name)({pointerType:'mouse',clientX:100,clientY:100,...extra});
  input.lastDevice='gamepad';
  emit('pointermove');emit('pointermove',{clientX:101});assert.equal(input.lastDevice,'gamepad');
  emit('pointermove',{clientX:104});assert.equal(input.lastDevice,'keyboard');
  input.lastDevice='gamepad';emit('pointerdown',{target:{tagName:'BUTTON'}});assert.equal(input.lastDevice,'keyboard');
  input.lastDevice='gamepad';emit('wheel',{deltaY:30});assert.equal(input.lastDevice,'keyboard');
  input.lastDevice='gamepad';emit('wheel',{deltaY:0});assert.equal(input.lastDevice,'gamepad');
  key('Escape',{isTrusted:false});assert.equal(input.lastDevice,'gamepad','controller-generated Escape must keep controller prompts');
  emit('pointerdown',{pointerType:'touch'});assert.equal(input.lastDevice,'touch');
  input.sample(.016);assert.equal(input.lastDevice,'touch','no controller must not force touch back to keyboard');
  key('KeyA',{isComposing:true,target:{tagName:'INPUT'}});assert.equal(input.lastDevice,'keyboard');
});

test('prompt badges match ability bindings and update existing nodes without losing focus',()=>{
  const abilities=JSON.parse(readFileSync(new URL('../data/abilities.json',import.meta.url)));
  const pads={arc:'RT',surge:'LB',mend:'RB',aegis:'LT',lance:'←',echo:'→',breach:'L3+↑',siphon:'L3+→',execute:'L3+↓',nova:'L3+←'};
  for(const ability of abilities){
    assert.equal(controlLabel(`ability:${ability.id}`),ability.key);
    assert.equal(controlLabel(`ability:${ability.id}`,'gamepad'),pads[ability.id]);
    assert.equal(controlLabel(`ability:${ability.id}`,'touch'),'');
  }
  const hint={dataset:{inputKeyboard:'Press E',inputGamepad:'Press X',inputTouch:'Tap USE'},textContent:''};
  const badge={dataset:{inputAction:'journal'},textContent:''},unbound={dataset:{inputAction:'inventory'},textContent:''};
  const sections=['keyboard','gamepad','touch'].map(inputDevice=>({dataset:{inputDevice},hidden:false}));
  const root={dataset:{},querySelectorAll:selector=>({'[data-input-keyboard]':[hint],'[data-input-action]':[badge,unbound],'[data-input-device]':sections})[selector]};
  updateInputPrompts(root,'gamepad');assert.equal(hint.textContent,'Press X');assert.equal(badge.textContent,'View');assert.equal(unbound.hidden,true);
  assert.deepEqual(sections.map(n=>n.hidden),[true,false,true]);
  updateInputPrompts(root,'touch');assert.equal(hint.textContent,'Tap USE');assert.equal(badge.hidden,true);
  updateInputPrompts(root,'keyboard');assert.equal(hint.textContent,'Press E');assert.equal(badge.textContent,'J');assert.equal(unbound.hidden,false);
  assert.match(inputPrompt('Use "E" & read','Press <X>','Tap USE'),/data-input-keyboard="Use &quot;E&quot; &amp; read"/);
  assert.doesNotMatch(inputPrompt('Use "E" & read','Press <X>','Tap USE'),/<X>/);
});

function form(action,values) {
  const elements=Object.entries(values).map(([name,value])=>({name,value:typeof value==='object'?value.value:value,type:typeof value==='object'?value.type:'text'}));
  elements.namedItem=name=>elements.find(f=>f.name===name);
  return {dataset:{communityForm:action},elements,querySelectorAll:()=>elements.filter(f=>f.type==='hidden')};
}
function social(t,forms=[]) {
  const c=Object.create(Community.prototype);let character={id:'runner-a'};
  globals(t,{document:{querySelectorAll:()=>forms,querySelector:()=>null}});
  Object.assign(c,{character:()=>character,owner:character.id,data:economyData,view:'chat',query:{},drafts:new Map(),pending:null,pendingDraft:null,busy:false,isOpen:()=>false});
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

test('auction listings, bids, and gifts submit exact integer thousandths while quantities stay whole',async t=>{
  const {c}=social(t),requests=[];
  globals(t,{FormData:class { constructor(form){return new Map(form.elements.map(f=>[f.name,f.value]));} }});
  c.mutate=async request=>requests.push(request);c.draftKey=()=> 'draft';
  for(const [action,values,expected] of [
    ['auction_list',{item:'medkit',quantity:'2',minimum:'0.009',buyout:'1.001',hours:'24'},{item:'medkit',quantity:2,minimum:9,buyout:1001,hours:24}],
    ['auction_bid',{auction:'17',amount:'0.011'},{auction:17,amount:11}],
    ['gift',{target:'neighbor',amount:'0.029'},{target:'neighbor',amount:29}],
    ['gift',{target:'neighbor',amount:'1000'},{target:'neighbor',amount:1000000}],
  ]) {
    const elements=Object.entries(values).map(([name,value])=>({name,value,dataset:['minimum','buyout','amount'].includes(name)?{gold:'',min:'1',max:'1000000'}:{},setCustomValidity:assert.fail,reportValidity:assert.fail}));
    const button={disabled:false},form={dataset:{communityForm:action},elements,querySelectorAll:()=>elements.filter(f=>f.dataset.gold!==undefined),querySelector:()=>button};
    await c.submit(form);assert.deepEqual(requests.at(-1),{action,...expected});assert.equal(button.disabled,false);
  }
  assert.equal(requests.length,4);
});

test('fractional gold controls reject subunit precision, invalid numbers, and out-of-range bids before sending',async t=>{
  const {c}=social(t);let invalid='',reported=false;
  const input={value:'',dataset:{gold:'',min:'11',max:'1000000'},setCustomValidity:value=>invalid=value,reportValidity:()=>reported=true};
  const form={querySelectorAll:()=>[input]};
  c.mutate=async()=>assert.fail('Invalid gold must not reach the server');
  for(const value of ['', '0', '-1', '0.01', '0.0111', '1000.001', '1e2', 'Infinity']) {
    input.value=value;reported=false;await c.submit(form);
    assert.equal(reported,true,value);assert.match(invalid,/0\.011 to 1000 in steps of 0\.001/);
  }
});

test('social rendering keeps all sections and permissioned guild management available',t=>{
  const {c}=social(t);let html='';
  Object.assign(c,{character:()=>({id:'runner-a',race:'human',gold:20,medkits:2}),races:[{id:'human',name:'Afterborn'}],showPanel:(_,value)=>html=value,summary:{deliveries:0,inbox:[],contacts:[],blocked:[],members:[],channels:['world','trade','race:human'],guildInvites:[],partyInvites:[]}});
  for(const view of ['chat','dm','guild','party','auctions','forum','people','deliveries']) {
    c.view=view;c.query={};c.render();
    for(const tab of ['chat','dm','guild','party','auctions','forum','people','deliveries'])assert.ok(html.includes(`data-view="${tab}"`));
    assert.ok(html.includes('community-main'));
  }
  c.summary.guild={id:7,name:'<Signal>',owner:'runner-a',members:{'runner-a':'leader','runner-b':'member'},tabard:{base:'#284d42',trim:'#c7ed99',pattern:'stripe',emblem:'signal'}};
  c.view='guild';c.render();
  assert.match(html,/unlock 0\.018 gold each day/);assert.match(html,/get 0\.036 gold instead/);
  for(const action of ['guild_invite','guild_promote','guild_transfer','guild_kick','guild_tabard','guild_leave','lineage_reward'])assert.ok(html.includes(action),action);
  assert.ok(html.includes('&lt;Signal&gt;'));assert.equal(html.includes('type="color"'),false);
  assert.ok(html.includes('data-social="swatch"'));
  c.summary.guild.owner='runner-b';c.summary.guild.members['runner-a']='member';c.render();
  for(const action of ['guild_promote','guild_transfer','guild_kick','guild_tabard'])assert.equal(html.includes(action),false,action);
  c.view='auctions';c.render();assert.ok(html.includes('inputmode="numeric"'));assert.ok(html.includes('data-min="1"'));assert.ok(html.includes('data-max="1000000"'));
  assert.match(html,/You have 0\.02 gold/);
  assert.match(html,/name="minimum" type="text" inputmode="decimal"[^>]*value="0\.01"/);
  assert.match(html,/name="buyout" type="text" inputmode="decimal"[^>]*value="0\.018"/);
  c.view='people';assert.match(c.rows({items:[{id:'neighbor',name:'Neighbor',race:'human'}]}),/name="amount" type="text" inputmode="decimal" data-gold/);
});

test('the entry route goes directly to the game and all game surfaces share WebGL rendering',()=>{
  const entry=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const page=readFileSync(new URL('../play.html',import.meta.url),'utf8');
  assert.match(entry,/http-equiv="refresh" content="0;url=\/play.html"/);
  assert.match(page,/<canvas id="interface" aria-hidden="true">/);
  for(const id of ['landing','creation','cinematic','hud','panel-dialog','toast'])assert.ok(page.indexOf(`id="${id}"`)>page.indexOf('id="interface-source"'));
  assert.equal(/<iframe|<webview|https?:\/\/.*(?:font|script)/i.test(page),false);
});
