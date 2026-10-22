// Original WebGL renderer and geometry — GPL-3.0-or-later.
import { color, random, perspective, lookAt, multiply, project, distance } from './math.js';
import { daylight } from './clock.js';
import { tabardParts } from './tabard.js';
import { hasFounderHalo, founderHaloParts } from './founders.js';
import { ghostPosition } from './ghostline.js';
import { dungeonZones, dungeonPosition } from './dungeons.js';
import { box, pane, bevelBox, ellipsoid, transformMesh } from './geometry.js';
import { CharacterMeshes } from './character.js';
import { buildingExterior, buildingInterior, streetDetails, neighborhoodDetails, civilianProps } from './scenery.js';
import { cityStage } from './citylife.js';
import { incidentGeometry } from './events.js';
export { box } from './geometry.js';

const vertexSource = `
attribute vec3 aPosition; attribute vec3 aNormal; attribute vec3 aColor; attribute float aGlow;
uniform mat4 uMatrix; uniform mediump vec3 uEye; uniform mediump vec3 uSun; uniform mediump float uDay; uniform mediump float uTime;
varying mediump vec3 vColor; varying mediump float vGlow; varying mediump vec3 vPosition; varying mediump vec3 vNormal;
void main(){
  float light=mix(.48,.58,uDay)+max(dot(aNormal,normalize(uSun)),0.0)*.46*uDay;
  // Scenery glow values >= 2 mark rooted plants; the remainder is emission.
  vGlow=aGlow>=2.0?aGlow-2.0:aGlow;
  vec3 position=aPosition;
  if(aGlow>=2.0){float bend=sin(uTime*.8+aPosition.x*.12+aPosition.z*.07)*.055*clamp(aPosition.y,0.,15.);position.x+=bend;position.z+=bend*.4;}
  vColor=aColor*mix(light,1.35,max(0.0,vGlow));
  vPosition=position; vNormal=aNormal; gl_Position=uMatrix*vec4(position,1.0);
}`;
const fragmentSource = `
precision mediump float; varying mediump vec3 vColor; varying mediump float vGlow; varying mediump vec3 vPosition; varying mediump vec3 vNormal;
uniform vec3 uFog; uniform mediump vec3 uEye; uniform mediump vec3 uSun; uniform mediump float uDay; uniform float uVolume; uniform float uTime; uniform float uDetail; uniform vec4 uRoom; uniform float uRoomHeight;
float hash(vec2 p){p=mod(p,251.0);return fract(sin(dot(p,vec2(12.9898,78.233)))*437.585);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);}
// Analytic ray/cylinder intersection, clipped to the lamp's height and opaque surface.
// A midpoint radial falloff approximates a cone: no ray marching or offscreen buffers.
float shaft(vec3 ray,float end,vec2 lamp){
  vec2 offset=uEye.xz-lamp;
  float a=dot(ray.xz,ray.xz), b=dot(offset,ray.xz), c=dot(offset,offset)-12.25;
  float lo=0.0,hi=end;
  if(a<.0001){if(c>0.0)return 0.0;}
  else{float d=b*b-a*c;if(d<=0.0)return 0.0;d=sqrt(d);lo=max(lo,(-b-d)/a);hi=min(hi,(-b+d)/a);}
  if(abs(ray.y)<.0001){if(uEye.y<0.0||uEye.y>9.6)return 0.0;}
  else{float t0=-uEye.y/ray.y,t1=(9.6-uEye.y)/ray.y;lo=max(lo,min(t0,t1));hi=min(hi,max(t0,t1));}
  if(hi<=lo)return 0.0;
  vec3 mid=uEye+ray*(lo+hi)*.5;
  float radius=.35+(9.6-mid.y)*.32;
  float density=1.0-smoothstep(radius*.25,radius,length(mid.xz-lamp));
  return (1.0-exp(-(hi-lo)*.065))*density;
}
void main(){
  // Fragment distance keeps large ground polygons from inheriting fog from distant corners.
  vec3 offset=(vPosition-uEye)*.001;
  float d=length(offset)*1000.0;vec3 ray=normalize(offset),normal=normalize(vNormal),surface=vColor;
  float indoors=step(abs(vPosition.x-uRoom.x),uRoom.z)*step(abs(vPosition.z-uRoom.y),uRoom.w)*(1.0-step(uRoomHeight,vPosition.y));
  float weather=.5+.5*sin(uTime*.009);
  float density=.24+.76*exp(-max(0.0,(uEye.y+vPosition.y)*.5)*.023);
  float bank=noise(vPosition.xz*.008+vec2(uTime*.006,0.));
  float fog=1.0-exp(-d*(.0021+weather*.0011)*density*(.85+bank*.5));
  fog=clamp(fog-max(0.0,vGlow)*.045,0.0,1.0);
  if(normal.y>.85&&vPosition.y<.25&&vGlow>=0.0){
    vec2 p=vPosition.xz;float city=1.0-step(1120.0,max(abs(p.x),abs(p.y)));
    vec2 street=abs(mod(p+40.0,80.0)-40.0);
    float plaza=1.0-step(46.0,max(abs(p.x),abs(p.y)));
    float road=(1.0-step(7.0,min(street.x,street.y)))*(1.0-plaza)*city;
    surface=mix(surface,surface*.6,road);
    surface=mix(surface,vec3(.2,.225,.28)*mix(.48,.85,uDay),plaza);
    float grain=hash(floor(mod(p,64.0)*70.0)),wear=noise(p*.19),fine=1.0-smoothstep(35.,160.,d);
    surface*=.87+wear*.2+(grain-.5)*.16*(1.0-smoothstep(4.,28.,d))*uDetail;
    vec2 tile=abs(fract(p*.5)-.5);float seam=smoothstep(.466,.49,max(tile.x,tile.y));
    surface*=1.0-seam*.26*(1.0-road)*city*fine;
    vec2 fracture=abs(fract(p*.18+vec2(.0,.37))-.5);
    float cracks=(1.0-smoothstep(.004,.02,min(fracture.x,fracture.y)))*step(.72,hash(floor(p*.18)));
    surface*=1.0-cracks*.18*fine;
    float puddle=smoothstep(.64,.8,noise(p*.12))*(.3+weather*.7)*city*(1.0-indoors);
    float fresnel=pow(1.0-max(0.0,dot(normal,-ray)),3.0);
    surface=mix(surface,uFog*1.3,puddle*(.2+fresnel*.6));
    vec3 neon=mix(vec3(.08,.5,.64),vec3(.72,.09,.28),step(.5,hash(floor((p+40.0)/80.0))));
    float reflection=pow(.5+.5*sin(p.x*.28+p.y*.04+noise(p*.9)*.5),14.0);
    surface+=neon*reflection*puddle*fresnel*.32*(1.0-uDay*.6);
    float ripple=sin(length(fract(p*.28)-.5)*65.0-uTime*5.0)*.014;
    surface+=ripple*puddle*fine*uDetail;
    float edge=1.0-smoothstep(.03,.12,abs(min(street.x,street.y)-8.0));
    float lane=(1.0-step(.08,street.x))*step(16.0,mod(p.y+2.0,20.0))+(1.0-step(.08,street.y))*step(16.0,mod(p.x+2.0,20.0));
    float plazaLine=1.0-smoothstep(.02,.07,min(abs(mod(p.x+5.0,10.0)-5.0),abs(mod(p.y+5.0,10.0)-5.0)));
    surface=mix(surface,vec3(.36,.4,.4),clamp((edge*.5+lane*.8)*(1.0-plaza)*city+plazaLine*plaza*.35,0.,1.)*fine);
  }else if(vGlow<.2){
    float rim=pow(1.0-abs(dot(normal,-ray)),3.0);
    surface+=vec3(.08,.16,.22)*rim*(1.0-uDay*.5);
  }
  surface+=vec3(.11,.08,.055)*indoors*(1.0-clamp(vGlow,0.,1.));
  vec3 c=mix(surface,uFog,fog);
  if(uVolume>.0){
    float sun=pow(max(dot(ray,normalize(uSun)),0.0),12.0)*uDay*fog;
    c+=vec3(.32,.25,.14)*sun*uVolume;
    // Only shade the four Commons lamps near the viewer; low quality skips shafts.
    if(uVolume>.5&&length(uEye.xz)<100.0){
      float beams=shaft(ray,d,vec2(-32.,32.))+shaft(ray,d,vec2(32.,32.))
        +shaft(ray,d,vec2(-32.,-32.))+shaft(ray,d,vec2(32.,-32.));
      c+=vec3(.38,.55,.65)*beams*(1.0-uDay*.72);
    }
  }
  float alpha=1.0;
  if(vGlow< -3.0){c=vec3(.012,.018,.028);alpha=(-vGlow-3.0)*(1.0-fog);}
  else if(vGlow<0.0){c=mix(uFog,vec3(.48,.56,.62),.35);alpha=pow(max(0.0,dot(normal,-ray)),2.0)*.14*(1.0-fog)*min(1.0,-vGlow);}
  gl_FragColor=vec4(pow(max(c,vec3(0.)),vec3(.88)),alpha);
}`;
const skyVertex = `attribute vec2 aPosition; varying vec2 vUv; void main(){vUv=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}`;
const skyFragment = `precision mediump float; varying vec2 vUv; uniform float uTime; uniform float uAspect;
uniform float uDay; uniform vec3 uSunScreen; uniform vec3 uMoonScreen; uniform float uDawn;
float hash(vec2 p){return fract(sin(dot(p,vec2(.1271,.3117)))*43758.5453);}
float cloud(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
void main(){
 vec2 uv=vUv; vec3 horizon=mix(vec3(.035,.065,.085),vec3(.28,.37,.42),uDay)+uDawn*vec3(.13,.055,.015);
 vec3 zenith=mix(vec3(.009,.018,.04),vec3(.075,.22,.36),uDay);
 vec3 c=mix(horizon,zenith,smoothstep(0.,1.,uv.y));
 float sun=length((uv-uSunScreen.xy)*vec2(uAspect,1.));
 c+=vec3(.9,.67,.3)*(exp(-sun*18.)*.28+1.-smoothstep(.018,.021,sun))*uSunScreen.z;
 float moon=length((uv-uMoonScreen.xy)*vec2(uAspect,1.));
 c+=vec3(.38,.43,.39)*(1.-smoothstep(.016,.018,moon))*uMoonScreen.z*(1.-uDay);
 vec2 cell=floor(uv*vec2(600.,340.)); float star=step(.998,hash(cell));
 c+=star*.22*smoothstep(.35,.9,uv.y)*(1.-uDay);
 float clouds=cloud(uv*vec2(6.,10.)+vec2(uTime*.003,0.))*.65+cloud(uv*vec2(15.,24.)-vec2(uTime*.006,0.))*.35;
 c=mix(c,horizon*.8,smoothstep(.47,.8,clouds)*.55);
 gl_FragColor=vec4(c,1.);
}`;

