// Learn camera inputs from the values actually exposed by the browser.
// GPL-3.0-or-later. See LICENSE.
import { clamp } from './math.js';

export const controllerLookStorage='sloperberpunk.controller-look.v1';
export const controllerLookKey=pad=>JSON.stringify([pad.id,pad.mapping,pad.axes.length,pad.buttons.length]);
export function controllerSnapshot(pad){
  return {key:controllerLookKey(pad),index:pad.index,axes:Array.from(pad.axes),buttons:pad.buttons.map(b=>Number.isFinite(b.value)?b.value:Number(b.pressed))};
}

// Samples are left, right, up, down, then released. Capturing both ends and
// the center also handles inverted axes and sticks exposed as analog buttons.
export function calibrateControllerLook(samples){
  if(samples.length!==5||samples.some(s=>s.key!==samples[0].key||s.index!==samples[0].index))throw new Error('Use the same controller for every step. Restart right-stick setup.');
  const center=samples[4],candidates=[[],[],[],[]];
  for(const source of ['axes','buttons'])for(let index=0;index<center[source].length;index++){
    // Keep movement and the setup's confirm/cancel controls out of calibration.
    if(source==='axes'?index<2:[0,1,9].includes(index))continue;
    const values=samples.map(s=>s[source][index]),rest=values[4];
    if(!values.every(Number.isFinite))continue;
    for(let direction=0;direction<4;direction++){
      const delta=values[direction]-rest,other=direction<2?[2,3]:[0,1];
      if(Math.abs(delta)<(source==='axes'?.5:.3)||other.some(i=>Math.abs(values[i]-rest)>.2))continue;
      if((values[direction^1]-rest)*Math.sign(delta)>.2)continue;
      candidates[direction].push({source,index,center:rest,end:values[direction]});
    }
  }
  if(candidates.some(list=>!list.length))throw new Error('Could not read all four directions. Restart setup, move only the right stick fully in each direction, then release it for the last step.');
  // Prefer analog axes. Also consume button aliases even when an axis is used,
  // so looking left cannot cast shield through a second browser input.
  return {bindings:candidates.map(list=>list[0]),buttons:[...new Set(candidates.flat().filter(b=>b.source==='buttons').map(b=>b.index))]};
}

export function readControllerLook(pad,profile){
  if(!profile||!Array.isArray(profile.bindings)||profile.bindings.length!==4||!Array.isArray(profile.buttons))return null;
  const validIndex=(source,index)=>Number.isInteger(index)&&index>=0&&index<pad[source].length;
  if(profile.buttons.some(i=>!validIndex('buttons',i)||[0,1,9].includes(i)))return null;
  const values=[];
  for(const binding of profile.bindings){
    if(!binding||!['axes','buttons'].includes(binding.source))return null;
    const {source,index,center,end}=binding;
    if(!validIndex(source,index)||(source==='axes'?index<2:!profile.buttons.includes(index)))return null;
    if(!Number.isFinite(center)||!Number.isFinite(end)||Math.abs(end-center)<(source==='axes'?.5:.3))return null;
    const value=source==='axes'?pad.axes[index]:pad.buttons[index].value??Number(pad.buttons[index].pressed);
    if(!Number.isFinite(value))return null;
    values.push(clamp((value-center)/(end-center),0,1));
  }
  return {axes:[values[1]-values[0],values[3]-values[2]],buttons:profile.buttons};
}
