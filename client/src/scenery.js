// Original modular architecture and street furniture. GPL-3.0-or-later.
import { random } from './math.js';
import { box, pane, bevelBox, ellipsoid, transformMesh } from './geometry.js';

export function buildingExterior(v,b,data,neighborhoodColor=null) {
  const neon=neighborhoodColor||data.palette.neon[b.accent],concrete=data.palette.concrete[b.shade],rand=random(b.seed);
  for(const solid of b.solids)if(['wall','upper'].includes(solid.kind))box(v,solid.center,solid.size,concrete);
  box(v,[b.x,b.h-.3,b.z],[b.w+.6,.6,b.d+.6],'#182232');
  for(const side of [-1,1]) {
    box(v,[b.x+side*(b.w/2-.15),b.h/2,b.z+b.d/2+.07],[.3,b.h,.14],'#657080');
    box(v,[b.x,b.h+.15,b.z+side*b.d/2],[b.w,.15,.25],neon,.8);
    box(v,[b.x,6.65,b.z+side*(b.d/2+.7)],[b.w+1,.35,1.6],'#182232');
    if(b.interior){
      const door=data.interiors.doorWidth;
      box(v,[b.x,4.55,b.z+side*(b.d/2+.7)],[door+1,.32,1.6],'#192331');
      box(v,[b.x,4.4,b.z+side*(b.d/2+1.45)],[door,.1,.1],b.interior.color,.95);
      for(const wing of [-1,1])box(v,[b.x+wing*(door/2+.09),2.1,b.z+side*(b.d/2+.08)],[.14,4.2,.15],b.interior.color,.55);
      // A lit lintel and an open threshold identify every accessible ground floor.
      box(v,[b.x,.035,b.z+side*(b.d/2+.65)],[door,.05,1.3],'#64717c');
      const signX=b.x+door/2+2.8,signZ=b.z+side*(b.d/2+.12);
      bevelBox(v,[signX,3.1,signZ],[2.9,1.9,.22],'#121d2d');
      const face=side>0?4:5,front=signZ+side*.13;
      if(b.interior.name.includes('CLINIC')){
        pane(v,[signX,3.1,front],[1.6,.3,0],b.interior.color,.9,face);
        pane(v,[signX,3.1,front],[.3,1.3,0],b.interior.color,.9,face);
      }else for(let i=0;i<3;i++)pane(v,[signX-.65+i*.65,3.1,front],[.24,.6+i*.25,0],b.interior.color,.85,face);
    }
  }
  for(let y=10;y<b.h-3;y+=6){
    for(let x=-b.w/2+4;x<b.w/2-2;x+=8){
      const light=rand()>.55?'#eac7a0':neon;
      for(const side of [-1,1])if(rand()>.24){
        const z=b.z+side*(b.d/2+.045),face=side>0?4:5;
        pane(v,[b.x+x,y,z],[2.8,3.3,0],'#111b2a',0,face);
        const glow=.3+rand()*.3;
        for(const half of [-1,1])pane(v,[b.x+x+half*.57,y+.25,z+side*.2],[1.06,2.3,0],light,glow,face);
      }
    }
    for(let z=-b.d/2+4;z<b.d/2-2;z+=7)for(const side of [-1,1])if(rand()>.32)pane(v,[b.x+side*(b.w/2+.2),y,b.z+z],[0,2.6,2.3],neon,.4,side>0?0:1);
    if(Math.round(y)%18===10)for(const side of [-1,1])box(v,[b.x,y-2,b.z+side*(b.d/2+.25)],[b.w,.24,.5],'#526071');
  }
  const side=b.x>0?-1:1;
  bevelBox(v,[b.x+side*(b.w/2+.65),b.h*.58,b.z],[1.2,Math.min(32,b.h*.4),3.5],'#111b29');
  box(v,[b.x+side*(b.w/2+1.28),b.h*.58,b.z],[.06,Math.min(29,b.h*.35),.6],neon,.9);
  if(rand()>.35){
    bevelBox(v,[b.x,b.h+3,b.z],[b.w*.46,6,b.d*.48],'#465060',0,0,.7);
    box(v,[b.x,b.h+10,b.z],[.3,9,.3],'#88969e');
    ellipsoid(v,[b.x,b.h+14.6,b.z],[.65,.65,.65],neon,.9,0,8);
  }
}

