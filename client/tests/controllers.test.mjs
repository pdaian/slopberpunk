// Browser-shaped input fixtures; all checks run in memory without browser profiles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { Input } from '../src/input.js';
import { inputPrompt, updateInputPrompts } from '../src/input-prompts.js';

const idle={forward:0,strafe:0,jump:false,dash:false,sprint:false};
const chrome='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36';
const firefox=version=>`Mozilla/5.0 (X11; Linux x86_64; rv:${version}.0) Gecko/20100101 Firefox/${version}.0`;
function globals(t,values){
  const previous=Object.fromEntries(Object.keys(values).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  for(const [key,value]of Object.entries(values))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  t.after(()=>{for(const [key,descriptor]of Object.entries(previous)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
}
function harness(t,userAgent=chrome){
  const windowEvents=new Map(),documentEvents=new Map(),actions=[],looks=[];
  let pads=[];
  globals(t,{window:{addEventListener:(name,fn)=>windowEvents.set(name,fn)},
    document:{hidden:false,hasFocus:()=>true,addEventListener:(name,fn)=>documentEvents.set(name,fn),querySelector:()=>null},
    navigator:{userAgent,platform:'Linux x86_64',getGamepads(){assert.equal(this,navigator);return pads;}}});
  const input=new Input({addEventListener(){}},action=>actions.push(action),(x,y)=>looks.push([x,y]));
  input.active=true;input.menu=false;
  return {input,actions,looks,windowEvents,documentEvents,setPads:value=>{pads=value;}};
}
function standard(index=0){return {id:'Standard controller',index,mapping:'standard',connected:true,timestamp:0,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};}
function down(pad,index,value=1){pad.buttons[index]={pressed:value>.5,value};}
function look(looks,x,y){const actual=looks.at(-1);assert.ok(actual&&Math.abs(actual[0]-x)<1e-12&&Math.abs(actual[1]-y)<1e-12,`expected [${x}, ${y}], got ${actual}`);}

// Linux Backbone 358a:0203 layout from the SDL database and the browser
// implementations linked in COMPATIBILITY.md. These fixtures intentionally
// preserve raw button holes, hat axes, and Firefox's unused RX/RY slots.
const profiles=[
  {name:'Chrome standard',ua:chrome,type:'standard'},
  {name:'Firefox standard',ua:firefox(160),type:'standard'},
  {name:'Chrome raw Backbone',ua:chrome,type:'raw'},
  {name:'Firefox 140 Backbone',ua:firefox(140),type:'extra'},
  {name:'Firefox 150 Backbone',ua:firefox(150),type:'extra'},
  {name:'Firefox 151 Backbone',ua:firefox(151),type:'buttons'},
  {name:'Firefox 160 Backbone',ua:firefox(160),type:'buttons'},
];
function frame(profile,{left=[0,0],right=[0,0],buttons=[]}={}){
  const pad=standard();
  if(profile.type==='standard'){
    pad.axes=[...left,...right];for(const i of buttons)down(pad,i);return pad;
  }
  pad.id='358a-0203-Backbone One';
  if(profile.type==='raw'){
    pad.id='Backbone One (Vendor: 358a Product: 0203)';pad.mapping='';
    pad.buttons=Array.from({length:15},()=>({pressed:false,value:0}));
    pad.axes=[...left,...right,buttons.includes(7)?1:-1,buttons.includes(6)?1:-1,0,0];
    for(const [logical,raw]of [[0,0],[1,1],[2,3],[3,4],[4,6],[5,7],[8,10],[9,11],[10,13],[11,14]])if(buttons.includes(logical))down(pad,raw);
    pad.axes[6]=Number(buttons.includes(15))-Number(buttons.includes(14));
    pad.axes[7]=Number(buttons.includes(13))-Number(buttons.includes(12));
  }else{
    pad.buttons=Array.from({length:19},()=>({pressed:false,value:0}));
    pad.axes=[...left,0,0,...(profile.type==='extra'?right:[0,0]),buttons.includes(7)?1:-1,buttons.includes(6)?1:-1];
    // BTN_NORTH (physical X) is Firefox button 3; BTN_WEST (Y) is button 2.
    for(const i of buttons)if(i!==6&&i!==7)down(pad,i===2?3:i===3?2:i);
    if(profile.type==='buttons')for(let i=0;i<2;i++){
      const value=(right[i]+1)/2;pad.buttons[6+i]={value,pressed:value>.1};
    }
  }
  return pad;
}

for(const profile of profiles){
  test(`${profile.name}: camera is continuous, proportional and independent of movement and triggers`,t=>{
    const {input,actions,looks,setPads}=harness(t,profile.ua);
    const sample=controls=>{setPads([Object.freeze(frame(profile,controls))]);return input.sample(.02);};
    sample();assert.equal(input.lastDevice,'keyboard','idle sticks and released triggers are not controller activity');
    for(const right of [[-1,0],[1,0],[0,-1],[0,1],[-1,1],[1,-1],[0,0]]){
      assert.deepEqual(sample({right}),idle);look(looks,right[0]*.046,right[1]*.036);
      input.sample(.02);look(looks,right[0]*.046,right[1]*.036);
    }
    assert.deepEqual(actions,[],'looking alone must not cast any ability');
    sample({right:[.585,-.585]});look(looks,.023,-.018);
    sample({right:[.16,-.16]});look(looks,0,0);
    assert.deepEqual(sample({left:[1,-1],right:[1,-1],buttons:[6,7,10]}),{...idle,forward:1,strafe:1,sprint:true});
    look(looks,.046,-.036);assert.deepEqual(actions,['ability:aegis','ability:arc']);
    sample({buttons:[6,7]});look(looks,0,0);assert.equal(actions.length,2,'held triggers fire once');
    sample();sample({buttons:[7]});assert.equal(actions.at(-1),'ability:arc');
    assert.equal(input.lastDevice,'gamepad');assert.equal(input.connected,frame(profile).id);
  });

  test(`${profile.name}: face buttons, shoulders, menus, D-pad and modifiers retain their bindings`,t=>{
    const {input,actions,setPads}=harness(t,profile.ua);
    const sample=buttons=>{setPads([frame(profile,{buttons})]);return input.sample(.02);};
    for(const [i,action]of [[2,'interact'],[3,'target'],[4,'ability:surge'],[5,'ability:mend'],[6,'ability:aegis'],[7,'ability:arc'],[8,'journal'],[9,'settings'],[12,'medkit'],[13,'map'],[14,'ability:lance'],[15,'ability:echo']]){
      sample([]);sample([i]);assert.equal(actions.at(-1),action);
      const count=actions.length;sample([i]);assert.equal(actions.length,count,'button holds do not repeat gameplay actions');
    }
    sample([]);assert.equal(sample([0]).jump,true);assert.equal(sample([0]).jump,false);
    sample([]);assert.equal(sample([1]).dash,true);assert.equal(sample([1]).dash,false);
    sample([]);assert.equal(sample([10]).sprint,true);assert.equal(sample([10]).sprint,true);
    for(const [i,action]of [[12,'ability:breach'],[15,'ability:siphon'],[13,'ability:execute'],[14,'ability:nova']]){sample([]);sample([10,i]);assert.equal(actions.at(-1),action);}
    sample([]);const count=actions.length;sample([11]);assert.equal(actions.length,count,'right-stick click is unassigned');
  });
}

test('Firefox button look ignores uninitialized zero reports and resets on disconnection',t=>{
  const {input,actions,looks,setPads,windowEvents}=harness(t,firefox(160));
  const pad=frame(profiles.at(-1));down(pad,6,0);down(pad,7,0);setPads([pad]);
  input.sample(.02);look(looks,0,0);assert.deepEqual(actions,[]);
  down(pad,6,.5);input.sample(.02);look(looks,0,0);
  down(pad,6,0);input.sample(.02);look(looks,-.046,0);
  down(pad,7,1);input.sample(.02);look(looks,-.046,.036);
  windowEvents.get('gamepaddisconnected')({gamepad:pad});assert.equal(input.connected,'');
  down(pad,7,0);input.sample(.02);look(looks,0,0);
  down(pad,6,.5);down(pad,7,.5);input.sample(.02);look(looks,0,0);
  down(pad,6,1);down(pad,7,0);input.sample(.02);look(looks,.046,-.036);assert.deepEqual(actions,[]);
});

test('Backbone exceptions do not replace correct standard mappings or unrelated extra axes',t=>{
  const {input,looks,actions,setPads}=harness(t,firefox(160));
  for(const id of ['358a-0203-Backbone One','358A-0204-Backbone One','358a-0102-Backbone One','358a-0202-Backbone One']){
    const pad=standard();pad.id=id;pad.axes=[0,0,1,-1];setPads([pad]);input.sample(.02);look(looks,.046,-.036);
  }
  for(const id of ['1234-0203-Unrelated','358a-ffff-Unknown product']){
    const pad=standard();pad.id=id;pad.axes=[0,0,-1,1,1,-1,0,0];down(pad,6);setPads([pad]);input.sample(.02);
    look(looks,-.046,.036);assert.equal(actions.at(-1),'ability:aegis');
  }
  navigator.userAgent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/160.0';navigator.platform='Win32';
  const pad=standard();pad.id='358a-0203-Backbone One';pad.axes=[0,0,-1,1,1,-1,0,0];setPads([pad]);input.sample(.02);look(looks,-.046,.036);
});

test('raw mapping requires a matching device, desktop Linux backend and layout shape',t=>{
  const {input,setPads}=harness(t);
  for(const patch of [{id:'Unknown controller'},{id:'Backbone One (Vendor: 358a Product: ffff)'},{axes:[0,0,0,0]},{buttons:[]}]){
    setPads([{...frame(profiles[2]),...patch}]);assert.deepEqual(input.sample(.02),idle);assert.equal(input.connected,'');assert.match(input.controllerStatus,/layout is not supported/);
  }
  navigator.userAgent='Mozilla/5.0 (Linux; Android 15) Chrome/145.0.0.0';setPads([frame(profiles[2])]);input.sample(.02);assert.equal(input.connected,'');
});

test('polling handles delayed discovery, sparse slots, fresh snapshots, policy denial and unavailable APIs',t=>{
  const {input,actions,looks,setPads}=harness(t),pad=standard(3);
  input.sample(.02);assert.match(input.controllerStatus,/press a controller button/);
  pad.axes[2]=1;setPads([null,null,null,pad]);input.sample(.02);assert.equal(input.padIndex,3);look(looks,.046,0);
  const replacement={...pad,axes:[0,0,-1,0]};setPads([null,null,null,replacement]);input.sample(.02);look(looks,-.046,0);
  down(replacement,7);input.sample(.02);assert.deepEqual(actions,['ability:arc']);
  replacement.connected=false;input.sample(.02);assert.equal(input.connected,'');assert.equal(input.padIndex,null);
  navigator.getGamepads=()=>{throw new DOMException('Blocked by Permissions Policy','SecurityError');};
  assert.deepEqual(input.sample(.02),idle);assert.match(input.controllerStatus,/access is blocked/);
  delete navigator.getGamepads;globals(t,{isSecureContext:false});input.sample(.02);assert.match(input.controllerStatus,/HTTPS or localhost/);
  globalThis.isSecureContext=true;input.sample(.02);assert.match(input.controllerStatus,/does not expose/);
});

test('invalid analog data cannot produce NaN movement, look or actions',t=>{
  const {input,looks,actions,setPads}=harness(t),pad=standard();
  pad.axes=[NaN,Infinity,undefined,-Infinity];pad.buttons[6]={value:NaN,pressed:false};setPads([pad]);
  assert.deepEqual(input.sample(.02),idle);look(looks,0,0);assert.deepEqual(actions,[]);
  pad.axes=[9,-9,9,-9];assert.deepEqual(input.sample(.02),{...idle,forward:1,strafe:1});look(looks,.046,-.036);
});

test('analog trigger hysteresis prevents repeated abilities near the press threshold',t=>{
  const {input,actions,setPads}=harness(t),pad=standard();setPads([pad]);
  for(const value of [0,.1,.4,.5,.56,.54,.5,.46,.54,.7]){down(pad,7,value);input.sample(.02);}
  assert.deepEqual(actions,['ability:arc']);
  for(const value of [.44,.5,.56]){down(pad,7,value);input.sample(.02);}
  assert.deepEqual(actions,['ability:arc','ability:arc']);
});

test('blur and hidden pages stop all input and do not replay buttons pressed while away',t=>{
  const {input,actions,looks,setPads,windowEvents,documentEvents}=harness(t),pad=standard();setPads([pad]);
  pad.axes=[1,-1,1,-1];input.sample(.02);looks.length=0;
  windowEvents.get('blur')();down(pad,0);down(pad,7);
  assert.deepEqual(input.sample(.02),idle);assert.deepEqual(actions,[]);assert.deepEqual(looks,[]);
  windowEvents.get('focus')();assert.equal(input.sample(.02).jump,false);assert.deepEqual(actions,[]);
  down(pad,0,0);down(pad,7,0);input.sample(.02);down(pad,7);input.sample(.02);assert.deepEqual(actions,['ability:arc']);
  document.hidden=true;documentEvents.get('visibilitychange')();down(pad,2);looks.length=0;
  assert.deepEqual(input.sample(.02),idle);assert.deepEqual(looks,[]);
  document.hidden=false;documentEvents.get('visibilitychange')();input.sample(.02);assert.deepEqual(actions,['ability:arc']);
  // requestAnimationFrame can be completely paused between blur and focus.
  down(pad,2,0);input.sample(.02);windowEvents.get('blur')();down(pad,2);windowEvents.get('focus')();input.sample(.02);
  assert.deepEqual(actions,['ability:arc']);
  input.active=false;assert.deepEqual(input.sample(.02),idle);
});

function menu(controls,selector='dialog[open]'){
  const container={querySelectorAll:()=>controls};document.querySelector=s=>s===selector?container:null;return container;
}
function control(extra={}){return {tagName:'BUTTON',getClientRects:()=>[{}],focus(){document.activeElement=this;},click(){this.clicks=(this.clicks||0)+1;},...extra};}

test('menu navigation repeats holds, recognizes rapid taps and activates only visible controls in the active menu',t=>{
  const {input,setPads,actions}=harness(t),pad=standard(),controls=[control(),control(),control()];setPads([pad]);input.menu=true;
  menu([...controls,control({disabled:true}),control({getClientRects:()=>[]})]);
  document.activeElement=control();
  down(pad,12);input.sample(.02);assert.equal(document.activeElement,controls[2],'backward navigation starts at the last control');
  down(pad,12,0);down(pad,13);input.sample(.02);assert.equal(document.activeElement,controls[0]);
  input.sample(.1);assert.equal(document.activeElement,controls[0]);input.sample(.26);assert.equal(document.activeElement,controls[1]);
  down(pad,13,0);input.sample(.01);down(pad,13);input.sample(.01);assert.equal(document.activeElement,controls[2],'a quick second tap is not throttled');
  down(pad,13,0);down(pad,0);input.sample(.02);input.sample(.02);assert.equal(controls[2].clicks,1);
  pad.axes[2]=1;pad.axes[3]=-1;input.sample(1);assert.equal(document.activeElement,controls[2],'right stick never navigates');
  assert.deepEqual(actions,[]);
  menu([]);document.activeElement=control();down(pad,0,0);input.sample(.02);down(pad,0);input.sample(.02);assert.equal(document.activeElement.clicks,undefined);
});

test('left stick navigates menus and D-pad left/right changes the focused slider',t=>{
  const {input,setPads}=harness(t),pad=standard(),events=[];
  const slider=control({tagName:'INPUT',type:'range',value:'0.0025',min:'0.001',max:'0.006',step:'0.0005',dispatchEvent:e=>events.push(e.type)}),other=control();
  menu([slider,other]);setPads([pad]);input.menu=true;
  pad.axes[0]=1;input.sample(.02);assert.equal(document.activeElement,slider);
  pad.axes[0]=0;input.sample(.02);down(pad,15);input.sample(.02);assert.equal(slider.value,'0.003');assert.deepEqual(events,['input','change']);
  down(pad,15,0);pad.axes[1]=1;input.sample(.02);assert.equal(document.activeElement,other);
  pad.axes[1]=0;down(pad,0);input.sample(.02);assert.equal(other.clicks,1);
});

test('menu close and open consume their frame and held buttons never leak into gameplay',t=>{
  const {input,setPads,actions,looks}=harness(t),pad=standard(),confirm=control({click(){input.menu=false;input.clear();}});
  menu([confirm]);setPads([pad]);input.menu=true;pad.axes=[1,-1,1,-1];down(pad,0);down(pad,7);
  assert.deepEqual(input.sample(.02),idle);assert.equal(input.menu,false);assert.deepEqual(actions,[]);assert.deepEqual(looks,[]);
  assert.equal(input.sample(.02).jump,false);assert.deepEqual(actions,[]);
  down(pad,0,0);down(pad,7,0);input.sample(.02);looks.length=0;
  input.onAction=action=>{actions.push(action);if(action==='settings'){input.menu=true;input.clear();}};
  down(pad,9);down(pad,7);down(pad,0);assert.deepEqual(input.sample(.02),idle);assert.deepEqual(actions,['settings']);assert.deepEqual(looks,[]);
  input.onAction=action=>{actions.push(action);input.menu=false;input.clear();};
  down(pad,1);assert.deepEqual(input.sample(.02),idle);assert.equal(actions.at(-1),'escape');
  assert.equal(input.sample(.02).dash,false);assert.deepEqual(actions,['settings','escape']);
});

test('B closes a custom select before its parent dialog and preserves controller prompts',t=>{
  const {input,setPads,actions}=harness(t),pad=standard(),events=[];
  globals(t,{KeyboardEvent:class extends Event{constructor(type,options){super(type,options);this.key=options.key;this.code=options.code;}}});
  const option=control({dispatchEvent:e=>events.push([e.type,e.key,e.bubbles,e.cancelable])});menu([option],'.ui-select');document.activeElement=option;
  input.menu=true;setPads([pad]);down(pad,1);input.sample(.02);
  assert.deepEqual(events,[['keydown','Escape',true,true]]);assert.deepEqual(actions,[]);assert.equal(input.lastDevice,'gamepad');
});

test('camera speed respects Settings and elapsed time; legacy calibration storage is never consulted',t=>{
  let storageReads=0;globals(t,{localStorage:{getItem(){storageReads++;throw new Error('Legacy calibration must not load');},setItem(){assert.fail('No calibration preferences should be written');}}});
  const {input,looks,setPads}=harness(t);setPads([standard()]);
  const pad=standard();pad.axes=[0,0,1,-1];setPads([pad]);input.sensitivity=.005;
  input.sample(.02);look(looks,.092,-.072);looks.length=0;
  for(let i=0;i<50;i++)input.sample(.02);const slow=looks.reduce(([x,y],[dx,dy])=>[x+dx,y+dy],[0,0]);looks.length=0;
  for(let i=0;i<100;i++)input.sample(.01);const fast=looks.reduce(([x,y],[dx,dy])=>[x+dx,y+dy],[0,0]);
  look([fast],...slow);assert.equal(storageReads,0);
});

test('Settings renders connection status and camera speed without a calibration workflow',t=>{
  const {input,setPads}=harness(t),nodes=new Map();setPads([standard()]);input.sample(.02);
  const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{open:false,innerHTML:'',textContent:'',dataset:{},querySelectorAll:()=>[],setAttribute(){},focus(){document.activeElement=this;},showModal(){this.open=true;}});return nodes.get(selector);};
  document.querySelector=node;document.querySelectorAll=()=>[];
  const context={fixtureInput:input,document,inputPrompt,updateInputPrompts,esc:s=>s,matchMedia:()=>({matches:false}),WorldClock:class{}};
  let source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'');source=source.slice(0,source.lastIndexOf('boot().catch'));
  runInNewContext(source+`\ninput=fixtureInput;audio={enabled:false,narration:false,voiceMessage:'',stopVoice(){}};renderer={quality:1,volumetric:true};showSettings();`,context);
  const html=node('#dialog-content').innerHTML;
  assert.match(html,/Controller connected\./);assert.match(html,/id="controller-status"/);assert.match(html,/Camera turn speed/);
  assert.doesNotMatch(html,/calibrat|SET UP RIGHT STICK|RESET RIGHT STICK|controller-look/i);
});
