// Original modular architecture and street furniture. GPL-3.0-or-later.
import { random } from './math.js';
import { box, pane, bevelBox, ellipsoid, slope, transformMesh, lettering } from './geometry.js';
import { venueGeometry, elevatorShaft } from './elevator-scenery.js';
import { cityEvent } from './citylife.js';

export function routeGeometry(v, route, accent='#8bc6bb') {
  const {start,end,width}=route,length=Math.hypot(end[0]-start[0],end[2]-start[2]),yaw=Math.atan2(end[0]-start[0],end[2]-start[2]);
  if(route.kind==='street'){
    slope(v,start,end,width,'#303b49');
    const rise=end[1]-start[1],pitch=-Math.atan2(rise,length),span=Math.hypot(length,rise),paint=[];
    const color=Math.max(start[1],end[1])>=48?'#dab587':'#81c9ca';
    // Flush markings leave junctions open; broad edge lanes serve as sidewalks.
    for(const side of [-1,1]){
      pane(paint,[side*(width/2-1.15),.012,0],[2.3,0,span],'#536270',0,2);
      pane(paint,[side*(width/2-.2),.02,0],[.16,0,span],color,.65,2);
      pane(paint,[side*(width/2-2.5),.02,0],[.12,0,span],color,.15,2);
    }
    for(let d=4;d<length-4;d+=12)pane(paint,[0,.02,(d/length-.5)*span],[.18,0,Math.min(4,length-4-d)*span/length],'#dbcaa0',.15,2);
    transformMesh(v,paint,start.map((n,i)=>(n+end[i])/2),yaw,pitch);
    return;
  }
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

export function tutorialGeometry(v, data) {
  const area=data.tutorial;
  if(!area)return;
  const [x,y,z]=area.center,accent=area.color;
  box(v,[x,y-.01,z],[36,.04,36],'#30464e');
  // Painted lanes and low lights keep the courtyard open and walkable.
  for(let i=0;i<32;i++){
    const a=i/32*Math.PI*2;
    box(v,[x+Math.sin(a)*area.radius,y+.04,z+Math.cos(a)*area.radius],[.13,.08,3.7],accent,.6,a+Math.PI/2);
  }
  const beacon=data.landmarks.find(l=>l.id===area.beacon).position;
  for(let i=0;i<5;i++)box(v,[area.spawn[0],y+.03,area.spawn[2]+(beacon[2]-area.spawn[2])*i/5],[1.4,.04,.6],accent,.65);
  const target=data.landmarks.find(l=>l.id===area.target).position;
  box(v,[target[0],target[1]+.65,target[2]],[.3,1.3,.3],'#657580');
  for(const [size,depth,color]of [[2.5,0,'#f5b176'],[1.7,.05,'#24343d'],[.9,.1,'#f5b176'],[.3,.15,'#fff1cf']]){
    box(v,[target[0],target[1]+2,target[2]+depth],[size,size,.12],color,.55);
  }
  box(v,[beacon[0],beacon[1]+.03,beacon[2]],[4,.06,4],accent,.6);
  box(v,[beacon[0],beacon[1]+.07,beacon[2]],[3.4,.02,3.4],'#30464e');
  const gate=data.landmarks.find(l=>l.id===area.exit).position;
  for(const side of [-1,1])box(v,[gate[0]+side*2.4,gate[1]+2,gate[2]],[.25,4,.25],'#c4ed92',.65);
  box(v,[gate[0],gate[1]+4,gate[2]],[5,.3,.25],'#c4ed92',.7);
  lettering(v,'COMMONS',[gate[0]-1.65,gate[1]+3.55,gate[2]+.2],'#c4ed92',.08);
  lettering(v,'FIRST STEPS',[x-3.2,y+3.5,z-20],accent,.1);
}

const districtLights = {
  market: ['#ffba62','#ff6095','#6ce8cd','#ffe2ab'],
  archive: ['#a99aff','#6ac9ff','#e7b7f5','#8ce5ec'],
  furnace: ['#ff914f','#efc567','#f26667','#91d8ce'],
  quiet: ['#b4d789','#75cbb9','#d4a4cf','#e4c49a'],
  skybridge: ['#64deed','#809dff','#f579af','#d9e9ff']
};

export function buildingStyle(b) {
  const palette=districtLights[b.identity.district]||districtLights.skybridge;
  return {neon:palette[b.seed%4],secondary:palette[(b.seed%4+1+b.accent%2)%4],
    window:['#ffd69a','#ffad79','#9acfd8','#bcb4ed','#d8e8db'][b.seed%5],
    occupancy:.24+(b.seed%11)*.055,pattern:Math.floor(b.seed/7)%4,roof:Math.floor(b.seed/13)%4,
    lamp:['#ffc080','#a8dce8','#e9dfbc'][b.seed%3]};
}

// Geometry, surface lighting and glints share these fixtures. Direction encodes
// the outward wall normal (+/-1 = X, +/-2 = Z, 0 = downward).
export function buildingLights(b) {
  const style=buildingStyle(b),side=b.x>0?-1:1,lights=[];
  for(const wing of [-1,1])if((b.seed+(wing+1)*3)%5>1)lights.push({kind:'lamp',
    position:[b.x+wing*(b.w/2+2),7,b.z-b.d/2-2],color:style.lamp,radius:13,direction:0,size:2.8,strength:.85});
  lights.push({kind:'entry',position:[b.x,b.interior?4.35:5.25,b.z+b.d/2+(b.interior?1.56:.3)],
    color:b.interior?.color||style.neon,radius:14,direction:2,size:3.5,strength:.7});
  lights.push({kind:'sign',position:[b.x+side*(b.w/2+1.34),b.h*.58,b.z],
    color:style.neon,radius:17,direction:side,size:3,strength:.8});
  if(b.rooftop)for(const side of [-1,1])lights.push({kind:'roof',position:[b.x,b.h+3.5,b.z+side*(b.d/2-1.5)],color:b.rooftop.venue?.accent||style.neon,radius:16,direction:0,size:2.5,strength:.8});
  else lights.push({kind:'beacon',position:[b.x,b.h+[14.6,5.4,9.2,2.8][style.roof],b.z],
    color:b.seed%2?'#ff7967':'#a4e4ef',radius:5,direction:0,size:1.8,strength:.65});
  if(b.rooftop?.venue)for(const y of [0,b.h])lights.push({kind:'elevator',position:[b.x,y+4.3,b.z+b.d/2+4],color:b.rooftop.venue.accent,radius:12,direction:0,size:2,strength:.9});
  return lights;
}

export function buildingExterior(v,b,data,lights=null) {
  const style=buildingStyle(b),neon=style.neon,concrete=b.identity.material||data.palette.concrete[b.shade],rand=random(b.seed),district=b.identity.district;
  for(const solid of b.solids)if(['wall','upper','window'].includes(solid.kind))box(v,solid.center,solid.size,solid.kind==='window'?'#263a48':concrete,solid.kind==='window'?.04:0);
  const roof=b.solids.filter(s=>s.kind==='upper').at(-1)?.size||[b.w,0,b.d];
  const split=b.interior?data.interiors.height*3+(b.h-data.interiors.height*3)*.55:b.h;
  if(!b.rooftop)box(v,[b.x,b.h-.15,b.z],[roof[0]+.6,.3,roof[2]+.6],'#182232');
  for(const side of [-1,1]) {
    box(v,[b.x+side*(b.w/2-.15),split/2,b.z+b.d/2+.07],[.3,split,.14],'#657080');
    if(style.pattern!==3)box(v,[b.x,b.h+.15,b.z+side*roof[2]/2],[roof[0]*(style.pattern===1?.6:1),.15,.25],style.secondary,.7);
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
      for(const side of [-1,1]){
        const z=b.z+side*(depth/2+.045),face=side>0?4:5;
        pane(v,[b.x+x,y,z],[2.8,3.3,0],'#111b2a',0,face);
        const lit=rand()<style.occupancy*(side>0?1:.65),light=rand()>.25?style.window:style.secondary;
        const glow=lit?.4+rand()*.48:0,height=style.pattern===2?1.15:2.3;
        if(style.pattern===1)pane(v,[b.x+x,y+.25,z+side*.08],[2.45,height,0],lit?light:'#1b2b39',glow,face);
        else for(const half of [-1,1])pane(v,[b.x+x+half*.57,y+.25,z+side*.08],[1.06,height,0],lit?light:'#1b2b39',glow,face);
        if(lit&&style.pattern===3)for(let slat=0;slat<3;slat++)pane(v,[b.x+x,y-.45+slat*.65,z+side*.14],[2.5,.16,0],'#26323d',0,face);
        if(lit&&glow>.6&&(Math.round(x)*7+y+b.seed)%17===0)lights?.push({kind:'window',position:[b.x+x+(style.pattern===1?0:.57),y+.25,z+side*.18],color:light,radius:0,direction:side*2,size:1.8,strength:.3});
      }
    }
    for(let z=-depth/2+4;z<depth/2-2;z+=7)for(const side of [-1,1]){
      const lit=rand()<style.occupancy*.55;
      pane(v,[b.x+side*(width/2+.06),y,b.z+z],[0,style.pattern===2?1.2:2.6,2.3],lit?style.window:'#172633',lit?.35+rand()*.35:0,side>0?0:1);
    }
    if(Math.round(y)%18===10)for(const side of [-1,1])box(v,[b.x,y-2,b.z+side*(depth/2+.25)],[width,.24,.5],'#526071');
  }
  const side=b.x>0?-1:1;
  bevelBox(v,[b.x+side*(b.w/2+.65),b.h*.58,b.z],[1.2,Math.min(32,b.h*.4),3.5],'#111b29');
  const length=Math.min(29,b.h*.35),segments=style.pattern===0?1:style.pattern===1?5:3;
  for(let i=0;i<segments;i++)box(v,[b.x+side*(b.w/2+1.28),b.h*.58+(i-(segments-1)/2)*length/segments,b.z],[.06,length/segments-.25,style.pattern===2?2.5:.6],i%2?style.secondary:neon,.95);
  if(b.rooftop)rooftopGeometry(v,b);
  else if(style.roof===0){
    bevelBox(v,[b.x,b.h+3,b.z],[b.w*.46,6,b.d*.48],'#465060',0,0,.7);
    box(v,[b.x,b.h+10,b.z],[.3,9,.3],'#88969e');
  }else if(style.roof===1){
    for(const wing of [-1,1]){box(v,[b.x+wing*3,b.h+1,b.z],[.3,2,5],'#51565d');bevelBox(v,[b.x+wing*3,b.h+3,b.z],[4.4,3,6],'#667377',0,0,.4);}
    box(v,[b.x,b.h+3,b.z],[.16,5,.16],'#8c989f');
  }else if(style.roof===2){
    for(let i=0;i<3;i++){box(v,[b.x+(i-1)*3,b.h+3+i,b.z],[1.5,6+i*2,1.5],'#65574f');box(v,[b.x+(i-1)*3,b.h+6+i*2,b.z],[2,.3,2],'#29313a');}
    box(v,[b.x,b.h+8.5,b.z],[.15,1.4,.15],'#88969e');
  }else{
    box(v,[b.x,b.h+1.2,b.z],[b.w*.45,2.4,3],'#4b5a62');
    for(let i=-2;i<=2;i++)box(v,[b.x+i*2,b.h+2.5,b.z],[.2,.15,3],style.secondary,.45);
  }
  for(const lamp of buildingLights(b))if(lamp.kind==='beacon')ellipsoid(v,lamp.position,[.42,.42,.42],lamp.color,1,0,6);
  for(const wing of [-1,1]){
    const x=b.x+wing*(b.w/2+2),z=b.z-b.d/2-2,lit=(b.seed+(wing+1)*3)%5>1;
    box(v,[x,3.6,z],[.13,7.2,.13],'#4c5965');
    box(v,[x,7.1,z],[.18,.15,2.4],lit?style.lamp:'#35404a',lit?.95:0);
  }
  const front=b.z+b.d/2;
  if(!b.interior)box(v,[b.x,5.25,front+.24],[3,.12,.08],neon,.85);
  if(district==='market'){
    for(const side of [-1,1]){box(v,[b.x+side*b.w*.3,3.8,front+1.7],[b.w*.3,.16,3.4],side>0?'#80574f':'#6a6576');for(let i=0;i<4;i++)box(v,[b.x+side*b.w*.3-b.w*.12+i*b.w*.08,3.9,front+1.7],[.3,.05,3.4],neon,.12);}
  }else if(district==='archive'){
    for(const i of [-1,1])box(v,[b.x+i*b.w*.35,split*.5,front+.4],[.6,split,1.1],'#52667b');
  }else if(district==='furnace'){
    for(const side of [-1,1])box(v,[b.x+side*(b.w/2+1),split/2,b.z],[.8,split,1.1],'#94745d');
    if(!b.rooftop)ellipsoid(v,[b.x+b.w*.2,b.h+2.3,b.z],[5,4.6,5],'#7e7770',0,0,8);
  }else if(district==='quiet'){
    for(const y of [7.4,13.8])for(const side of [-1,1]){box(v,[b.x+side*b.w*.3,y,front+.6],[5,.7,1.3],'#8a8271');for(let i=0;i<3;i++)ellipsoid(v,[b.x+side*b.w*.3-1.5+i*1.5,y+.7,front+.6],[1.8,1.5,1.5],'#739267',2,0,6);}
  }else{
    for(const y of [8,15]){box(v,[b.x,y,front+.5],[b.w+2,.65,1.1],'#95aab4');for(let i=-1;i<=1;i++)pane(v,[b.x+i*b.w*.3,y+1.1,front+.07],[2,.5,0],neon,.65,4);}
  }
}

