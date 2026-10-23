// Keyboard, pointer, touch and standard USB/Bluetooth controller input.
// GPL-3.0-or-later. See LICENSE.
import { clamp } from './math.js';

export class Input {
  constructor(canvas,onAction,onLook) {
    this.canvas=canvas;this.onAction=onAction;this.onLook=onLook;this.keys=new Set();this.edges=new Set();this.active=false;this.menu=true;this.drag=null;this.touchMove=[0,0];this.connected='';this.padTime=0;this.menuIndex=0;this.sensitivity=.0025;
    this.lastDevice='keyboard';this.padIndex=null;this.padStates=new Map();this.pointerPosition=null;
    // Capture real activity in menus and text fields as well as in the world.
    // Controller menu navigation dispatches synthetic keys; those are not keyboard use.
    document.addEventListener('keydown',e=>{if(e.isTrusted!==false&&!e.repeat)this.lastDevice='keyboard';},true);
    document.addEventListener('pointerdown',e=>{
      if(e.isTrusted===false)return;
      this.lastDevice=e.pointerType==='touch'?'touch':'keyboard';
      this.pointerPosition=[e.clientX,e.clientY];
    },true);
    document.addEventListener('pointermove',e=>{
      if(e.isTrusted===false)return;
      if(e.pointerType==='touch'){if(e.buttons)this.lastDevice='touch';return;}
      const previous=this.pointerPosition;
      if(previous&&Math.hypot(e.clientX-previous[0],e.clientY-previous[1])<3)return;
      this.pointerPosition=[e.clientX,e.clientY];
      if(previous||Math.hypot(e.movementX||0,e.movementY||0)>=3)this.lastDevice='keyboard';
    },true);
    document.addEventListener('wheel',e=>{if(e.isTrusted!==false&&(e.deltaX||e.deltaY))this.lastDevice='keyboard';},{capture:true,passive:true});
    window.addEventListener('keydown',e=>{
      if(e.defaultPrevented||e.isComposing)return;
      if(e.code==='Escape'){if(!e.repeat){e.preventDefault();this.onAction('escape');}return;}
      if(/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))return;
      // Native Tab, Space and arrow navigation must never cast or cycle targets in menus.
      if(this.menu||!this.active||e.ctrlKey||e.metaKey||e.altKey)return;
      if(['Space','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)&&this.active)e.preventDefault();
      if(!this.keys.has(e.code))this.edges.add(e.code);this.keys.add(e.code);
      if(e.repeat)return;
      const bindings={Digit1:'ability:arc',Digit2:'ability:surge',Digit3:'ability:mend',Digit4:'ability:aegis',Digit5:'ability:lance',Digit6:'ability:echo',Digit7:'ability:breach',Digit8:'ability:siphon',Digit9:'ability:execute',Digit0:'ability:nova',KeyR:'ability:ghostline',KeyE:'interact',Tab:'target',KeyJ:'journal',KeyT:'talents',KeyI:'inventory',KeyM:'map',KeyC:'community',KeyU:'guild',KeyG:'dungeons',KeyH:'medkit',KeyV:'camera',Enter:'chat',KeyB:'gestures'};
      if(e.code==='Enter')e.preventDefault();
      if(bindings[e.code]&&this.active)this.onAction(bindings[e.code]);
    });
    window.addEventListener('keyup',e=>this.keys.delete(e.code));
    window.addEventListener('blur',()=>this.clear());
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.clear();});
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('pointerdown',e=>{
      if(!this.active||this.menu)return;
      if(this.drag)return;
      if(e.pointerType==='touch'||e.button===0||e.button===2){
        this.drag={id:e.pointerId,type:e.pointerType,button:e.button,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false};
        if(e.pointerType==='touch')canvas.setPointerCapture(e.pointerId);
      }
    });
    window.addEventListener('pointerup',e=>{
      const drag=this.drag;if(!drag||drag.id!==e.pointerId||e.button!==drag.button)return;
      this.clearPointer();
      if(!this.active||this.menu||drag.moved||Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>5)return;
      if(drag.type!=='touch'&&e.target!==canvas)return;
      const r=canvas.getBoundingClientRect();
      if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)return;
      this.onAction(drag.button===2?'pick-activate':'pick',e);
    });
    const cancel=e=>{if(this.drag?.id===e.pointerId)this.clearPointer();};
    window.addEventListener('pointercancel',cancel);
    canvas.addEventListener('lostpointercapture',cancel);
    window.addEventListener('pointermove',e=>{
      if(!this.active||this.menu)return;
      const drag=this.drag;if(!drag||drag.id!==e.pointerId)return;
      if(drag.type!=='touch'&&!(e.buttons&(drag.button===2?2:1))){this.clearPointer();return;}
      if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>5)drag.moved=true;
      if(drag.moved&&(drag.type==='touch'||drag.button===2))this.onLook((e.clientX-drag.x)*this.sensitivity,(e.clientY-drag.y)*this.sensitivity);
      drag.x=e.clientX;drag.y=e.clientY;
    });
    this.setupTouch();
  }
  clearPointer(){const drag=this.drag;this.drag=null;if(drag&&this.canvas.hasPointerCapture?.(drag.id))this.canvas.releasePointerCapture(drag.id);}
  clear(){this.keys.clear();this.edges.clear();this.touchMove=[0,0];this.clearPointer();}
  setupTouch(){
    const stick=document.querySelector('#touch-stick');if(!stick)return;
    let touchId=null;
    const move=e=>{
      if(e.pointerId!==touchId)return;
      const r=stick.getBoundingClientRect(),dx=clamp((e.clientX-r.x-r.width/2)/(r.width*.38),-1,1),dy=clamp((e.clientY-r.y-r.height/2)/(r.height*.38),-1,1);
      this.touchMove=[dx,-dy];stick.firstElementChild.style.transform=`translate(${dx*27}px,${dy*27}px)`;
    };
    stick.addEventListener('pointerdown',e=>{touchId=e.pointerId;stick.setPointerCapture(touchId);move(e);});
    stick.addEventListener('pointermove',move);
    const reset=()=>{touchId=null;this.touchMove=[0,0];stick.firstElementChild.style.transform='';};
    stick.addEventListener('pointerup',reset);stick.addEventListener('pointercancel',reset);
    document.querySelectorAll('[data-touch]').forEach(b=>b.addEventListener('pointerdown',e=>{
      e.preventDefault();const a=b.dataset.touch;
      if(a==='jump')this.edges.add('Space');else if(a==='dash')this.edges.add('KeyQ');else this.onAction(a);
    }));
  }
  sample(dt){
    let forward=(this.keys.has('KeyW')||this.keys.has('ArrowUp')?1:0)-(this.keys.has('KeyS')||this.keys.has('ArrowDown')?1:0),strafe=(this.keys.has('KeyD')?1:0)-(this.keys.has('KeyA')?1:0);
    if(!this.menu){if(this.keys.has('ArrowLeft'))this.onLook(-dt*1.7,0);if(this.keys.has('ArrowRight'))this.onLook(dt*1.7,0);}
    forward+=this.touchMove[1];strafe+=this.touchMove[0];
    let jump=this.edges.has('Space'),dash=this.edges.has('KeyQ'),sprint=this.keys.has('ShiftLeft')||this.keys.has('ShiftRight');this.edges.clear();
    let pads=[];try{pads=navigator.getGamepads?.()||[];}catch{/* Disabled by browser policy. */}
    const axis=v=>Math.abs(v||0)<.17?0:Math.sign(v)*(Math.abs(v)-.17)/.83;
    const states=new Map(),candidates=[];
    for(const [slot,pad]of Array.from(pads).entries()){
      if(!pad||pad.connected===false||pad.mapping!=='standard')continue;
      const index=pad.index??slot,previous=this.padStates.get(index);
      const buttons=previous?.id===pad.id?previous.buttons:[],previousAxes=previous?.id===pad.id?previous.axes:[];
      const pressed=pad.buttons.map(b=>b.pressed),edge=i=>pressed[i]&&!buttons[i];
      const axes=pad.axes.slice(0,4).map(axis);
      const moved=axes.some((value,i)=>value!==0&&Math.abs(value-(previousAxes[i]||0))>.12);
      const activity=pressed.some((_,i)=>edge(i))||moved;
      axes.forEach((value,i)=>{if(!value||Math.abs(value-(previousAxes[i]||0))>.12)previousAxes[i]=value;});
      states.set(index,{id:pad.id,buttons:pressed,axes:previousAxes});
      candidates.push({pad,index,pressed,edge,activity});
    }
    this.padStates=states;
    // Follow deliberate input on any controller, including the right stick.
    // Keep per-device history so drift and held controls cannot steal input or repeat actions.
    const current=candidates.find(c=>c.index===this.padIndex&&c.pad.id===this.connected);
    const selected=(current?.activity?current:candidates.find(c=>c.activity))||current||candidates[0];
    this.connected=selected?.pad.id||'';this.padIndex=selected?.index??null;
    if(selected){
      const {pad,pressed,edge,activity}=selected;
      if(activity)this.lastDevice='gamepad';
      if(this.menu){
        this.padTime-=dt;
        const direction=edge(13)||edge(15)||axis(pad.axes[1])>.6?1:edge(12)||edge(14)||axis(pad.axes[1])<-.6?-1:0;
        const container=document.querySelector('.ui-select')||document.querySelector('dialog[open]')||document.querySelector('#live-chat[data-expanded="true"]')||document.querySelector('#death-screen:not([hidden])')||document.querySelector('#creation:not([hidden])')||document.querySelector('#landing:not([hidden])');
        const focusables=container?Array.from(container.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled):not([type="hidden"]),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')).filter(e=>e.getClientRects().length):[];
        if(direction&&this.padTime<=0&&focusables.length){const current=focusables.indexOf(document.activeElement);this.menuIndex=(current+direction+focusables.length)%focusables.length;focusables[this.menuIndex].focus();this.padTime=.22;}
        if(edge(0))document.activeElement?.click();
        if(edge(1)||edge(9)){
          if(document.querySelector('.ui-select'))document.activeElement?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));
          else this.onAction('escape');
        }
      }else{
        forward-=axis(pad.axes[1]);strafe+=axis(pad.axes[0]);this.onLook(axis(pad.axes[2])*dt*2.3,axis(pad.axes[3])*dt*1.8);
        jump ||=edge(0);dash ||=edge(1);sprint ||=pressed[10];
        const actions={2:'interact',3:'target',4:'ability:surge',5:'ability:mend',6:'ability:aegis',7:'ability:arc',8:'journal',9:'settings',11:'ability:ghostline',12:'medkit',13:'map',14:'ability:lance',15:'ability:echo'};
        const alternate={12:'ability:breach',15:'ability:siphon',13:'ability:execute',14:'ability:nova'};
        for(const [i,action]of Object.entries(actions))if(edge(Number(i)))this.onAction(pressed[10]&&alternate[i]?alternate[i]:action);
      }
    }else if(this.lastDevice==='gamepad')this.lastDevice='keyboard';
    return this.menu?{forward:0,strafe:0,jump:false,dash:false,sprint:false}:{forward:clamp(forward,-1,1),strafe:clamp(strafe,-1,1),jump,dash,sprint};
  }
}
