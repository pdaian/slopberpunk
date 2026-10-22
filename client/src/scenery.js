// Original modular architecture and street furniture. GPL-3.0-or-later.
import { random } from './math.js';
import { box, pane, bevelBox, ellipsoid, slope, transformMesh } from './geometry.js';
import { pixelGlyph } from './pixel-font.js';
import { cityEvent } from './citylife.js';

export function routeGeometry(v, route, accent='#8bc6bb') {
  const {start,end,width}=route,length=Math.hypot(end[0]-start[0],end[2]-start[2]),yaw=Math.atan2(end[0]-start[0],end[2]-start[2]);
  const material=route.indoor?'#65707a':route.kind==='hill'?'#56664b':'#59636b';
  if(route.kind==='stairs'){
    for(let i=0;i<route.steps;i++){
      const t=(i+.5)/route.steps,y=start[1]+(end[1]-start[1])*(i+1)/route.steps;
      const p=[start[0]+(end[0]-start[0])*t,y-.175,start[2]+(end[2]-start[2])*t];
      box(v,p,[width,.35,length/route.steps],material,0,yaw);
      if(i%4===0)box(v,[p[0],y+.006,p[2]],[width-.25,.012,.07],accent,.2,yaw);
    }
  }else slope(v,start,end,width,material,route.kind==='hill');
  // Open ends and a handrail on each side make the route legible from below.
  for(const side of [-1,1]){
    const dx=Math.cos(yaw)*side*(width/2-.15),dz=-Math.sin(yaw)*side*(width/2-.15);
    const mesh=[],rise=end[1]-start[1];box(mesh,[0,0,0],[.09,.09,Math.hypot(length,rise)],accent,.15);
    transformMesh(v,mesh,[(start[0]+end[0])/2+dx,(start[1]+end[1])/2+1.05,(start[2]+end[2])/2+dz],yaw,-Math.atan2(rise,length));
    for(let d=0;d<=length;d+=4){const t=d/length;box(v,[start[0]+(end[0]-start[0])*t+dx,start[1]+rise*t+.5,start[2]+(end[2]-start[2])*t+dz],[.08,1,.08],'#677876');}
  }
}

function lettering(v,text,position,color,scale=.07) {
  for(const [index,char]of [...text.toUpperCase()].entries())for(const [row,bits]of (pixelGlyph(char)||[]).entries())for(let col=0;col<5;col++)if(bits&(1<<(4-col)))pane(v,[position[0]+(index*6+col)*scale,position[1]-row*scale,position[2]],[scale*.85,scale*.85,0],color,.65,4);
}