export function buildingInterior(v,b,data) {
  const room=b.interior,h=data.interiors.height,accent=room.color;
  box(v,[b.x,.025,b.z],[b.w-.8,.05,b.d-.8],'#424452',.08);
  pane(v,[b.x,h-.005,b.z],[b.w-1.6,0,b.d-1.6],'#697078',.12,3);
  for(const side of [-1,1]){
    box(v,[b.x+side*(b.w/2-.86),2.4,b.z],[.08,2.5,b.d-1.6],'#384151',.12);
    box(v,[b.x+side*(b.w/2-.92),.18,b.z],[.05,.16,b.d-1.8],accent,.65);
    for(const z of [-b.d*.28,0,b.d*.28]){
      box(v,[b.x+side*b.w*.26,h-.06,b.z+z],[3,.1,.8],'#f4d5b2',.8);
      box(v,[b.x+side*b.w*.26,.065,b.z+z],[3,.015,2.8],'#706052',.12);
    }
  }
  // Two clear, opposing entrances and a five-meter aisle through every layout.
  for(const item of b.solids.filter(s=>!['wall','upper'].includes(s.kind))){
    const p=item.center,s=item.size,top=p[1]+s[1]/2;
    bevelBox(v,p,s,item.kind==='bed'?'#788c94':'#323b4b',.04,0,.12);
    if(item.kind==='cabinet'){
      pane(v,[p[0],p[1]+.3,p[2]+s[2]/2+.01],[s[0]*.65,s[1]*.5,0],accent,.38,4);
      for(let i=0;i<3;i++)box(v,[p[0]-.7+i*.7,.4,p[2]+s[2]/2+.03],[.3,.1,.03],'#b4c2ce',.4);
    }else{
      box(v,[p[0],top-.035,p[2]],[s[0]-.1,.06,s[2]-.1],item.kind==='bed'?'#b0bbbc':item.kind==='bench'?'#65485a':'#9c8475',.12);
      if(item.kind==='bed')bevelBox(v,[p[0],top+.12,p[2]-s[2]*.32],[s[0]*.7,.24,.8],'#d9d1c0');
      if(item.kind==='counter'){
        bevelBox(v,[p[0],top+.3,p[2]-1],[.9,.6,.6],'#192535');
        pane(v,[p[0],top+.4,p[2]-.69],[.65,.28,0],accent,.8,4);
      }
    }
  }
  // Wall displays, service pipes and a ceiling rail give the room a readable scale.
  for(const side of [-1,1]){
    box(v,[b.x+side*(b.w/2-1),h-.6,b.z],[.25,.25,b.d-1.8],'#8b7772');
    pane(v,[b.x+side*(b.w/2-.91),3.9,b.z],[0,1.4,3.2],accent,.4,side>0?1:0);
  }
}

export function streetDetails(v,b) {
  const rand=random(b.seed+21),x=b.x-b.w/2-2,z=b.z;
  bevelBox(v,[x,.45,z],[1.3,.9,3.8],'#3a4655');
  for(const side of [-1,1]){
    const px=b.x+side*(b.w/2+2),pz=b.z-b.d/2-2;
    box(v,[px,3.6,pz],[.13,7.2,.13],'#637382');
    box(v,[px,7.1,pz],[.18,.15,2.4],'#cde8ef',.85);
  }
  for(let i=0;i<3;i++){
    const px=b.x-b.w/2-1.2,pz=b.z+b.d/2-4-i*3;
    bevelBox(v,[px,.45,pz],[1.4,.9,1.8],rand()>.5?'#5a5763':'#5b6a69');
    box(v,[px,.94,pz],[1.15,.08,.12],'#efb477',.25);
  }
}

