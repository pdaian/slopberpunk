// Normalize browser gamepads before interpreting gameplay or menu bindings.
// GPL-3.0-or-later. See LICENSE.
import { clamp } from './math.js';

const idleMessage='Focus the game and press a controller button to connect.';
const finiteAxis=value=>Number.isFinite(value)?clamp(value,-1,1):0;
const buttonValue=button=>Number.isFinite(button?.value)?clamp(button.value,0,1):Number(Boolean(button?.pressed));
const stick=value=>Math.abs(value)<=.17?0:Math.sign(value)*(Math.abs(value)-.17)/.83;
const trigger=value=>Number.isFinite(value)?(clamp(value,-1,1)+1)/2:0;

function layoutFor(pad) {
  const id=pad.id||'',usb=id.match(/^([\da-f]{4})-([\da-f]{4})-/i)||id.match(/Vendor:\s*([\da-f]{4})\s+Product:\s*([\da-f]{4})/i);
  const backbone=usb?.[1].toLowerCase()==='358a'&&['0102','0202','0203','0204'].includes(usb[2].toLowerCase());
  const ua=navigator.userAgent||'',linux=/Linux|FreeBSD/.test(`${navigator.platform||''} ${ua}`)&&!/Android/.test(ua);
  const firefox=Number(ua.match(/Firefox\/(\d+)/)?.[1]||0);
  if(pad.mapping==='standard') {
    // Backbone uses ABS_Z/RZ for look and ABS_GAS/BRAKE for triggers. Firefox's
    // evdev backend reserves unused RX/RY slots and reports eight axes. Before
    // Firefox 151, look is axes 4/5; since 151 it is encoded in buttons 6/7.
    // Keep this exception scoped to the affected USB IDs, backend and shape.
    // Sources and the raw Linux layout are documented in COMPATIBILITY.md.
    if(backbone&&linux&&firefox&&pad.axes.length===8&&pad.buttons.length>=17)return firefox>=151?'backbone-firefox-buttons':'backbone-firefox-axes';
    return 'standard';
  }
  // Chromium's Linux joydev backend leaves unrecognized devices unmapped.
  // Do not assume that an arbitrary raw controller has standard button indices.
  if(pad.mapping===''&&backbone&&linux&&!firefox&&pad.axes.length===8&&pad.buttons.length>=15)return 'backbone-linux';
  return null;
}

function readPad(pad,layout,state) {
  let axes=Array.from({length:4},(_,i)=>finiteAxis(pad.axes[i]));
  let values=Array.from({length:17},(_,i)=>buttonValue(pad.buttons[i]));
  if(layout==='backbone-linux') {
    values=[0,1,3,4,6,7,-1,-1,10,11,13,14,-1,-1,-1,-1,12].map(i=>buttonValue(pad.buttons[i]));
    values[6]=trigger(pad.axes[5]);values[7]=trigger(pad.axes[4]);
    const x=finiteAxis(pad.axes[6]),y=finiteAxis(pad.axes[7]);
    values[12]=Math.max(0,-y);values[13]=Math.max(0,y);values[14]=Math.max(0,-x);values[15]=Math.max(0,x);
  }else if(layout.startsWith('backbone-firefox-')) {
    // The HID driver uses BTN_NORTH for X and BTN_WEST for Y; Firefox's
    // semantic button mapping reverses these on non-Xbox-driver devices.
    [values[2],values[3]]=[values[3],values[2]];
    if(layout==='backbone-firefox-axes')axes.splice(2,2,finiteAxis(pad.axes[4]),finiteAxis(pad.axes[5]));
    else for(let i=0;i<2;i++) {
      // Firefox initializes untouched buttons to zero, which is also a valid
      // stick endpoint. Wait for a nonzero report per axis before using zero.
      state.lookReady[i] ||= values[6+i]>0;
      axes[2+i]=state.lookReady[i]?values[6+i]*2-1:0;
    }
    // Replace the look aliases with the actual triggers, so moving the camera
    // cannot cast shield/shoot and both triggers remain usable while looking.
    values[6]=trigger(pad.axes[7]);values[7]=trigger(pad.axes[6]);
  }
  return {axes:axes.map(stick),pressed:values.map((v,i)=>v>(state.pressed[i] ? .45 : .55))};
}

export class Controllers {
  constructor(){this.states=new Map();this.index=null;this.connected='';this.status=idleMessage;this.resume=false;}
  suspend(){this.resume=true;}
  disconnect(index){this.states.delete(index);if(this.index===index){this.index=null;this.connected='';this.status=idleMessage;}}
  poll(enabled=true) {
    let pads=[],message=idleMessage;
    try {
      if(typeof navigator.getGamepads!=='function')message=globalThis.isSecureContext===false?'Controllers require HTTPS or localhost.':'This browser does not expose controller input.';
      else pads=Array.from(navigator.getGamepads()||[]);
    }catch{message='Controller access is blocked. Open the game directly and check browser permissions.';}
    const states=new Map(),candidates=[],emit=enabled&&!this.resume;
    for(const [slot,pad]of pads.entries()) {
      if(!pad||pad.connected===false)continue;
      const layout=layoutFor(pad);
      if(!layout){message='Controller detected, but its layout is not supported.';continue;}
      const index=pad.index??slot,key=JSON.stringify([pad.id,layout,pad.axes.length,pad.buttons.length]);
      let state=this.states.get(index);
      if(state?.key!==key)state={key,pressed:[],activityAxes:[0,0,0,0],lookReady:[false,false]};
      const {axes,pressed}=readPad(pad,layout,state),edges=pressed.map((down,i)=>emit&&down&&!state.pressed[i]);
      const moved=axes.some((value,i)=>value!==0&&Math.abs(value-state.activityAxes[i])>.12);
      axes.forEach((value,i)=>{if(!emit||!value||Math.abs(value-state.activityAxes[i])>.12)state.activityAxes[i]=value;});
      state.pressed=pressed;states.set(index,state);
      candidates.push({id:pad.id,index,key,axes,pressed,edge:i=>Boolean(edges[i]),activity:emit&&(moved||edges.some(Boolean))});
    }
    this.states=states;this.resume=!enabled;
    const current=candidates.find(c=>c.index===this.index&&c.id===this.connected);
    const selected=(current?.activity?current:candidates.find(c=>c.activity))||current||candidates[0];
    this.index=selected?.index??null;this.connected=selected?.id||'';
    this.status=selected?'Controller connected.':message;
    return selected;
  }
}
