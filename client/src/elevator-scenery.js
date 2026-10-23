// Original 1920s-inspired brass, velvet and skyline salons. GPL-3.0-or-later.
import { box, pane, bevelBox, ellipsoid, transformMesh, lettering } from './geometry.js';
import { buildingElevator, doorOpen, rideProgress } from './elevators.js';

function sunburst(v,x,y,z,r,accent) {
  for(let i=0;i<9;i++){
    const a=-Math.PI/2+i*Math.PI/8,ray=[];
    box(ray,[0,r*.5,0],[.055,r,.055],accent,.45);
    transformMesh(v,ray,[x,y,z],0,0,a);
  }
  ellipsoid(v,[x,y,z],[.3,.3,.12],accent,.6,0,8);
}

export function elevatorShaft(v,b) {
  const e=buildingElevator(b),[x,,z]=e.position,{accent,velvet}=e.venue,h=b.h;
  for(const s of b.solids.filter(s=>s.kind==='elevator-wall'))box(v,s.center,s.size,velvet,.12);
  // Open brass rails frame the panorama; the building is behind the passenger.
  for(const side of [-1,1]){
    box(v,[x+side*3.15,h/2+2.6,z-2.7],[.22,h+5.2,.25],accent,.15);
    for(let y=8;y<h;y+=8)box(v,[x+side*3.15,y,z-2.4],[.4,.12,.9],accent,.6);
  }
  for(const y of e.stops){
    for(const side of [-1,1]){
      box(v,[x+side*3.05,y+2.5,z+2.75],[.32,5,.32],accent,.25);
      box(v,[x+side*2.55,y+3.3,z+2.94],[.1,1.8,.1],accent,.7);
    }
    box(v,[x,y+5,z+2.75],[6.5,.5,.4],'#211b24');
    for(let i=0;i<3;i++)box(v,[x,y+5.3+i*.22,z+2.75],[5.6-i*1.2,.2,.35],accent,.3);
    box(v,[x,y+.02,z],[5.8,.04,5.8],velvet,.12);
    lettering(v,y?'STREET / RETURN':'TOP FLOOR',[x-1.8,y+4.97,z+2.98],accent,.06);
    sunburst(v,x,y+5.9,z+2.98,.8,accent);
  }
}

// Cabins are drawn only nearby. During travel the local cab replaces its landing cab.
export function elevatorCabin(v,e,position,ride=null,time=0,reducedMotion=false) {
  const mesh=[],{velvet,accent}=e.venue,open=doorOpen(ride,time);
  box(mesh,[0,-.12,0],[6,.24,6],'#24202a');
  box(mesh,[0,.012,0],[5.7,.024,5.7],'#e2d2b2');
  // Marble inlay and a nested diamond carpet.
  for(const s of [3.5,3.1,2.65])box(mesh,[0,.03+(3.5-s)*.01,0],[s,.016,s],s===3.1?velvet:accent,.1,Math.PI/4);
  for(const side of [-1,1]){
    box(mesh,[side*2.9,2.4,0],[.18,4.8,5.8],'#261a24');
    for(let i=0;i<11;i++){
      bevelBox(mesh,[side*2.78,2.35,-2.5+i*.5],[.15,3.8,.46],velvet,.13,0,.05);
      for(const y of [1.2,2.3,3.4])box(mesh,[side*2.67,y,-2.5+i*.5],[.07,.07,.07],accent,.4);
    }
    for(const y of [.22,1.05,4.45])box(mesh,[side*2.63,y,0],[.09,.09,5.6],accent,.4);
    // Warm opal sconces and slender brass frames.
    ellipsoid(mesh,[side*2.5,3.55,.9],[.28,.85,.38],'#ffe8b3',.9,0,8);
    box(mesh,[side*2.68,3.55,.9],[.15,1.25,.52],accent,.3);
  }
  box(mesh,[0,4.85,0],[6,.2,6],'#241e2a');
  for(const s of [4.8,3.6,2.4]){
    for(const side of [-1,1]){
      box(mesh,[side*s/2,4.7,0],[.06,.08,s],accent,.6);
      box(mesh,[0,4.7,side*s/2],[s,.08,.06],accent,.6);
    }
  }
  ellipsoid(mesh,[0,4.55,0],[1.8,.25,1.8],'#ffedcc',.85,0,12);
  // Sliding filigree gates at both ends preserve views through their open lattice.
  for(const end of [-1,1])for(const side of [-1,1]){
    const center=side*(1.38+open*2.65);
    if(end<0){
      for(let i=0;i<5;i++)box(mesh,[center+(i-2)*.5,2.1,end*2.88],[.045,4.1,.06],accent,.4);
      for(const y of [.18,1.1,3.2,4.15])box(mesh,[center,y,end*2.88],[2.6,.065,.07],accent,.4);
    }else{
      // The observation side has a low diamond gate and an uninterrupted outlook.
      for(const offset of [-.65,.65])for(const angle of [-Math.PI/4,Math.PI/4])for(const step of [-1,1]){
        const rod=[];box(rod,[0,0,0],[.04,.7,.055],accent,.5);
        transformMesh(mesh,rod,[center+offset+step*.24,.65+step*(angle>0?-.24:.24),end*2.88],0,0,angle);
      }
      for(const y of [.15,1.15])box(mesh,[center,y,end*2.88],[2.6,.075,.07],accent,.5);
    }
  }
  // Mechanical floor dial above the panorama, visible from inside the cabin.
  box(mesh,[0,3.7,2.83],[2.3,.8,.1],'#181722');
  const dial=[],progress=ride?rideProgress(ride,time):position[1]/e.stops.at(-1);
  const fraction=ride&&ride.to[1]<ride.from[1]?1-progress:progress;
  box(dial,[0,.22,0],[.055,.44,.06],accent,.9);
  transformMesh(mesh,dial,[0,3.43,2.75],0,0,(.5-fraction)*Math.PI);
  for(let i=0;i<=6;i++)box(mesh,[(i-3)*.28,3.88,2.73],[.035,.1,.04],accent,.8);
  for(const side of [-1,1])box(mesh,[side*1.17,3.7,2.78],[.05,.86,.05],accent,.5);
  for(const y of [3.28,4.12])box(mesh,[0,y,2.78],[2.4,.05,.05],accent,.5);
  const sway=ride&&!reducedMotion?Math.sin(progress*Math.PI)*Math.sin(time*1.4)*.012:0;
  transformMesh(v,mesh,position,0,0,sway);
}