// Small, open street workspaces sit behind the existing interaction terminals.
export function neighborhoodDetails(v, neighborhood, sites) {
  const accent = neighborhood.color;
  for (const site of sites) {
    const [x,y,z] = site.position;
    box(v,[x,y+.035,z+1.6],[4,.045,1],accent,.18);
    if (neighborhood.motif === 'garden') {
      bevelBox(v,[x,y+.4,z-2],[3.5,.8,1.4],'#47584d');
      for(let i=0;i<5;i++){
        box(v,[x-1.3+i*.65,y+1.1,z-2],[.06,.8,.06],'#9bb379');
        ellipsoid(v,[x-1.3+i*.65,y+1.3,z-2],[.6,.3,.5],accent,0,0,6);
      }
      box(v,[x,y+.9,z-3],[4,.12,.12],'#9aafa8');
    } else if (neighborhood.motif === 'archive') {
      for(const side of [-1,1]){
        bevelBox(v,[x+side*1.25,y+1.1,z-2],[1.1,2.2,1],'#394151');
        for(let i=0;i<4;i++) box(v,[x+side*1.25,y+.35+i*.5,z-1.48],[.8,.12,.04],accent,.6);
      }
    } else if (neighborhood.motif === 'workshop') {
      bevelBox(v,[x,y+.8,z-2],[3.6,1.6,1.2],'#4b4144');
      for(let i=0;i<4;i++)box(v,[x-1.2+i*.8,y+1.7,z-2],[.35,.2,.6],'#bc9f87');
      box(v,[x,y+2.3,z-2.6],[4,.18,.18],'#7c7770');
    } else {
      const market = neighborhood.motif === 'market';
      for(const side of [-1,1])box(v,[x+side*2.2,y+1.9,z-2],[.12,3.8,.12],'#72858b');
      bevelBox(v,[x,y+3.8,z-1.7],[4.8,.2,2.8],market?'#765364':'#304b5c');
      box(v,[x,y+3.65,z-.25],[4.5,.08,.08],accent,.9);
      bevelBox(v,[x,y+.65,z-2],[3.5,1.3,1.1],market?'#605346':'#3d485a');
      if(market)for(let i=0;i<3;i++)ellipsoid(v,[x-1+i,y+1.4,z-2],[.55,.3,.55],'#c7b9a4',0,0,8);
      else pane(v,[x,y+2.3,z-2.02],[3.3,1,0],accent,.45,4);
    }
  }
}

export function civilianProps(v, actor) {
  if (!['carry','eat','work','repair','serve','tend'].includes(actor.activity)) return;
  const mesh = [], color = actor.color;
  if (actor.activity === 'carry') {
    bevelBox(mesh,[0,1.05,.55],[.85,.65,.65],'#776b61');
    box(mesh,[0,1.05,.89],[.55,.12,.03],color,.45);
  } else if (actor.activity === 'eat' || actor.activity === 'serve') {
    ellipsoid(mesh,[-.28,1.2,.45],[.4,.22,.4],'#dfc8a4',0,0,8);
    box(mesh,[.35,1.45,.5],[.035,.035,.38],'#d6b58c');
  } else if (actor.activity === 'work') {
    bevelBox(mesh,[0,1.25,.48],[.6,.08,.45],'#283747');
    box(mesh,[0,1.3,.48],[.5,.02,.33],color,.7);
  } else if (actor.activity === 'repair') {
    box(mesh,[.45,1.05,.5],[.12,.4,.12],'#a4b7bf');
    box(mesh,[.45,1.23,.5],[.28,.1,.12],color,.3);
  } else {
    bevelBox(mesh,[.4,.9,.4],[.35,.4,.4],'#819482');
    box(mesh,[.4,1,.7],[.1,.1,.4],'#b7c3aa');
  }
  // Activity props use the same yaw as the articulated body.
  transformMesh(v,mesh,actor.position,actor.yaw||0);
}
