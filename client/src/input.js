// Keyboard, pointer, touch and standard USB/Bluetooth controller input.
// GPL-3.0-or-later. See LICENSE.
import { clamp } from './math.js';

export class Input {
  constructor(canvas,onAction,onLook) {
    this.canvas=canvas;this.onAction=onAction;this.onLook=onLook;this.keys=new Set();this.edges=new Set();this.buttons=[];this.active=false;this.menu=true;this.drag=null;this.touchMove=[0,0];this.connected='';this.padTime=0;this.menuIndex=0;this.sensitivity=.0025;
    window.addEventListener('keydown',e=>{
      if(/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))return;
      if(['Space','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)&&this.active)e.preventDefault();
      if(!this.keys.has(e.code))this.edges.add(e.code);this.keys.add(e.code);
      if(e.repeat)return;
      const bindings={Digit1:'ability:arc',Digit2:'ability:surge',Digit3:'ability:mend',Digit4:'ability:aegis',Digit5:'ability:lance',Digit6:'ability:echo',KeyR:'ability:ghostline',KeyE:'interact',Tab:'target',KeyJ:'journal',KeyT:'talents',KeyI:'inventory',KeyM:'map',KeyC:'community',KeyG:'dungeons',KeyH:'medkit',Escape:'escape',KeyV:'camera'};
      if(bindings[e.code]&&this.active)this.onAction(bindings[e.code]);
    });
    window.addEventListener('keyup',e=>this.keys.delete(e.code));
    window.addEventListener('blur',()=>this.clear());
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.clear();});
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('pointerdown',e=>{
      if(!this.active||this.menu)return;
      if(e.pointerType==='touch'){this.drag=[e.clientX,e.clientY,e.pointerId];canvas.setPointerCapture(e.pointerId);return;}
      if(document.pointerLockElement===canvas&&e.button===0)this.onAction('ability:arc');
      else if(e.button===0)this.onAction('pick',e);
      if(e.button===2){this.drag=[e.clientX,e.clientY,e.pointerId];canvas.setPointerCapture(e.pointerId);}
    });
    canvas.addEventListener('dblclick',()=>{if(this.active&&!this.menu)canvas.requestPointerLock?.()?.catch?.(()=>{});});
    canvas.addEventListener('pointerup',()=>this.drag=null);
    canvas.addEventListener('pointercancel',()=>this.drag=null);
    window.addEventListener('pointermove',e=>{
      if(!this.active||this.menu)return;
      if(document.pointerLockElement===canvas)this.onLook(e.movementX*this.sensitivity,e.movementY*this.sensitivity);
      else if(this.drag&&this.drag[2]===e.pointerId){this.onLook((e.clientX-this.drag[0])*this.sensitivity,(e.clientY-this.drag[1])*this.sensitivity);this.drag=[e.clientX,e.clientY,e.pointerId];}
    });
    this.setupTouch();
  }
  clear(){this.keys.clear();this.edges.clear();this.touchMove=[0,0];this.drag=null;}
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
    const pad=Array.from(pads).find(p=>p&&p.mapping==='standard');
    this.connected=pad?pad.id:'';
    if(pad){
      const axis=v=>Math.abs(v||0)<.17?0:Math.sign(v)*(Math.abs(v)-.17)/.83;
      const pressed=pad.buttons.map(b=>b.pressed),edge=i=>pressed[i]&&!this.buttons[i];
      if(this.menu){
        this.padTime-=dt;
        const direction=edge(13)||edge(15)||axis(pad.axes[1])>.6?1:edge(12)||edge(14)||axis(pad.axes[1])<-.6?-1:0;
        const container=document.querySelector('dialog[open]')||document.querySelector('#death-screen:not([hidden])')||document.querySelector('#creation:not([hidden])')||document.querySelector('#landing:not([hidden])');
        const focusables=container?Array.from(container.querySelectorAll('button:not(:disabled),input,textarea,select,[tabindex="0"]')).filter(e=>e.getClientRects().length):[];
        if(direction&&this.padTime<=0&&focusables.length){const current=focusables.indexOf(document.activeElement);this.menuIndex=(current+direction+focusables.length)%focusables.length;focusables[this.menuIndex].focus();this.padTime=.22;}
        if(edge(0))document.activeElement?.click();
        if(edge(1)||edge(9))this.onAction('escape');
      }else{
        forward-=axis(pad.axes[1]);strafe+=axis(pad.axes[0]);this.onLook(axis(pad.axes[2])*dt*2.3,axis(pad.axes[3])*dt*1.8);
        jump ||=edge(0);dash ||=edge(1);sprint ||=pressed[10];
        const actions={2:'interact',3:'target',4:'ability:surge',5:'ability:mend',6:'ability:aegis',7:'ability:arc',8:'journal',9:'escape',11:'ability:ghostline',12:'medkit',13:'map',14:'ability:lance',15:'ability:echo'};
        for(const [i,action]of Object.entries(actions))if(edge(Number(i)))this.onAction(action);
      }
      this.buttons=pressed;
    }else this.buttons=[];
    return this.menu?{forward:0,strafe:0,jump:false,dash:false,sprint:false}:{forward:clamp(forward,-1,1),strafe:clamp(strafe,-1,1),jump,dash,sprint};
  }
}
