// Observation elevators. Geometry and travel timing are mirrored by elevators.rs.
// GPL-3.0-or-later. See LICENSE.
import { clamp, mix3 } from './math.js';

export const doorSeconds = 1.2;
export function validVenue(v) {
  return v && ['hotel','restaurant','conservatory','jazz'].includes(v.kind)
    && [v.velvet,v.accent].every(c=>typeof c==='string'&&/^#[0-9a-f]{6}$/i.test(c))
    && [v.description,v.view].every(s=>typeof s==='string'&&s.length>0&&s.length<=300);
}
export function buildingElevator(b) {
  return {id:`elevator-${b.id}`,name:b.rooftop.name,position:[b.x,0,b.z+b.d/2+4],stops:[0,b.h],venue:b.rooftop.venue};
}
export function rideDuration(from,to) { return doorSeconds*2+4+Math.abs(to[1]-from[1])/22; }
export function rideProgress(ride,time) {
  return clamp((time-ride.started-doorSeconds)/(ride.duration-doorSeconds*2),0,1);
}
export function ridePosition(ride,time) {
  const t=rideProgress(ride,time);
  return mix3(ride.from,ride.to,t*t*(3-2*t));
}
export function doorOpen(ride,time) {
  if(!ride)return 1;
  return clamp(Math.max(1-(time-ride.started)/doorSeconds,(time-ride.started-ride.duration+doorSeconds)/doorSeconds),0,1);
}
export function rideLabel(ride,time) {
  if(time<ride.started+doorSeconds)return 'Closing brass gates';
  if(time>=ride.started+ride.duration-doorSeconds)return 'Opening brass gates';
  return ride.to[1]>ride.from[1]?'Ascending above Vesper':'Descending to the street';
}

// A protected balcony joins the cabin to the roof through a gap in its parapet.
export function elevatorSolids(b) {
  const z=b.z+b.d/2,solids=[];
  const add=(center,size,kind)=>solids.push({center,size,kind});
  add([b.x,b.h-.175,z+.5],[7,.35,1.3],'floor');
  add([b.x,b.h-.12,z+4],[6,.24,6],'elevator-floor');
  for(const side of [-1,1])add([b.x+side*3.15,b.h+.65,z+3.5],[.3,1.3,7.3],'parapet');
  add([b.x,b.h+.65,z+7.15],[6.6,1.3,.3],'parapet');
  for(const y of [0,b.h])for(const side of [-1,1])add([b.x+side*2.9,y+2.4,z+4],[.18,4.8,5.8],'elevator-wall');
  for(const side of [-1,1])for(const end of [-1,1])add([b.x+side*9,b.h+3.1,b.z+end*8.5],[.18,6.2,.18],'venue-pillar');
  return solids;
}
