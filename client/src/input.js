// Keyboard, pointer, touch and USB/Bluetooth controller input.
// GPL-3.0-or-later. See LICENSE.
import { clamp } from './math.js';
import { Controllers } from './controllers.js';

const bindings={Digit1:'ability:arc',Digit2:'ability:surge',Digit3:'ability:mend',Digit4:'ability:aegis',Digit5:'ability:lance',Digit6:'ability:echo',Digit7:'ability:breach',Digit8:'ability:siphon',Digit9:'ability:execute',Digit0:'ability:nova',KeyE:'interact',Tab:'target',KeyJ:'journal',KeyT:'talents',KeyI:'inventory',KeyM:'map',KeyC:'community',KeyU:'guild',KeyG:'dungeons',KeyH:'medkit',KeyV:'camera',Enter:'chat',KeyB:'gestures'};
const navigationKeys=new Set(['Tab','Space','Enter','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End']);
const textEntry=target=>target?.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName);
const interactive=target=>/^(BUTTON|A|SUMMARY)$/.test(target?.tagName)||target?.closest?.('button,a[href],summary,[tabindex="0"]');

export class Input {
  constructor(canvas,onAction,onLook) {
    this.canvas=canvas;this.onAction=onAction;this.onLook=onLook;this.keys=new Set();this.edges=new Set();this.active=false;this.menu=true;this.drag=null;this.touchMove=[0,0];this.sensitivity=.0025;
    this.lastDevice='keyboard';this.controllers=new Controllers();this.pointerPosition=null;
    this.focused=document.hasFocus?.()??true;this.generation=0;this.padTime=0;this.menuDirection='';this.menuContainer=null;this.menuPad=null;
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
      if(textEntry(e.target))return;
      // Native Tab, Space and arrow navigation must never cast or cycle targets in menus.
      if(this.menu||!this.active||e.ctrlKey||e.metaKey||e.altKey)return;
      if(e.code==='Tab'&&e.shiftKey)return;
      if(e.target!==canvas&&interactive(e.target)&&navigationKeys.has(e.code))return;
      if(['Space','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
      if(!this.keys.has(e.code))this.edges.add(e.code);this.keys.add(e.code);
      if(e.repeat)return;
      if(e.code==='Enter')e.preventDefault();
      if(bindings[e.code])this.onAction(bindings[e.code]);
    });
    window.addEventListener('keyup',e=>this.keys.delete(e.code));
    document.addEventListener('focusin',e=>{if(textEntry(e.target))this.clear();});
    window.addEventListener('blur',()=>{this.focused=false;this.controllers.suspend();this.clear();});
    window.addEventListener('focus',()=>{this.focused=true;});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){this.controllers.suspend();this.clear();}});
    window.addEventListener('gamepaddisconnected',e=>this.controllers.disconnect(e.gamepad.index));
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('pointerdown',e=>{
      if(!this.active||this.menu)return;
      if(this.drag)return;
      if(e.pointerType==='touch'||e.button===0||e.button===2){
        canvas.focus({preventScroll:true});
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
  get connected(){return this.controllers.connected;}
  get padIndex(){return this.controllers.index;}
  get controllerStatus(){return this.controllers.status;}
  clearPointer(){const drag=this.drag;this.drag=null;if(drag&&this.canvas.hasPointerCapture?.(drag.id))this.canvas.releasePointerCapture(drag.id);}
  clear(){this.keys.clear();this.edges.clear();this.touchMove=[0,0];this.resetTouch?.();this.clearPointer();this.generation++;this.padTime=0;this.menuDirection='';}
  setupTouch(){
    const stick=document.querySelector('#touch-stick');if(!stick)return;
    let touchId=null;
    const move=e=>{
      if(e.pointerId!==touchId)return;
      const r=stick.getBoundingClientRect(),dx=clamp((e.clientX-r.x-r.width/2)/(r.width*.38),-1,1),dy=clamp((e.clientY-r.y-r.height/2)/(r.height*.38),-1,1);
      this.touchMove=[dx,-dy];stick.firstElementChild.style.transform=`translate(${dx*27}px,${dy*27}px)`;
    };
    stick.addEventListener('pointerdown',e=>{if(!this.active||this.menu||touchId!==null||e.button!==0)return;touchId=e.pointerId;stick.setPointerCapture(touchId);move(e);});
    stick.addEventListener('pointermove',move);
    this.resetTouch=()=>{const id=touchId;touchId=null;this.touchMove=[0,0];stick.firstElementChild.style.transform='';if(id!==null&&stick.hasPointerCapture(id))stick.releasePointerCapture(id);};
    const reset=e=>{if(e.pointerId===touchId)this.resetTouch();};
    for(const event of ['pointerup','pointercancel','lostpointercapture'])stick.addEventListener(event,reset);
    document.querySelectorAll('[data-touch]').forEach(b=>b.addEventListener('click',e=>{
      if(!this.active||this.menu)return;
      e.preventDefault();const a=b.dataset.touch;
      if(a==='jump')this.edges.add('Space');else if(a==='dash')this.edges.add('KeyQ');else this.onAction(a);
    }));
  }
  controllerMenu(pad,dt){
    const {axes,pressed,edge}=pad;
    const select=document.querySelector('.ui-select');
    const container=select||document.querySelector('dialog[open]')||document.querySelector('#live-chat[data-expanded="true"]')||document.querySelector('#death-screen:not([hidden])')||document.querySelector('#creation:not([hidden])')||document.querySelector('#landing:not([hidden])');
    const focusables=container?Array.from(container.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled):not([type="hidden"]),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')).filter(e=>!e.disabled&&e.getClientRects().length):[];
    if(edge(1)||edge(9)){
      if(select)document.activeElement?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));
      else this.onAction('escape');
      return;
    }
    const y=(pressed[13]?1:0)-(pressed[12]?1:0)||(Math.abs(axes[1])>.6?Math.sign(axes[1]):0);
    const x=(pressed[15]?1:0)-(pressed[14]?1:0)||(Math.abs(axes[0])>.6?Math.sign(axes[0]):0);
    const direction=y?`y${y}`:x?`x${x}`:'';
    const fresh=direction!==this.menuDirection||container!==this.menuContainer||pad.index!==this.menuPad||[12,13,14,15].some(edge);
    this.padTime-=dt;this.menuDirection=direction;this.menuContainer=container;this.menuPad=pad.index;
    if(direction&&(fresh||this.padTime<=0)&&focusables.length){
      const current=focusables.indexOf(document.activeElement),control=focusables[current];
      if(!y&&control?.tagName==='INPUT'&&control.type==='range'){
        const before=control.value,min=control.min===''?0:Number(control.min),max=control.max===''?100:Number(control.max),step=Number(control.step)||1;
        control.value=String(clamp(Number(before)+x*step,min,max));
        if(control.value!==before){control.dispatchEvent(new Event('input',{bubbles:true}));control.dispatchEvent(new Event('change',{bubbles:true}));}
      }else focusables[current<0?((y||x)>0?0:focusables.length-1):(current+(y||x)+focusables.length)%focusables.length].focus();
      this.padTime=fresh ? .35 : .12;
    }
    if(edge(0)&&focusables.length){const control=focusables.includes(document.activeElement)?document.activeElement:focusables[0];control.focus();control.click();}
  }
  sample(dt){
    dt=Number.isFinite(dt)?Math.max(0,dt):0;
    const idle={forward:0,strafe:0,jump:false,dash:false,sprint:false},generation=this.generation;
    const enabled=this.focused&&!document.hidden,pad=this.controllers.poll(enabled);
    if(pad?.activity)this.lastDevice='gamepad';else if(!pad&&this.lastDevice==='gamepad')this.lastDevice='keyboard';
    if(!enabled){this.clear();return idle;}
    if(this.menu){this.edges.clear();if(pad)this.controllerMenu(pad,dt);return idle;}
    if(!this.active){this.clear();return idle;}
    let forward=(this.keys.has('KeyW')||this.keys.has('ArrowUp')?1:0)-(this.keys.has('KeyS')||this.keys.has('ArrowDown')?1:0),strafe=(this.keys.has('KeyD')?1:0)-(this.keys.has('KeyA')?1:0);
    if(this.keys.has('ArrowLeft'))this.onLook(-dt*1.7,0);if(this.keys.has('ArrowRight'))this.onLook(dt*1.7,0);
    forward+=this.touchMove[1];strafe+=this.touchMove[0];
    let jump=this.edges.has('Space'),dash=this.edges.has('KeyQ'),sprint=this.keys.has('ShiftLeft')||this.keys.has('ShiftRight');this.edges.clear();
    if(pad){
      const {axes,pressed,edge}=pad;
      // Open panels first, and stop dispatching this frame when an action
      // changes context. A held confirm/trigger must not leak into gameplay.
      const actions=[[9,'settings'],[8,'journal'],[13,pressed[10]?'ability:execute':'map'],[2,'interact'],[3,'target'],[4,'ability:surge'],[5,'ability:mend'],[6,'ability:aegis'],[7,'ability:arc'],[12,pressed[10]?'ability:breach':'medkit'],[14,pressed[10]?'ability:nova':'ability:lance'],[15,pressed[10]?'ability:siphon':'ability:echo']];
      for(const [i,action]of actions)if(edge(i)){this.onAction(action);if(this.menu||!this.active||this.generation!==generation)return idle;}
      forward-=axes[1];strafe+=axes[0];
      const speed=this.sensitivity/.0025;this.onLook(axes[2]*dt*2.3*speed,axes[3]*dt*1.8*speed);
      jump ||=edge(0);dash ||=edge(1);sprint ||=pressed[10];
    }
    return {forward:clamp(forward,-1,1),strafe:clamp(strafe,-1,1),jump,dash,sprint};
  }
}