function shader(gl, type, source) {
  const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(gl, vs, fs, webgl2) {
  if (webgl2) {
    vs = '#version 300 es\n' + vs.replaceAll('attribute ', 'in ').replaceAll('varying ', 'out ');
    fs = '#version 300 es\n' + fs.replace(/precision (mediump|highp) float;/, '$& out vec4 fragColor;').replaceAll('varying ', 'in ').replaceAll('gl_FragColor', 'fragColor');
  }
  const p = gl.createProgram(), v = shader(gl, gl.VERTEX_SHADER, vs), f = shader(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p); gl.deleteShader(v); gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

// Scenery uses the same flat, walkable basin floor. Keep broad crossing paths
// clear for contacts and terminals; plants do not alter authoritative collision.
export function biomeGeometry(biome) {
  const v=[],rand=random(biome.seed),[cx,,cz]=biome.center,col=color(biome.ground);
  for(let i=0;i<48;i++) {
    const a=i*Math.PI/24,b=(i+1)*Math.PI/24;
    for(const p of [[cx,.045,cz],[cx+Math.sin(a)*biome.radius,.045,cz+Math.cos(a)*biome.radius],[cx+Math.sin(b)*biome.radius,.045,cz+Math.cos(b)*biome.radius]])v.push(...p,0,1,0,...col,0);
  }
  for(let i=0;i<180;i++) {
    const angle=rand()*Math.PI*2,r=Math.sqrt(rand())*(biome.radius-20),dx=Math.sin(angle)*r,dz=Math.cos(angle)*r;
    if(Math.abs(dx)<20||Math.abs(dz)<20)continue;
    const x=cx+dx,z=cz+dz,h=3+rand()*12,yaw=rand()*Math.PI;
    if(biome.kind==='wetland') {
      box(v,[x,.075,z],[12,.03,9],'#162d31',.08,yaw);
      for(let j=0;j<4;j++) {
        bevelBox(v,[x+j-2,1.1,z+j%2],[.18,2.1,.18],'#82936a',2,yaw);
        ellipsoid(v,[x+j-2,2.25,z+j%2],[.3,.55,.3],'#a6a282',2,0,8);
      }
    } else if(biome.kind==='forest') {
      bevelBox(v,[x,h/2,z],[1.2,h,1.2],'#302e2c',2,yaw,.25);
      box(v,[x,h*.7,z],[6,.5,.7],'#514f3e',2,yaw);
      if(i%3===0) {
        ellipsoid(v,[x,h,z],[10,4,8],'#53654a',2,yaw,8);
        ellipsoid(v,[x+2,h+2,z],[6,3,5],'#728061',2,yaw,8);
      } else box(v,[x,.35,z],[6,.6,2],'#292d29',0,yaw);
    } else if(biome.kind==='grassland') {
      box(v,[x,.15,z],[8,.2,6],'#788477',0,yaw);
      for(let j=0;j<6;j++)box(v,[x+j-3,.6+rand()*.4,z+j%3],[.16,1.1,.4],biome.color,2,yaw);
      if(i%5===0)box(v,[x,1.5,z+3],[.3,3,.3],'#a77d61');
    } else if(biome.kind==='fungal') {
      box(v,[x,.12,z],[9,.15,7],'#647e80',.12,yaw);
      for(let j=0;j<3;j++) {
        const height=1.2+j*.8;
        bevelBox(v,[x+j*2,height/2,z+j],[.45,height,.45],'#8b9a8b',2);
        ellipsoid(v,[x+j*2,height,z+j],[3.5,.7,2.6],j%2?'#758994':'#9daf98',2.18,yaw,8);
      }
    }
  }
  return v;
}

export class Renderer {
  constructor(canvas, world, models, cityLife = null) {
    this.canvas = canvas; this.world = world; this.models = models; this.cityLife = cityLife;
    const options = { alpha: false, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false };
    this.gl = canvas.getContext('webgl2', options); this.webgl2 = Boolean(this.gl);
    this.gl ||= canvas.getContext('webgl', options);
    if (!this.gl) throw new Error('WebGL is unavailable. Enable hardware acceleration and reload to enter Vesper.');
    const gl = this.gl;
    const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ? 'highp' : 'mediump';
    this.sceneProgram = program(gl, vertexSource.replaceAll('mediump',precision), fragmentSource.replaceAll('mediump',precision), this.webgl2);
    this.skyProgram = program(gl, skyVertex, skyFragment, this.webgl2);
    this.locations = Object.fromEntries(['uMatrix','uEye','uFog','uSun','uDay','uVolume','uTime','uDetail','uRoom','uRoomHeight'].map(n => [n, gl.getUniformLocation(this.sceneProgram, n)]));
    this.attributes = ['aPosition','aNormal','aColor','aGlow'].map(n => gl.getAttribLocation(this.sceneProgram, n));
    this.dynamic = gl.createBuffer(); this.sky = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sky); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
    this.characters = new CharacterMeshes(models);
    this.chunks = []; this.details = new Map(); this.detailEye = null; this.quality = 1; this.volumetric = true; this.lost = false;
    this.build();
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; window.dispatchEvent(new CustomEvent('graphicslost')); });
    canvas.addEventListener('webglcontextrestored', () => location.reload());
  }
  upload(vertices, center, radius = 150, range = 1250, permanent = true) {
    const gl = this.gl, buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    const chunk={ buffer, count: vertices.length / 10, center, radius, range };
    if(permanent)this.chunks.push(chunk);
    return chunk;
  }
  updateDetails(eye) {
    if(this.detailEye&&distance(eye,this.detailEye)<24)return;
    this.detailEye=[...eye];
    for(const [b,chunk]of this.details)if(distance(eye,chunk.center)>260){this.gl.deleteBuffer(chunk.buffer);this.details.delete(b);}
    for(const b of this.world.buildings){
      const center=[b.x,3,b.z];if(distance(eye,center)>210||this.details.has(b))continue;
      const v=[];streetDetails(v,b);if(b.interior)buildingInterior(v,b,this.world.data);
      this.details.set(b,this.upload(v,center,Math.hypot(b.w,b.d)/2,150,false));
    }
  }
  build() {
    const { data, buildings } = this.world, groups = new Map();
    for (const b of buildings) {
      const key = `${Math.floor(b.x / 240)},${Math.floor(b.z / 240)}`;
      if (!groups.has(key)) groups.set(key, { center: [Math.floor(b.x / 240) * 240 + 120, 50, Math.floor(b.z / 240) * 240 + 120], v: [] });
      buildingExterior(groups.get(key).v,b,data,this.cityLife?.neighborhoods.get(this.world.district([b.x,0,b.z]).id)?.color);
    }
    for (const g of groups.values()) this.upload(g.v, g.center, 180);
    const ground = [];
    // Four basin slabs meet the city edge without coplanar faces. Street paint
    // and paving are shaded on the surface, avoiding distant depth flicker.
    for(const side of [-1,1]){
      box(ground,[0,-2,side*2260],[6800,4,2280],'#55565a');
      box(ground,[side*2260,-2,0],[2280,4,2240],'#55565a');
    }
    box(ground,[0,-.2,0],[2240,.4,2240],data.palette.ground);
    for(const p of data.platforms) {
      box(ground,[p.position[0],p.position[1]-.7,p.position[2]],p.size,'#344a46');
      const alongX = p.size[0] > p.size[2];
      for(const side of [-1,1]) {
        const pos=[...p.position], size=[...p.size]; pos[1]+=.15;
        pos[alongX?2:0]+=side*(size[alongX?2:0]/2-.2); size[1]=.2; size[alongX?2:0]=.25;
        box(ground,pos,size,'#86c5b1',.8);
      }
    }
    for(const lift of data.lifts) {
      box(ground,[lift.position[0],Math.max(...lift.stops)/2,lift.position[2]],[1,Math.max(...lift.stops),1],'#90c6ab',.8);
      for(const y of lift.stops) box(ground,[lift.position[0],y+.05,lift.position[2]],[7,.1,7],'#567b62',.25);
    }
    const rand = random(777);
    // Distant escarpments sit beyond the playable basin, leaving its floor traversable.
    for(let i=0;i<42;i++){
      const a=i/42*Math.PI*2,r=3700+rand()*350,h=170+rand()*420;
      ellipsoid(ground,[Math.sin(a)*r,-60,Math.cos(a)*r],[500+rand()*500,h*2,480+rand()*400],'#3d465a',0,a,8);
    }
    for(let i=0;i<400;i++) {
      const a=rand()*Math.PI*2, r=1250+rand()*1800, h=2+rand()*30;
      const position=[Math.sin(a)*r,h/2,Math.cos(a)*r],size=[8+rand()*35,h,8+rand()*35],yaw=rand();
      if(data.biomes?.some(b=>Math.hypot(position[0]-b.center[0],position[2]-b.center[2])<b.radius+40))continue;
      bevelBox(ground,position,size,'#555968',0,yaw,2.5);
    }
    this.upload(ground,[0,0,0],10000);
    for(const biome of data.biomes||[])this.upload(biomeGeometry(biome),biome.center,biome.radius+30);
    const props=[];
    for(const l of data.landmarks) {
      const p=l.position;
      box(props,[p[0],p[1]+1.2,p[2]],[1.4,2.4,1.2],'#344c48');
      box(props,[p[0],p[1]+1.9,p[2]+.63],[1.1,.7,.06],l.color,.85);
      box(props,[p[0],p[1]+3.4,p[2]],[.14,2,.14],l.color,.9);
    }
    for(const [x,z] of [[-32,32],[32,32],[-32,-32],[32,-32],[-8,60],[8,60]]) {
      box(props,[x,5,z],[.3,10,.3],'#46615b');
      box(props,[x,9.6,z],[4,.35,.35],'#bce1b4',.95);
      box(props,[x,.1,z],[4,.2,4],'#3c5650');
    }
    // A freestanding signal monument; all geometry is original and editable here.
    for(let i=0;i<7;i++) box(props,[0,4+i*2.2,-42],[18-i*1.5,.35,1.1],'#a1cfa3',.65,i*.16);
    box(props,[0,1,-42],[5,2,5],'#4e6255');
    this.upload(props,[0,20,0],4000);
    for(const neighborhood of this.cityLife?.content.neighborhoods||[]){
      const v=[],center=data.districts.find(d=>d.id===neighborhood.id).center;
      neighborhoodDetails(v,neighborhood,neighborhood.sites.map(id=>data.landmarks.find(l=>l.id===id)));
      this.upload(v,center,65,220);
    }
  }
  bind(buffer) {
    const gl=this.gl; gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    for(let i=0;i<4;i++) { gl.enableVertexAttribArray(this.attributes[i]); gl.vertexAttribPointer(this.attributes[i],i===3?1:3,gl.FLOAT,false,40,i*12); }
  }
  actor(v, actor, time) {
    const model=actor.model||'humanoid'; if(!this.models[model])return;
    if(actor.corpse){
      const mesh=[],pose=this.characters.pose({...actor,velocity:[0,0,0],grounded:true},0);
      this.characters.draw(mesh,{...actor,position:[0,0,0],yaw:0},pose,this.quality>.5);
      transformMesh(v,mesh,[actor.position[0],actor.position[1]+.35,actor.position[2]],0,Math.PI/2);
      box(v,[actor.position[0],actor.position[1]+.08,actor.position[2]],[1.5,.08,2.5],'#bce8fa',.65);
      return;
    }
    const pose=this.characters.pose(actor,time),pos=[...actor.position],yaw=pose.yaw;
    if(model==='drone'&&!this.reducedMotion)pos[1]+=Math.sin(time*2+pos[0])*.2;
    if(!actor.ghost&&this.shadows){
      const floor=this.world.floorAt(pos[0],pos[2],pos[1]+.1,-1),altitude=Math.max(0,pos[1]-floor),radius=(model==='warden'?.8:.55)+altitude*.08;
      for(let i=0;i<16;i++)for(const [angle,r,alpha]of [[0,0,.34/(1+altitude*.5)],[i/16*Math.PI*2,radius,.001],[(i+1)/16*Math.PI*2,radius,.001]])this.shadows.push(pos[0]+Math.sin(angle)*r,floor+.065,pos[2]+Math.cos(angle)*r,0,1,0,0,0,0,-3-alpha);
    }
    this.characters.draw(v,{...actor,position:pos,yaw},pose,this.quality>.5&&distance(this.eye,pos)<(actor.role?28:65));
    if(actor.role)civilianProps(v,{...actor,position:pos,yaw});
    const attach=(mesh,bone)=>{const local=[];transformMesh(local,mesh,bone.position,0,bone.pitch);transformMesh(v,local,pos,yaw);};
    if(actor.model==='humanoid' && !actor.ghost && hasFounderHalo(actor)) {
      const mesh=[];
      for(const part of founderHaloParts(this.reducedMotion?0:time)) {
        const [x,y,z]=part.center;
        bevelBox(mesh,[x,y-1.8,z],part.size,part.color,part.emissive,part.yaw);
      }
      attach(mesh,pose.head);
    }
    if(actor.guild?.tabard && actor.model==='humanoid') {
      const heraldry=tabardParts(actor.guild.tabard),mesh=[];
      for(const side of [-1,1])for(const [i,part]of heraldry.entries()) {
        const x=part.x,z=side*(.29+i*.0015);
        pane(mesh,[x,.15+part.y,z],[part.w,part.h,0],part.color,.12,side>0?4:5);
      }
      attach(mesh,pose.body);
    }
  }
  ghostline(v,ghost,time) {
    const position=ghostPosition(ghost,time),next=ghostPosition(ghost,time+.05),color='#81e5ed';
    this.actor(v,{id:`ghost-${ghost.owner}`,position,model:'humanoid',color,ghost:true,velocity:next.map((n,i)=>(n-position[i])/.05),yaw:Math.atan2(next[0]-position[0],next[2]-position[2])},time);
    for(const s of ghost.path)box(v,[s.position[0],s.position[1]+.15,s.position[2]],[.18,.18,.18],color,.8);
    for(let i=0;i<16;i++){const a=i/16*Math.PI*2;box(v,[position[0]+Math.sin(a)*2.5,position[1]+.12,position[2]+Math.cos(a)*2.5],[.18,.12,.18],color,1);}
  }
  dungeon(v, catalog, run, time) {
    const d=catalog.entries.find(d=>d.id===run.dungeon);if(!d)return;
    const r=catalog.rules,n=r.arenaRadius,put=(offset,size,color=d.color,glow=0)=>box(v,dungeonPosition(r,offset),size,color,glow);
    put([0,-.04,0],[n*2,.08,n*2],'#192a2e');
    for(const side of [-1,1]){
      put([side*(n+.4),.8,0],[.8,1.6,n*2+1],'#35444b');put([0,.8,side*(n+.4)],[n*2+1,1.6,.8],'#35444b');
      put([side*n,.15,0],[.2,.2,n*2],d.color,.7);put([0,.15,side*n],[n*2,.2,.2],d.color,.7);
    }
    const chapter=d.chapters[run.chapter];
    for(const [i,e]of chapter.evidence.entries()){
      const [x,,z]=e.position,read=run.evidence.includes(e.id);
      put([x,1,z],[2,2,1.3],'#45545d');put([x,2.1,z],[2.2,.15,1.5],d.color,.7);
      // One or two raised bars distinguish evidence stations without relying on color.
      for(let k=0;k<=i;k++)put([x-.3+k*.6,2.4,z],[.2,.5,.2],read?'#b9d79b':'#fff0cb',.8);
    }
    const aid=r.recoveryPosition.map((v,i)=>v-r.arena[i]);
    put([aid[0],.2,aid[2]],[4,.4,4],'#2b4b43');
    put([aid[0],.45,aid[2]],[2,.15,.5],'#dff5c3',1);put([aid[0],.45,aid[2]],[.5,.15,2],'#dff5c3',1);
    for(let i=0;i<8;i++){
      const x=(i-3.5)*5.5,z=-n-2;
      if(d.motif==='bells'){put([x,6,z],[1,12,1],'#415055');put([x,9,z],[2.8,3,2.2],d.color,.1);}
      else if(d.motif==='orchard'){put([x,1,z],[4,2,4],'#39444b');put([x,5,z],[.6,8,.6],'#6a6870');put([x,8,z],[3.5,.4,3.5],d.color,.4);}
      else if(d.motif==='court'){put([x,2+i%3,z],[4,4+i%3*2,3],'#465363');put([x,4+i%3*2,z],[4,.15,3],d.color,.6);}
      else if(d.motif==='theatre'){put([x,6,z],[.8,12,1],d.color,.2);put([x,1,z-3],[4,2,4],'#49333d');}
      else {put([x,5,z],[.7,10,1],'#536468');put([x,9,z],[5,.4,2],d.color,.5);put([x,.7,z-3],[5,1.4,8],'#364951');}
    }
    if(d.motif==='theatre')put([0,12,-n-2],[46,1,2],d.color,.4);
    if(d.motif==='ferry'||d.motif==='harbor')put([0,3,-n-8],[44,6,7],'#42555b');
    if(run.phase==='active'&&run.nextPulse-time<=r.warningSeconds){
      for(const [x,z,w,h]of dungeonZones(r,chapter,run.pulse)){
        put([x,.06,z],[w,.04,h],'#663e35',.3);
        for(const side of [-1,1]){put([x+side*w/2,.12,z],[.2,.12,h],'#fff0cb',1);put([x,.12,z+side*h/2],[w,.12,.2],'#fff0cb',1);}
        for(let offset=-w/2+1;offset<w/2;offset+=3)put([x+offset,.1,z],[.3,.08,h],'#dba578',.8);
      }
    }
  }
  ambient(v,mist,time) {
    const sceneTime=this.reducedMotion?0:time,eye=this.eye,spacing=this.world.data.buildingGrid.spacing;
    const cx=Math.floor(eye[0]/spacing),cz=Math.floor(eye[2]/spacing);
    for(let ix=cx-1;ix<=cx+1;ix++)for(let iz=cz-1;iz<=cz+1;iz++){
      const b=this.world.cells.get(`${ix},${iz}`);if(!b)continue;
      const vent=[b.x-b.w/2-1.4,0,b.z];
      if(this.quality>.5&&distance(eye,vent)<85){
        box(v,[vent[0],.08,vent[2]],[1.4,.12,2],'#7b8389');
        for(let i=0;i<3;i++){
          const age=(sceneTime*.2+i/3+b.seed%10*.1)%1;
          ellipsoid(mist,[vent[0]+age*.9,.4+age*3.2,vent[2]+Math.sin(age*3+i)*.25],[.7+age*1.8,.7+age*2,.7+age*1.5],'#657581',-Math.max(.001,Math.sin(age*Math.PI)),0,8);
        }
      }
    }
    for(const neighborhood of this.cityLife?.content.neighborhoods||[]){
      const stage=cityStage(neighborhood,this.cityLife.completed),index=neighborhood.stages.indexOf(stage);
      const incident=this.cityLife.incidents.find(e=>e.neighborhood===neighborhood.id&&e.phase!=='idle');
      for(const id of neighborhood.sites){
        const site=this.world.data.landmarks.find(l=>l.id===id),[x,y,z]=site.position;
        if(distance(eye,site.position)>110)continue;
        // The local story is readable in the street as well as in its journal.
        for(let i=0;i<3;i++)box(v,[x-.45+i*.45,y+2.7,z+.63],[.24,.14,.06],incident?(incident.phase==='recovery'?'#9be7a1':incident.phase==='failed'?'#e98b7b':'#efb778'):i<index?neighborhood.color:'#47505b',incident||i<index?.85:.05);
        if(index===3&&neighborhood.motif==='workshop')box(v,[x,y+2.3,z-2.49],[3.8,.1,.05],'#ffbc7b',.75);
        if(index===3&&neighborhood.motif==='garden')box(v,[x,y+1,z-3],[3.8,.08,.14],'#f1cf8d',this.reducedMotion?.7:.45+Math.sin(sceneTime*2)*.3);
      }
    }
    for(let i=0;i<12;i++){
      const along=(sceneTime*(12+i%4*3)+i*211)%2400-1200,lane=(i-6)*160,height=62+i%3*24;
      const p=i%2?[along,height,lane]:[lane,height,along],yaw=i%2?Math.PI/2:0;
      if(distance(eye,p)>700)continue;
      const mesh=[];
      bevelBox(mesh,[0,0,0],[3,2,8],'#3e4c61',0,0,.5);
      bevelBox(mesh,[0,.6,2.2],[2.7,1.4,2.4],'#76beca',.25,0,.3);
      for(const side of [-1,1]){
        bevelBox(mesh,[side*1.8,-.5,-1.3],[.8,.8,4],'#242c3b');
        box(mesh,[side*1.8,-.5,-3.35],[.6,.45,.12],i%3?'#74e6f8':'#ff79b2',1);
      }
      transformMesh(v,mesh,p,yaw);
    }
    if(this.reducedMotion||this.world.interiorAt(eye))return;
    const count=this.quality<=.5?36:100,rand=random(9137),baseX=Math.floor(eye[0]/24)*24,baseZ=Math.floor(eye[2]/24)*24;
    for(let i=0;i<count;i++){
      const x=baseX+(rand()-.5)*64,z=baseZ+(rand()-.5)*64,y=eye[1]+((rand()*28-sceneTime*18)%28+28)%28-8;
      if(y<.15||this.world.collides(x,y,z,0,0))continue;
      box(v,[x,y,z],[.017,.9+rand()*.6,.017],'#657b91',.25);
    }
  }
  render(camera, actors, effects, time, epoch = Date.now(), ghostlines = [], ghostTime = time, dungeon = null, incidents = null) {
    if(this.lost) return;
    const gl=this.gl, ratio=Math.min(devicePixelRatio||1,1.6)*this.quality;
    const width=Math.max(1,Math.floor(this.canvas.clientWidth*ratio)), height=Math.max(1,Math.floor(this.canvas.clientHeight*ratio));
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
    const light=daylight(epoch);
    this.eye=camera.eye;this.characters.reducedMotion=this.reducedMotion;
    this.matrix=multiply(perspective(camera.fov||1.05,width/height,.12,5200),lookAt(camera.eye,camera.target));
    this.updateDetails(camera.eye);
    const m=this.matrix,planes=[];
    for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
      const plane=[m[3]+sign*m[axis],m[7]+sign*m[4+axis],m[11]+sign*m[8+axis],m[15]+sign*m[12+axis]],length=Math.hypot(...plane.slice(0,3));
      planes.push(plane.map(v=>v/length));
    }
    const visible=chunk=>distance(camera.eye,chunk.center)-chunk.radius<chunk.range*(this.quality<=.5?.7:1)&&planes.every(p=>p[0]*chunk.center[0]+p[1]*chunk.center[1]+p[2]*chunk.center[2]+p[3]>=-chunk.radius);
    const celestial=sign=>{
      const point=camera.eye.map((v,i)=>v+light.sun[i]*sign*800),p=project(point,this.matrix,width,height);
      return p ? [p[0]/width,1-p[1]/height,sign*light.sun[1]>-.12?1:0] : [0,0,0];
    };
    gl.viewport(0,0,width,height); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.useProgram(this.skyProgram); gl.bindBuffer(gl.ARRAY_BUFFER,this.sky);
    for(const a of this.attributes) gl.disableVertexAttribArray(a);
    const skyPos=gl.getAttribLocation(this.skyProgram,'aPosition'); gl.enableVertexAttribArray(skyPos); gl.vertexAttribPointer(skyPos,2,gl.FLOAT,false,0,0);
    gl.uniform1f(gl.getUniformLocation(this.skyProgram,'uTime'),this.reducedMotion?0:time); gl.uniform1f(gl.getUniformLocation(this.skyProgram,'uAspect'),width/height);
    gl.uniform1f(gl.getUniformLocation(this.skyProgram,'uDay'),light.light);gl.uniform1f(gl.getUniformLocation(this.skyProgram,'uDawn'),light.dawn);
    gl.uniform3fv(gl.getUniformLocation(this.skyProgram,'uSunScreen'),celestial(1));gl.uniform3fv(gl.getUniformLocation(this.skyProgram,'uMoonScreen'),celestial(-1));
    gl.drawArrays(gl.TRIANGLES,0,3); gl.disableVertexAttribArray(skyPos);
    gl.clear(gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.useProgram(this.sceneProgram); gl.uniformMatrix4fv(this.locations.uMatrix,false,this.matrix);
    gl.uniform3fv(this.locations.uEye,camera.eye); gl.uniform3fv(this.locations.uFog,light.fog);
    gl.uniform3fv(this.locations.uSun,light.sun);gl.uniform1f(this.locations.uDay,light.light);gl.uniform1f(this.locations.uVolume,this.volumetric?(this.quality<=.5?.4:1):0);
    gl.uniform1f(this.locations.uTime,this.reducedMotion?0:time);gl.uniform1f(this.locations.uDetail,this.quality);
    const room=this.world.interiorAt(camera.eye)||this.world.interiorAt(camera.target);
    gl.uniform4fv(this.locations.uRoom,room?[room.x,room.z,room.w/2,room.d/2]:[0,0,-1,-1]);
    gl.uniform1f(this.locations.uRoomHeight,this.world.data.interiors?.height||0);
    for(const chunk of [...this.chunks,...this.details.values()])if(visible(chunk)){this.bind(chunk.buffer);gl.drawArrays(gl.TRIANGLES,0,chunk.count);}
    const v=[],mist=[];this.shadows=mist;
    if(dungeon)this.dungeon(v,dungeon.catalog,dungeon.run,ghostTime);
    if(incidents)incidentGeometry(v,incidents.events,incidents.rules,camera.eye,ghostTime,this.reducedMotion);
    for(const actor of actors) if((actor.health!==0||actor.ghost) && distance(camera.eye,actor.position)<260 && (!actor.role||visible({center:[actor.position[0],actor.position[1]+1.2,actor.position[2]],radius:2.5,range:120}))) this.actor(v,actor,time);
    for(const ghost of ghostlines)if(ghostTime<=ghost.started+ghost.path.at(-1).time&&distance(camera.eye,ghostPosition(ghost,ghostTime))<260)this.ghostline(v,ghost,ghostTime);
    for(const e of effects) {
      const age=time-e.time; if(age>e.duration) continue;
      const p=e.position;
      if(e.kind==='beam') {
        const dx=p[0]-e.from[0], dz=p[2]-e.from[2], len=Math.hypot(dx,dz);
        box(v,[(p[0]+e.from[0])/2,p[1]+1.5,(p[2]+e.from[2])/2],[.12,.12,len],e.color,1,Math.atan2(dx,dz));
      } else {
        const s=e.kind==='braid'?e.radius*age/e.duration:1+age*9;
        for(let i=0;i<12;i++){const a=i/12*Math.PI*2;box(v,[p[0]+Math.sin(a)*s,p[1]+.15+age,p[2]+Math.cos(a)*s],[.2,.2,.2],e.color,1);}
      }
    }
    if(!dungeon)this.ambient(v,mist,time);
    this.characters.prune(time);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.dynamic);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(v),gl.DYNAMIC_DRAW);
    this.bind(this.dynamic);gl.drawArrays(gl.TRIANGLES,0,v.length/10);
    if(mist.length){
      gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(mist),gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,mist.length/10);
      gl.depthMask(true);gl.disable(gl.BLEND);
    }
  }
  project(p) {return this.matrix?project(p,this.matrix,this.canvas.clientWidth,this.canvas.clientHeight):null;}
}