export function buildingInterior(v,b,data) {
  const room=b.interior,h=data.interiors.height,accent=room.color,levels=b.levels.slice(0,-1);
  box(v,[b.x,.025,b.z],[b.w-.8,.05,b.d-.8],'#424452',.08);
  for(const solid of b.solids.filter(s=>s.kind==='floor'&&(!b.rooftop||s.center[1]+s.size[1]/2<b.h-.01)))box(v,solid.center,solid.size,'#535963');
  if(!b.rooftop)pane(v,[b.x,h*3-.005,b.z],[b.w-1.6,0,b.d-1.6],'#697078',.12,3);
  for(const [floor,y]of levels.entries())for(const side of [-1,1]){
    const ceiling=b.levels[floor+1];
    box(v,[b.x+side*(b.w/2-.86),y+2.4,b.z],[.08,2.5,b.d-1.6],'#384151',.12);
    box(v,[b.x+side*(b.w/2-.92),y+.18,b.z],[.05,.16,b.d-1.8],accent,.65);
    for(const z of [-b.d*.28,0,b.d*.28]){
      box(v,[b.x+side*b.w*.26,ceiling-.6,b.z+z],[3,.1,.8],'#f4d5b2',.8);
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
  for(const [floor,y]of levels.entries()){
    const text=floor?`${floor+1} ${b.identity.upper[floor-1]||'ROOF STAIRS'}`:'1 SHOP / STAIRS INSIDE';
    lettering(v,text,[b.x-5,y+3.5,b.z-b.d/2+.82],accent,.075);
    if(b.rooftop)lettering(v,'ROOF UP / STREET DOWN',[b.x-5,y+2.8,b.z-b.d/2+.83],b.identity.trim,.06);
  }
}

// Featured roofs use the same slab openings, parapets and fixture boxes as movement.
export function rooftopGeometry(v,b) {
  if(b.rooftop.venue){venueGeometry(v,b);elevatorShaft(v,b);return;}
  const {x,z,h}=b,accent=b.identity.trim,kind=b.rooftop.kind;
  for(const s of b.solids){
    if(s.kind==='floor'&&Math.abs(s.center[1]+s.size[1]/2-h)<.01)box(v,s.center,s.size,kind==='quiet'?'#617360':'#515967');
    if(s.kind==='parapet'){box(v,s.center,s.size,'#687782');box(v,[s.center[0],h+.94,s.center[2]],[s.size[0],.08,s.size[2]],accent,.55);}
    if(s.kind!=='roof-fixture')continue;
    const [px,,pz]=s.center;
    bevelBox(v,s.center,s.size,{market:'#8e6b57',archive:'#53647c',furnace:'#756257',quiet:'#82775c',skybridge:'#4e6975'}[kind],0,0,.12);
    if(kind==='market'){
      box(v,[px,h+1.23,pz],[3.2,.06,3.2],'#b69377');
      for(let i=-1;i<=1;i++)ellipsoid(v,[px+i*.8,h+1.38,pz],[.55,.2,.55],'#e0ceb0',0,0,6);
      ellipsoid(v,[px,h+3.4,pz],[.9,1.2,.9],accent,.85,0,8);
      box(v,[px,h+4.1,pz],[.04,.6,.04],'#8a8881');
    }else if(kind==='archive'){
      if(pz<z){
        ellipsoid(v,[px,h+2,pz],[2.7,1.5,2.7],'#a4bbc5',0,0,10);
        box(v,[px,h+3.3,pz],[.16,2,.16],accent,.4);
        for(const side of [-1,1])box(v,[px+side*.85,h+2.7,pz],[.12,1.3,.12],accent,.65);
      }else for(let i=0;i<4;i++){box(v,[px-1+i*.65,h+1.35,pz],[.45,.3,.9],i%2?'#a99ac0':'#d3bd94');}
    }else if(kind==='furnace'){
      for(let i=-2;i<=2;i++)box(v,[px+i*.5,h+1.4,pz],[.16,.4,2.6],'#a5a5a0');
      if(pz<z){box(v,[px,h+3.3,pz],[.22,4.2,.22],'#a9b7bb');for(let i=0;i<3;i++)box(v,[px,h+3+i*.7,pz],[3-i*.6,.12,.12],accent,.35);}
    }else if(kind==='quiet'){
      box(v,[px,h+1.23,pz],[2.75,.08,2.75],'#394c3c');
      for(let i=-1;i<=1;i++)ellipsoid(v,[px+i*.75,h+1.9,pz],[.85,1.4,1.8],i%2?'#80a878':'#b4c987',0,0,6);
      if(pz<z){box(v,[px,h+3.8,pz],[3.3,.12,.12],'#b2b99e');for(const side of [-1,1])box(v,[px+side*1.45,h+2.55,pz],[.08,2.7,.08],'#b2b99e');}
    }else{
      for(let i=-1;i<=1;i++)box(v,[px+i*.85,h+1.28,pz],[.75,.15,2.7],'#93a6b1');
      if(pz<z){box(v,[px,h+2.6,pz],[2.6,2,.2],'#263c50');for(let i=0;i<4;i++)pane(v,[px,h+2+i*.35,pz+.11],[2.2,.12,0],accent,.65,4);}
    }
  }
  if(kind==='market')for(const side of [-1,1])box(v,[x,h+4.4,z+side*5],[16,.05,.05],'#8d9286');
  for(const light of buildingLights(b).filter(l=>l.kind==='roof')){
    box(v,[light.position[0],h+1.7,light.position[2]],[.12,3.4,.12],'#7b8c91');
    box(v,light.position,[2,.16,.6],light.color,.9);
  }
  lettering(v,'STAIRS TO STREET',[x-3,h+.65,z-b.d/2+.18],accent,.06);
  lettering(v,b.rooftop.name,[x-b.rooftop.name.length*.18,h+.65,z+b.d/2+.18],accent,.06);
}

export function streetDestination(v,b) {
  const {x,z}=b,front=z+b.d/2,kind=b.rooftop.kind,accent=b.identity.trim;
  // Stalls hug the facade. Both doorways, sidewalk loops and stair approaches stay open.
  for(const solid of b.solids.filter(s=>s.kind==='street-fixture')){
    const [px,,pz]=solid.center;
    box(v,solid.center,solid.size,'#635e5c');
    if(kind==='market'){
      box(v,[px,4,pz],[4,.18,2.6],px>x?'#a37567':'#827591');
      for(let i=-1;i<=1;i++)ellipsoid(v,[px+i*.8,1.4,pz],[.55,.4,.55],i%2?'#e5b468':'#b8cc8b',0,0,6);
    }else if(kind==='archive'){
      for(let i=0;i<5;i++)box(v,[px-1+i*.5,1.65,pz],[.3,.9,.7],i%2?'#ae9cc4':'#c8b38a');
      box(v,[px,2.2,pz],[3.2,.12,1.6],'#627586');
    }else if(kind==='furnace'){
      for(let i=-1;i<=1;i++)bevelBox(v,[px+i*.8,1.4,pz],[.55,.4,.7],'#b29d83');
      box(v,[px,2.2,pz-.6],[3,.15,.12],accent,.35);
    }else if(kind==='quiet'){
      for(let i=-1;i<=1;i++){box(v,[px+i*.8,1.35,pz],[.6,.3,.7],'#9c8569');ellipsoid(v,[px+i*.8,1.8,pz],[.6,.9,.6],'#b5ce91',0,0,6);}
    }else{
      box(v,[px,4,pz],[4,.18,2.6],'#4f7081');
      pane(v,[px,2.4,front+.15],[3,1.2,0],accent,.45,4);
      for(let i=-1;i<=1;i++)box(v,[px+i*.8,1.45,pz],[.6,.5,.65],'#b49c7b');
    }
    for(let i=0;i<3;i++)box(v,[px-1+i,.025,front+4.5],[.5,.04,.6],accent,.25);
  }
  box(v,[x,6.2,front+.3],[b.w-2,.9,.15],'#23333e');
  lettering(v,b.rooftop.street,[x-b.rooftop.street.length*.18,6.45,front+.4],accent,.06);
  lettering(v,b.rooftop.venue?'OBSERVATION ELEVATOR':'ROOF / STAIRS INSIDE',[x-3.4,3.85,front+.15],accent,.06);
}

export function streetDetails(v,b) {
  const rand=random(b.seed+21),style=buildingStyle(b),x=b.x-b.w/2-2,z=b.z;
  bevelBox(v,[x,.45,z],[1.3,.9,3.8],'#3a4655');
  for(let i=0;i<3;i++){
    const px=b.x-b.w/2-1.2,pz=b.z+b.d/2-4-i*3;
    bevelBox(v,[px,.45,pz],[1.4,.9,1.8],rand()>.5?'#5a5763':'#5b6a69');
    box(v,[px,.94,pz],[1.15,.08,.12],'#efb477',.25);
  }
  const front=b.z+b.d/2+.14;
  box(v,[b.x,5.25,front],[Math.min(b.w-2,b.identity.name.split(' · ')[0].length*.43+1),1,.15],'#202833');
  lettering(v,b.identity.name.split(' · ')[0],[b.x-b.identity.name.split(' · ')[0].length*.21,5.5,front+.09],style.neon);
  lettering(v,b.identity.address,[b.x-4.5,2.8,front+.09],'#e3d1b3',.045);
  // Patched panels, household drying lines and meter tags distinguish neighboring units.
  for(let i=0;i<2+b.seed%3;i++)pane(v,[b.x-b.w*.35+i*.9,1.5+i%2*.5,front+.03],[.55,.7,0],i%2?'#9f8a69':'#72878c',0,4);
  if(b.seed%3===0){box(v,[b.x,9,front+1],[b.w*.6,.035,.035],'#b9b6a9');for(let i=0;i<4;i++)box(v,[b.x-3+i*2,8.4,front+1],[1.2,1.2,.04],['#a49386','#536778','#a97474','#859178'][(b.seed+i)%4]);}
  // Wall-hugging clutter leaves the entrances and the central crossing clear.
  for(let i=0;i<5;i++){
    const pz=b.z-b.d*.35+i*2.1;
    pane(v,[x,.018,pz],[.25+rand()*.5,0,.3+rand()*.5],i%2?'#a39a84':'#66787d',0,2,rand()*3);
    pane(v,[b.x-b.w/2-.02,1.5+rand(),pz],[0,.6+rand(),.5+rand()*.4],['#817961','#4d6265','#806373'][i%3],0,1);
  }
  pane(v,[x,.025,z+5],[1.5,0,2.6],'#111b22',0,2);
  for(let i=0;i<7;i++)box(v,[x,.04,z+4+i*.3],[1.4,.025,.06],'#4c565b');
  for(let i=0;i<3;i++)box(v,[b.x-b.w/2-.12,5.7+i*.22,b.z],[.07,.06,b.d*.85],i%2?'#66554c':'#28333d');
  lettering(v,['NIGHT SHIFT','KEEP CLEAR','REPAIR 03','NO SIGNAL'][b.seed%4],[b.x+b.w*.23,1.7,front+.05],'#a39888',.045,0);
  if(b.seed%2===0){
    box(v,[b.x+b.w*.3,2.5,front+.16],[2.6,2.9,.18],'#323c46');
    for(let i=0;i<7;i++)pane(v,[b.x+b.w*.3,1.3+i*.35,front+.26],[2.5,.07,0],'#737b7d',0,4);
  }
  if(b.rooftop)streetDestination(v,b);
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

export function upperStreetDetails(v, block, neighborhood) {
  const mesh=[],accent=neighborhood.color;
  neighborhoodDetails(mesh,neighborhood,[{position:[0,0,0]}]);
  const label={market:'HOT BOWLS',archive:'READING STOP',workshop:'REPAIR BENCH',garden:'SEED EXCHANGE',transit:'NIGHT CONNECTION'}[neighborhood.motif];
  box(mesh,[-2.4,2.25,-2.5],[.12,4.5,.12],'#72858b');
  box(mesh,[0,4.45,-2.5],[4.9,.12,.16],accent,.9);
  box(mesh,[0,3.25,-2.3],[4.5,.8,.12],'#202833');
  lettering(mesh,label,[-label.length*.12,3.45,-2.22],accent,.04);
  transformMesh(v,mesh,block.position,block.yaw);
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