export function buildingExterior(v,b,data,neighborhoodColor=null) {
  const neon=b.identity.trim||neighborhoodColor||data.palette.neon[b.accent],concrete=b.identity.material||data.palette.concrete[b.shade],rand=random(b.seed),district=b.identity.district;
  for(const solid of b.solids)if(['wall','upper','window'].includes(solid.kind))box(v,solid.center,solid.size,solid.kind==='window'?'#567282':concrete,solid.kind==='window'?.12:0);
  const roof=b.solids.filter(s=>s.kind==='upper').at(-1)?.size||[b.w,0,b.d];
  const split=b.interior?data.interiors.height*3+(b.h-data.interiors.height*3)*.55:b.h;
  box(v,[b.x,b.h-.15,b.z],[roof[0]+.6,.3,roof[2]+.6],'#182232');
  for(const side of [-1,1]) {
    box(v,[b.x+side*(b.w/2-.15),split/2,b.z+b.d/2+.07],[.3,split,.14],'#657080');
    box(v,[b.x,b.h+.15,b.z+side*roof[2]/2],[roof[0],.15,.25],neon,.55);
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
    const width=y>split?roof[0]:b.w,depth=y>split?roof[2]:b.d;
    for(let x=-width/2+4;x<width/2-2;x+=6+b.seed%4){
      const light=rand()>.55?'#eac7a0':neon;
      for(const side of [-1,1])if(rand()>.24){
        const z=b.z+side*(depth/2+.045),face=side>0?4:5;
        pane(v,[b.x+x,y,z],[2.8,3.3,0],'#111b2a',0,face);
        const glow=.3+rand()*.3;
        for(const half of [-1,1])pane(v,[b.x+x+half*.57,y+.25,z+side*.2],[1.06,2.3,0],light,glow,face);
      }
    }
    for(let z=-depth/2+4;z<depth/2-2;z+=7)for(const side of [-1,1])if(rand()>.32)pane(v,[b.x+side*(width/2+.2),y,b.z+z],[0,2.6,2.3],neon,.4,side>0?0:1);
    if(Math.round(y)%18===10)for(const side of [-1,1])box(v,[b.x,y-2,b.z+side*(depth/2+.25)],[width,.24,.5],'#526071');
  }
  const side=b.x>0?-1:1;
  bevelBox(v,[b.x+side*(b.w/2+.65),b.h*.58,b.z],[1.2,Math.min(32,b.h*.4),3.5],'#111b29');
  box(v,[b.x+side*(b.w/2+1.28),b.h*.58,b.z],[.06,Math.min(29,b.h*.35),.6],neon,.9);
  if(rand()>.35){
    bevelBox(v,[b.x,b.h+3,b.z],[b.w*.46,6,b.d*.48],'#465060',0,0,.7);
    box(v,[b.x,b.h+10,b.z],[.3,9,.3],'#88969e');
    ellipsoid(v,[b.x,b.h+14.6,b.z],[.65,.65,.65],neon,.9,0,8);
  }
  const front=b.z+b.d/2;
  if(district==='market'){
    for(const side of [-1,1]){box(v,[b.x+side*b.w*.3,3.8,front+1.7],[b.w*.3,.16,3.4],side>0?'#80574f':'#6a6576');for(let i=0;i<4;i++)box(v,[b.x+side*b.w*.3-b.w*.12+i*b.w*.08,3.9,front+1.7],[.3,.05,3.4],neon,.12);}
  }else if(district==='archive'){
    for(const i of [-1,1])box(v,[b.x+i*b.w*.35,split*.5,front+.4],[.6,split,1.1],'#52667b');
  }else if(district==='furnace'){
    for(const side of [-1,1])box(v,[b.x+side*(b.w/2+1),split/2,b.z],[.8,split,1.1],'#94745d');
    ellipsoid(v,[b.x+b.w*.2,b.h+2.3,b.z],[5,4.6,5],'#7e7770',0,0,8);
  }else if(district==='quiet'){
    for(const y of [7.4,13.8])for(const side of [-1,1]){box(v,[b.x+side*b.w*.3,y,front+.6],[5,.7,1.3],'#8a8271');for(let i=0;i<3;i++)ellipsoid(v,[b.x+side*b.w*.3-1.5+i*1.5,y+.7,front+.6],[1.8,1.5,1.5],'#739267',2,0,6);}
  }else{
    for(const y of [8,15]){box(v,[b.x,y,front+.5],[b.w+2,.65,1.1],'#95aab4');for(let i=-1;i<=1;i++)pane(v,[b.x+i*b.w*.3,y+1.1,front+.07],[2,.5,0],neon,.65,4);}
  }
}