function chandelier(v,x,y,z,accent) {
  box(v,[x,y+.65,z],[.06,1.3,.06],accent,.3);
  for(let ring=0;ring<3;ring++)for(let i=0;i<8;i++){
    const a=i*Math.PI/4,r=1.15-ring*.32;
    box(v,[x+Math.sin(a)*r,y-ring*.3,z+Math.cos(a)*r],[.14,.65,.14],'#fff0cf',.8,a);
  }
}

export function venueGeometry(v,b) {
  const {x,z,h}=b,{kind,velvet,accent}=b.rooftop.venue;
  const marble=kind==='jazz'?'#27324b':kind==='conservatory'?'#465d53':'#cbbba5';
  // Keep the staircase opening: draw the actual authoritative slabs, never a full cap.
  for(const s of b.solids){
    if(s.kind==='floor'&&Math.abs(s.center[1]+s.size[1]/2-h)<.01)box(v,s.center,s.size,marble);
    if(s.kind==='parapet'){
      box(v,s.center,s.size,'#344354',.1);
      box(v,[s.center[0],s.center[1]+s.size[1]/2+.04,s.center[2]],[s.size[0],.08,s.size[2]],accent,.65);
    }
  }
  // A clear central promenade opens directly from the elevator to the skyline.
  box(v,[x,h+.02,z],[3.8,.04,b.d-1.2],velvet,.12);
  for(const side of [-1,1])box(v,[x+side*1.94,h+.045,z],[.06,.025,b.d-1.2],accent,.4);
  for(const s of b.solids.filter(s=>s.kind==='roof-fixture')){
    const [px,,pz]=s.center;
    if(kind==='restaurant'&&px>x&&pz<z){
      bevelBox(v,s.center,s.size,'#a97651',0,0,.12);
      box(v,[px,h+1.24,pz],[3.2,.08,3.2],'#e0d3b9');
      for(let i=0;i<3;i++)ellipsoid(v,[px-1+i,h+1.4,pz],[.65,.25,.65],'#dcc49a',.1,0,8);
      box(v,[px,h+3.2,pz],[3.2,.3,2],'#ad8056');
      for(const side of [-1,1])box(v,[px+side*1.4,h+2.1,pz-.8],[.09,2.1,.09],accent,.4);
      lettering(v,'CHEF',[px-.65,h+3.3,pz+1.02],accent,.05);
    }else if(kind==='restaurant'){
      box(v,s.center,s.size,'#8c7964');
      box(v,[px,h+1.24,pz],[3.2,.08,3.2],'#fff0db',.12);
      for(const side of [-1,1]){
        ellipsoid(v,[px+side*.85,h+1.32,pz],[.65,.08,.65],'#fff4df',.2,0,10);
        ellipsoid(v,[px+side*.85,h+1.42,pz],[.25,.16,.23],side>0?'#99b078':'#d9a27d',0,0,8);
        box(v,[px+side*.85,h+1.33,pz+.5],[.04,.03,.4],accent,.5);
        ellipsoid(v,[px+side*.9,h+1.55,pz-.6],[.18,.4,.18],'#eac9a7',.25,0,8);
      }
      box(v,[px,h+1.6,pz],[.09,.65,.09],'#f8e0aa',.5);
      ellipsoid(v,[px,h+1.98,pz],[.11,.18,.11],'#ffca7b',1,0,6);
    }else if(kind==='conservatory'&&pz<z){
      bevelBox(v,s.center,s.size,accent,0,0,.15);
      box(v,[px,h+1.23,pz],[2.8,.05,2.8],'#263e38');
      for(let i=0;i<5;i++){
        const a=i*Math.PI*2/5;
        box(v,[px+Math.sin(a)*.8,h+1.8,pz+Math.cos(a)*.8],[.05,1.2,.05],'#a8c49a');
        ellipsoid(v,[px+Math.sin(a)*.8,h+2.35,pz+Math.cos(a)*.8],[.65,.4,.65],i%2?'#eac5da':'#f5e9d6',.15,0,8);
      }
    }else if(kind==='jazz'&&pz<z){
      bevelBox(v,s.center,s.size,px<x?'#13151f':'#584333',0,0,.18);
      if(px<x){
        bevelBox(v,[px,h+1.35,pz-.25],[2.9,.25,2.2],'#0f1521',.1,0,.2);
        box(v,[px,h+1.27,pz+1.1],[2.6,.08,.55],'#fff0dc');
        for(let i=0;i<12;i++)box(v,[px-1.2+i*.21,h+1.34,pz+1],[.09,.08,.3],'#171b27');
        box(v,[px,h+1.85,pz-.9],[2.8,1.1,.1],'#191e29');
      }else{
        box(v,[px,h+1.24,pz],[3.15,.08,3.15],accent,.3);
        for(let i=0;i<4;i++)ellipsoid(v,[px-1+i*.65,h+1.6,pz],[.25,.65,.25],i%2?'#86b6a4':'#d1ac82',.2,0,8);
      }
    }else{
      bevelBox(v,s.center,s.size,velvet,.12,0,.25);
      for(let i=0;i<5;i++)ellipsoid(v,[px-1.2+i*.6,h+1.45,pz-.95],[.6,.85,.8],velvet,.15,0,6);
      for(const side of [-1,1])bevelBox(v,[px+side*1.3,h+1.3,pz],[.35,.5,2.7],accent,.1,0,.1);
      ellipsoid(v,[px,h+1.28,pz+.4],[.7,.08,.7],accent,.4,0,10);
      for(const side of [-1,1])ellipsoid(v,[px+side*.18,h+1.5,pz+.4],[.12,.4,.12],'#ffe4b1',.45,0,8);
    }
  }
  // Overhead ribs leave all four outlooks open, including the stair landings.
  for(const s of b.solids.filter(s=>s.kind==='venue-pillar'))box(v,s.center,s.size,accent,.25);
  for(const side of [-1,1]){
    box(v,[x+side*9,h+6.2,z],[.18,.25,17],accent,.3);
    box(v,[x,h+6.2,z+side*8.5],[18,.25,.18],accent,.3);
    for(let i=0;i<5;i++)box(v,[x+side*(9-i*.6),h+6.4+i*.18,z-8.5],[.15,.15,1.5],accent,.5);
  }
  for(const pz of [-5,5]){
    box(v,[x,h+6.1,z+pz],[18,.12,.12],accent,.3);
    if(kind==='conservatory'){
      for(let i=-4;i<=4;i++)box(v,[x+i*2,h+6.2,z],[.09,.12,17],accent,.2);
    }else chandelier(v,x,h+5.4,z+pz,accent);
  }
  if(kind==='conservatory'){
    // A shallow, flush reflecting pool remains traversable like the surrounding deck.
    box(v,[x+6,h+.025,z],[3.3,.04,3.4],accent,.3);
    pane(v,[x+6,h+.05,z],[3,0,3.1],'#73bdb4',.5,2);
  }
  if(kind==='jazz')for(let i=0;i<24;i++)box(v,[x+Math.sin(i*2.4)*8,h+6.1,z+Math.cos(i*2.4)*7],[.07,.07,.07],i%2?accent:'#9dbdfb',.9);
  const sign=b.rooftop.name.toUpperCase();
  box(v,[x,h+3.5,z-b.d/2+.25],[Math.min(b.w-3,sign.length*.38+1),1.1,.16],'#1e2230');
  lettering(v,sign,[x-sign.length*.18,h+3.75,z-b.d/2+.35],accent,.06);
  sunburst(v,x,h+4.45,z-b.d/2+.35,1.1,accent);
  lettering(v,'ELEVATOR / STREET',[x-2.5,h+.7,z+b.d/2+7.32],accent,.05);
}