export function buildingInterior(v,b,data) {
  const room=b.interior,h=data.interiors.height,accent=room.color;
  box(v,[b.x,.025,b.z],[b.w-.8,.05,b.d-.8],'#424452',.08);
  for(const solid of b.solids.filter(s=>s.kind==='floor'))box(v,solid.center,solid.size,'#535963');
  pane(v,[b.x,h*3-.005,b.z],[b.w-1.6,0,b.d-1.6],'#697078',.12,3);
  for(let floor=0;floor<3;floor++)for(const side of [-1,1]){
    const y=floor*h;
    box(v,[b.x+side*(b.w/2-.86),y+2.4,b.z],[.08,2.5,b.d-1.6],'#384151',.12);
    box(v,[b.x+side*(b.w/2-.92),y+.18,b.z],[.05,.16,b.d-1.8],accent,.65);
    for(const z of [-b.d*.28,0,b.d*.28]){
      box(v,[b.x+side*b.w*.26,y+h-.6,b.z+z],[3,.1,.8],'#f4d5b2',.8);
      box(v,[b.x+side*b.w*.26,y+.065,b.z+z],[3,.015,2.8],'#706052',.12);
    }
  }
  // Two clear, opposing entrances and a five-meter aisle through every layout.
  for(const item of b.solids.filter(s=>['bed','counter','cabinet','table','bench'].includes(s.kind))){
    const p=item.center,s=item.size,top=p[1]+s[1]/2;
    bevelBox(v,p,s,item.kind==='bed'?'#788c94':'#323b4b',.04,0,.12);
    if(item.kind==='cabinet'){
      pane(v,[p[0],p[1]+.3,p[2]+s[2]/2+.01],[s[0]*.65,s[1]*.5,0],accent,.38,4);
      for(let i=0;i<3;i++)box(v,[p[0]-.7+i*.7,top-s[1]+.4,p[2]+s[2]/2+.03],[.3,.1,.03],'#b4c2ce',.4);
    }else{
      box(v,[p[0],top-.035,p[2]],[s[0]-.1,.06,s[2]-.1],item.kind==='bed'?'#b0bbbc':item.kind==='bench'?'#65485a':'#9c8475',.12);
      if(item.kind==='bed')bevelBox(v,[p[0],top+.12,p[2]-s[2]*.32],[s[0]*.7,.24,.8],'#d9d1c0');
      if(item.kind==='counter'){
        bevelBox(v,[p[0],top+.3,p[2]-1],[.9,.6,.6],'#192535');
        pane(v,[p[0],top+.4,p[2]-.69],[.65,.28,0],accent,.8,4);
      }
    }
    if(item.kind==='table'||item.kind==='counter'){
      const detail=top<h?b.identity.detail:top<h*2?(b.identity.district==='archive'?'books':'food'):{market:'plants',quiet:'plants',archive:'books',furnace:'repair',skybridge:'parcels'}[b.identity.district];
      for(let i=0;i<3;i++){
        const px=p[0]+(i-1)*.65;
        if(detail==='plants'){box(v,[px,top+.18,p[2]],[.45,.36,.5],'#97745b');ellipsoid(v,[px,top+.6,p[2]],[.55,.7,.55],'#89a56c',2,0,6);}
        else if(detail==='food')ellipsoid(v,[px,top+.12,p[2]],[.5,.24,.5],'#dcc3a0',0,0,6);
        else box(v,[px,top+.12+i%2*.08,p[2]],[detail==='parcels'?.6:.4,.24+i%2*.16,.6],detail==='books'?'#a59175':detail==='repair'?'#9ca6ab':'#c3b6a8');
      }
    }
  }
  // Wall displays, service pipes and a ceiling rail give the room a readable scale.
  for(const side of [-1,1]){
    box(v,[b.x+side*(b.w/2-1),h-.6,b.z],[.25,.25,b.d-1.8],'#8b7772');
    pane(v,[b.x+side*(b.w/2-.91),3.9,b.z],[0,1.4,3.2],accent,.4,side>0?1:0);
  }
  for(const route of b.routes)routeGeometry(v,route,accent);
  for(let floor=0;floor<3;floor++){
    const text=floor?`${floor+1} ${b.identity.upper[floor-1]}`:'1 SHOP / STAIRS INSIDE';
    lettering(v,text,[b.x-5,floor*h+3.5,b.z-b.d/2+.82],accent,.075);
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
  const front=b.z+b.d/2+.14;
  box(v,[b.x,5.25,front],[Math.min(b.w-2,b.identity.name.split(' · ')[0].length*.43+1),1,.15],'#202833');
  lettering(v,b.identity.name.split(' · ')[0],[b.x-b.identity.name.split(' · ')[0].length*.21,5.5,front+.09],b.identity.trim||'#d3c7a5');
  lettering(v,b.identity.address,[b.x-4.5,2.8,front+.09],'#e3d1b3',.045);
  // Patched panels, household drying lines and meter tags distinguish neighboring units.
  for(let i=0;i<2+b.seed%3;i++)pane(v,[b.x-b.w*.35+i*.9,1.5+i%2*.5,front+.03],[.55,.7,0],i%2?'#9f8a69':'#72878c',0,4);
  if(b.seed%3===0){box(v,[b.x,9,front+1],[b.w*.6,.035,.035],'#b9b6a9');for(let i=0;i<4;i++)box(v,[b.x-3+i*2,8.4,front+1],[1.2,1.2,.04],['#a49386','#536778','#a97474','#859178'][(b.seed+i)%4]);}
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

// Small, clock-driven scenes make the announced local work visible in the street.
export function streetScene(v,mist,n,data,epoch,time,reducedMotion,quality,eye) {
  const event=cityEvent(n,epoch),index=n.events.indexOf(event),site=data.landmarks.find(l=>l.id===n.sites[index%n.sites.length]);
  if(!site||Math.hypot(eye[0]-site.position[0],eye[1]-site.position[1],eye[2]-site.position[2])>90)return;
  const [x,y,z]=site.position,t=reducedMotion?0:time,accent=n.color;
  if(n.motif==='market'){
    if(index===1){
      bevelBox(v,[x+3,y+.7,z-1],[1.6,1,2.5],'#69645c');
      for(let i=0;i<3;i++)box(v,[x+2.6+i*.4,y+1.45,z-1],[.3,.5,.8],'#92b4b8');
      for(const side of [-1,1])ellipsoid(v,[x+3+side*.8,y+.25,z-1],[.18,.5,.5],'#202a32',0,0,6);
    }else{
      ellipsoid(v,[x,y+1.7,z-2],[1.1,.75,1.1],'#b8bab0',0,0,8);
      if(quality>.5)for(let i=0;i<3;i++){const phase=(t*.25+i/3)%1;ellipsoid(mist,[x+phase*.3,y+2+phase*1.8,z-2],[.5+phase,.4+phase,.5+phase],'#acb8b8',-Math.max(.001,.7*Math.sin(phase*Math.PI)),0,6);}
      for(let i=0;i<4;i++)ellipsoid(v,[x-1.5+i*.35,y+1.45,z-2],[.3,.12,.3],'#d3bea3',0,0,6);
    }
  }else if(n.motif==='archive'){
    for(let i=0;i<5;i++){box(v,[x-1.8+i*.7,y+1.45,z-2],[.45,.2,.7],i===index?'#d5b58f':'#b3c1d0');box(v,[x-1.8+i*.7,y+1.57,z-2],[.3,.02,.4],accent,.3);}
    box(v,[x+Math.sin(t)*1.3,y+1.8,z-2],[.06,.3,1.1],accent,.8);
  }else if(n.motif==='workshop'){
    box(v,[x,y+1.8,z-2],[1.5,.3,.6],'#a8927e');
    if(index===0&&!reducedMotion&&quality>.5)for(let i=0;i<5;i++){const phase=(t*1.8+i*.17)%1;box(v,[x+phase*(i-2)*.45,y+1.8+Math.sin(phase*Math.PI)*.6-phase*.4,z-1.8+phase*.6],[.035,.07,.035],'#ffd99a',1);}
    if(index===1)for(let i=0;i<3;i++)ellipsoid(v,[x-1+i,y+1.8,z-2],[.4,.2,.4],'#d6bc92',0,0,6);
  }else if(n.motif==='garden'){
    if(index===0){bevelBox(v,[x+1.4,y+1.1,z-2],[.55,.6,.5],'#8ba2a0');box(v,[x+1,y+1.2,z-2],[.5,.12,.12],'#adc0b3');}
    if(index===0&&!reducedMotion&&quality>.5)for(let i=0;i<8;i++){const phase=(t*.8+i/8)%1;box(v,[x-1.2+i*.34,y+1.8-phase*.7,z-2],[.025,.09,.025],'#9ed4d1',.25);}
    if(index===1)for(let i=0;i<4;i++)pane(v,[x-1.3+i*.85,y+1.1,z-2.75],[.55,.75,0],'#d4c7a0',.1,4);
    if(index===2)for(let i=0;i<3;i++)box(v,[x-.7+i*.7,y+1.15,z-3],[.3,.12,.15],accent,reducedMotion?.5:(Math.floor(t)%3===i?.9:.1));
  }else{
    for(let i=0;i<4;i++)pane(v,[x-1.3+i*.85,y+2.3,z-1.99],[.45,.18,0],i===Math.floor(t/5)%4?'#e3cb8b':accent,.75,4);
    if(index===2)for(let i=0;i<3;i++)box(v,[x-1+i,y+1.6,z-2],[.65,.55,.6],'#a58a6c');
  }
}
