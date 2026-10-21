// Original WebGL renderer and geometry — GPL-3.0-or-later.
import { color, random, perspective, lookAt, multiply, project, distance } from './math.js';
import { daylight } from './clock.js';
import { tabardParts } from './tabard.js';
import { hasFounderHalo, founderHaloParts } from './founders.js';
import { ghostPosition } from './ghostline.js';
import { dungeonZones, dungeonPosition } from './dungeons.js';

const vertexSource = `
attribute vec3 aPosition; attribute vec3 aNormal; attribute vec3 aColor; attribute float aGlow;
uniform mat4 uMatrix; uniform mediump vec3 uEye; uniform mediump vec3 uSun; uniform mediump float uDay;
varying mediump vec3 vColor; varying mediump float vDistance; varying mediump float vGlow; varying mediump vec3 vPosition;
void main(){
  float light=mix(.25,.48,uDay)+max(dot(aNormal,normalize(uSun)),0.0)*.52*uDay;
  vColor=aColor*mix(light,1.35,aGlow); vGlow=aGlow;
  vPosition=aPosition;
  vDistance=distance(aPosition,uEye); gl_Position=uMatrix*vec4(aPosition,1.0);
}`;
const fragmentSource = `
precision mediump float; varying mediump vec3 vColor; varying mediump float vDistance; varying mediump float vGlow; varying mediump vec3 vPosition;
uniform vec3 uFog; uniform mediump vec3 uEye; uniform mediump vec3 uSun; uniform mediump float uDay; uniform float uVolume;
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
  float density=.55+.45*exp(-max(0.0,(uEye.y+vPosition.y)*.5)*.025);
  float fog=1.0-exp(-vDistance*.0029*density); fog=clamp(fog-vGlow*.06,0.0,1.0);
  vec3 ray=normalize(vPosition-uEye);vec3 c=mix(vColor,uFog,fog);
  if(uVolume>.0){
    float sun=pow(max(dot(ray,normalize(uSun)),0.0),12.0)*uDay*fog;
    c+=vec3(.32,.25,.14)*sun*uVolume;
    // Only shade the four Commons lamps near the viewer; low quality skips shafts.
    if(uVolume>.5&&length(uEye.xz)<100.0){
      float beams=shaft(ray,vDistance,vec2(-32.,32.))+shaft(ray,vDistance,vec2(32.,32.))
        +shaft(ray,vDistance,vec2(-32.,-32.))+shaft(ray,vDistance,vec2(32.,-32.));
      c+=vec3(.46,.63,.39)*beams*(1.0-uDay*.72);
    }
  }
  gl_FragColor=vec4(c,1.0);
}`;
const skyVertex = `attribute vec2 aPosition; varying vec2 vUv; void main(){vUv=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}`;
const skyFragment = `precision mediump float; varying vec2 vUv; uniform float uTime; uniform float uAspect;
uniform float uDay; uniform vec3 uSunScreen; uniform vec3 uMoonScreen; uniform float uDawn;
float hash(vec2 p){return fract(sin(dot(p,vec2(.1271,.3117)))*43758.5453);}
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
 c+=vec3(.018,.025,.022)*sin(uv.y*160.+uTime*.03);
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
    fs = '#version 300 es\n' + fs.replace('precision mediump float;', 'precision mediump float; out vec4 fragColor;').replaceAll('varying ', 'in ').replaceAll('gl_FragColor', 'fragColor');
  }
  const p = gl.createProgram(), v = shader(gl, gl.VERTEX_SHADER, vs), f = shader(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p); gl.deleteShader(v); gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

const faces = [
  [[1,0,0], [[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]]],
  [[-1,0,0], [[-1,-1,1],[-1,1,1],[-1,1,-1],[-1,-1,-1]]],
  [[0,1,0], [[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1]]],
  [[0,-1,0], [[-1,-1,1],[-1,-1,-1],[1,-1,-1],[1,-1,1]]],
  [[0,0,1], [[1,-1,1],[1,1,1],[-1,1,1],[-1,-1,1]]],
  [[0,0,-1], [[-1,-1,-1],[-1,1,-1],[1,1,-1],[1,-1,-1]]]
];
export function box(vertices, center, size, hex, glow = 0, yaw = 0) {
  const col = Array.isArray(hex) ? hex : color(hex), cs = Math.cos(yaw), sn = Math.sin(yaw);
  for (const [normal, corners] of faces) for (const i of [0,1,2,0,2,3]) {
    const v = corners[i], x = v[0] * size[0] / 2, z = v[2] * size[2] / 2;
    vertices.push(center[0] + x * cs + z * sn, center[1] + v[1] * size[1] / 2, center[2] - x * sn + z * cs,
      normal[0] * cs + normal[2] * sn, normal[1], -normal[0] * sn + normal[2] * cs, ...col, glow);
  }
}
function pane(vertices,center,size,hex,glow,face,yaw=0){
  const [normal,corners]=faces[face],col=color(hex),cs=Math.cos(yaw),sn=Math.sin(yaw);
  for(const i of [0,1,2,0,2,3]){const v=corners[i],x=v[0]*size[0]/2,z=v[2]*size[2]/2;vertices.push(center[0]+x*cs+z*sn,center[1]+v[1]*size[1]/2,center[2]-x*sn+z*cs,normal[0]*cs+normal[2]*sn,normal[1],-normal[0]*sn+normal[2]*cs,...col,glow);}
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
        box(v,[x+j-2,1.1,z+j%2],[.18,2.1,.18],'#82936a',0,yaw);
        box(v,[x+j-2,2.25,z+j%2],[.35,.5,.35],'#a6a282');
      }
    } else if(biome.kind==='forest') {
      box(v,[x,h/2,z],[1.2,h,1.2],'#302e2c',0,yaw);
      box(v,[x,h*.7,z],[6,.5,.7],'#514f3e',0,yaw);
      if(i%3===0) {
        box(v,[x,h,z],[10,3,8],'#53654a',0,yaw);
        box(v,[x+2,h+2,z],[6,2,5],'#728061',0,yaw);
      } else box(v,[x,.35,z],[6,.6,2],'#292d29',0,yaw);
    } else if(biome.kind==='grassland') {
      box(v,[x,.15,z],[8,.2,6],'#788477',0,yaw);
      for(let j=0;j<6;j++)box(v,[x+j-3,.6+rand()*.4,z+j%3],[.16,1.1,.4],biome.color,0,yaw);
      if(i%5===0)box(v,[x,1.5,z+3],[.3,3,.3],'#a77d61');
    } else if(biome.kind==='fungal') {
      box(v,[x,.12,z],[9,.15,7],'#647e80',.12,yaw);
      for(let j=0;j<3;j++) {
        const height=1.2+j*.8;
        box(v,[x+j*2,height/2,z+j],[.45,height,.45],'#8b9a8b');
        box(v,[x+j*2,height,z+j],[3.5,.4,2.6],j%2?'#758994':'#9daf98',.18,yaw);
      }
    }
  }
  return v;
}

export class Renderer {
  constructor(canvas, world, models) {
    this.canvas = canvas; this.world = world; this.models = models;
    const options = { alpha: false, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false };
    this.gl = canvas.getContext('webgl2', options); this.webgl2 = Boolean(this.gl);
    this.gl ||= canvas.getContext('webgl', options);
    if (!this.gl) throw new Error('WebGL is unavailable. Enable hardware acceleration and reload to enter Vesper.');
    const gl = this.gl;
    this.sceneProgram = program(gl, vertexSource, fragmentSource, this.webgl2);
    this.skyProgram = program(gl, skyVertex, skyFragment, this.webgl2);
    this.locations = Object.fromEntries(['uMatrix','uEye','uFog','uSun','uDay','uVolume'].map(n => [n, gl.getUniformLocation(this.sceneProgram, n)]));
    this.attributes = ['aPosition','aNormal','aColor','aGlow'].map(n => gl.getAttribLocation(this.sceneProgram, n));
    this.dynamic = gl.createBuffer(); this.sky = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sky); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
    this.chunks = []; this.quality = 1; this.volumetric = true; this.lost = false;
    this.build();
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; window.dispatchEvent(new CustomEvent('graphicslost')); });
    canvas.addEventListener('webglcontextrestored', () => location.reload());
  }
  upload(vertices, center, radius = 150) {
    const gl = this.gl, buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    this.chunks.push({ buffer, count: vertices.length / 10, center, radius });
  }
  build() {
    const { data, buildings } = this.world, groups = new Map();
    for (const b of buildings) {
      const key = `${Math.floor(b.x / 240)},${Math.floor(b.z / 240)}`;
      if (!groups.has(key)) groups.set(key, { center: [Math.floor(b.x / 240) * 240 + 120, 50, Math.floor(b.z / 240) * 240 + 120], v: [] });
      const v = groups.get(key).v, neon = data.palette.neon[b.accent], concrete = data.palette.concrete[b.shade], rand = random(b.seed);
      box(v, [b.x,b.h/2,b.z],[b.w,b.h,b.d],concrete);
      box(v, [b.x,1.2,b.z],[b.w+2,2.4,b.d+2],'#1d3233');
      box(v, [b.x,b.h-.3,b.z],[b.w+1,.6,b.d+1],'#172d2d');
      box(v, [b.x,b.h+1.2,b.z+b.d/2+.55],[b.w,.18,.22],neon,.8);
      if (rand() > .45) {
        box(v,[b.x,b.h+8,b.z],[b.w*.44,14,b.d*.55],'#3d5451');
        box(v,[b.x,b.h+19,b.z],[.5,14,.5],neon,.65);
      }
      for (let y = 7; y < b.h - 3; y += 6) {
        for (let x = -b.w/2+4; x < b.w/2-2; x += 6) if (rand() > .27) {
          const light = rand() > .45 ? '#c9c797' : neon;
          pane(v,[b.x+x,y,b.z+b.d/2+.05],[2,2.3,0],light,.5,4);
          if (rand() > .5) pane(v,[b.x+x,y,b.z-b.d/2-.05],[2,2.3,0],light,.5,5);
        }
        for (let z = -b.d/2+4; z < b.d/2-2; z += 8) if (rand() > .4) pane(v,[b.x+b.w/2+.05,y,b.z+z],[0,2.3,2],neon,.45,0);
      }
      const side = b.x > 0 ? -1 : 1;
      box(v,[b.x+side*(b.w/2+.2),b.h*.53,b.z],[.45,b.h*.38,3.2],neon,.85);
      box(v,[b.x,3,b.z+b.d/2+2],[b.w*.7,.4,4],'#4b6255');
      box(v,[b.x,2.75,b.z+b.d/2+4],[b.w*.7,.1,.1],neon,.9);
    }
    for (const g of groups.values()) this.upload(g.v, g.center, 180);
    const ground = [];
    box(ground,[0,-2,0],[6800,4,6800],'#323c36');
    box(ground,[0,-.2,0],[2240,.4,2240],data.palette.ground);
    for(let k=-13;k<=13;k++) {
      box(ground,[k*80,.018,0],[14,.035,2240],'#0e2224');
      box(ground,[0,.018,k*80],[2240,.035,14],'#0e2224');
      box(ground,[k*80+8,.03,0],[.18,.04,2240],'#4a655e',.12);
      box(ground,[0,.03,k*80+8],[2240,.04,.18],'#4a655e',.12);
    }
    box(ground,[0,.02,0],[92,.04,92],'#2b3e3a');
    for(let i=-40;i<=40;i+=10) {
      box(ground,[i,.05,0],[.07,.05,90],'#5c7162',.15);
      box(ground,[0,.05,i],[90,.05,.07],'#5c7162',.15);
    }
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
    for(let i=0;i<400;i++) {
      const a=rand()*Math.PI*2, r=1250+rand()*1800, h=2+rand()*30;
      const position=[Math.sin(a)*r,h/2,Math.cos(a)*r],size=[8+rand()*35,h,8+rand()*35],yaw=rand();
      if(data.biomes?.some(b=>Math.hypot(position[0]-b.center[0],position[2]-b.center[2])<b.radius+40))continue;
      box(ground,position,size,'#515648',0,yaw);
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
  }
  bind(buffer) {
    const gl=this.gl; gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    for(let i=0;i<4;i++) { gl.enableVertexAttribArray(this.attributes[i]); gl.vertexAttribPointer(this.attributes[i],i===3?1:3,gl.FLOAT,false,40,i*12); }
  }
  actor(v, actor, time) {
    const parts=this.models[actor.model||'humanoid']; if(!parts) return;
    const pos=actor.position, yaw=actor.yaw||0, cs=Math.cos(yaw), sn=Math.sin(yaw);
    const bob=actor.model==='drone'?Math.sin(time*2+pos[0])*.2:0;
    for(const part of parts) {
      const [x,y,z]=part.center;
      box(v,[pos[0]+x*cs+z*sn,pos[1]+y+bob,pos[2]-x*sn+z*cs],part.size,actor.ghost||part.color==='accent'?actor.color:part.color,actor.ghost?.85:part.emissive||0,yaw);
    }
    if(actor.model==='humanoid' && !actor.ghost && hasFounderHalo(actor)) {
      for(const part of founderHaloParts(this.reducedMotion?0:time)) {
        const [x,y,z]=part.center;
        box(v,[pos[0]+x*cs+z*sn,pos[1]+y,pos[2]-x*sn+z*cs],part.size,part.color,part.emissive,yaw+part.yaw);
      }
    }
    if(actor.guild?.tabard && actor.model==='humanoid') {
      const heraldry=tabardParts(actor.guild.tabard);
      for(const side of [-1,1])for(const [i,part]of heraldry.entries()) {
        const x=part.x,z=side*(.29+i*.0015);
        pane(v,[pos[0]+x*cs+z*sn,pos[1]+1.18+part.y,pos[2]-x*sn+z*cs],[part.w,part.h,0],part.color,.12,side>0?4:5,yaw);
      }
    }
  }
  ghostline(v,ghost,time) {
    const position=ghostPosition(ghost,time),next=ghostPosition(ghost,time+.05),color='#81e5ed';
    this.actor(v,{position,model:'humanoid',color,ghost:true,yaw:Math.atan2(next[0]-position[0],next[2]-position[2])},time);
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
  render(camera, actors, effects, time, epoch = Date.now(), ghostlines = [], ghostTime = time, dungeon = null) {
    if(this.lost) return;
    const gl=this.gl, ratio=Math.min(devicePixelRatio||1,1.6)*this.quality;
    const width=Math.floor(this.canvas.clientWidth*ratio), height=Math.floor(this.canvas.clientHeight*ratio);
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
    const light=daylight(epoch);
    this.matrix=multiply(perspective(camera.fov||1.05,width/height,.15,1600),lookAt(camera.eye,camera.target));
    const celestial=sign=>{
      const point=camera.eye.map((v,i)=>v+light.sun[i]*sign*800),p=project(point,this.matrix,width,height);
      return p ? [p[0]/width,1-p[1]/height,sign*light.sun[1]>-.12?1:0] : [0,0,0];
    };
    gl.viewport(0,0,width,height); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.useProgram(this.skyProgram); gl.bindBuffer(gl.ARRAY_BUFFER,this.sky);
    for(const a of this.attributes) gl.disableVertexAttribArray(a);
    const skyPos=gl.getAttribLocation(this.skyProgram,'aPosition'); gl.enableVertexAttribArray(skyPos); gl.vertexAttribPointer(skyPos,2,gl.FLOAT,false,0,0);
    gl.uniform1f(gl.getUniformLocation(this.skyProgram,'uTime'),time); gl.uniform1f(gl.getUniformLocation(this.skyProgram,'uAspect'),width/height);
    gl.uniform1f(gl.getUniformLocation(this.skyProgram,'uDay'),light.light);gl.uniform1f(gl.getUniformLocation(this.skyProgram,'uDawn'),light.dawn);
    gl.uniform3fv(gl.getUniformLocation(this.skyProgram,'uSunScreen'),celestial(1));gl.uniform3fv(gl.getUniformLocation(this.skyProgram,'uMoonScreen'),celestial(-1));
    gl.drawArrays(gl.TRIANGLES,0,3); gl.disableVertexAttribArray(skyPos);
    gl.clear(gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.useProgram(this.sceneProgram); gl.uniformMatrix4fv(this.locations.uMatrix,false,this.matrix);
    gl.uniform3fv(this.locations.uEye,camera.eye); gl.uniform3fv(this.locations.uFog,light.fog);
    gl.uniform3fv(this.locations.uSun,light.sun);gl.uniform1f(this.locations.uDay,light.light);gl.uniform1f(this.locations.uVolume,this.volumetric?(this.quality<=.5?.4:1):0);
    for(const chunk of this.chunks) if(distance(camera.eye,chunk.center)-chunk.radius<850){this.bind(chunk.buffer);gl.drawArrays(gl.TRIANGLES,0,chunk.count);}
    const v=[];
    if(dungeon)this.dungeon(v,dungeon.catalog,dungeon.run,ghostTime);
    for(const actor of actors) if(actor.health!==0 && distance(camera.eye,actor.position)<260) this.actor(v,actor,time);
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
    // Slow cargo shuttles travel over the city's upper lanes.
    for(let i=0;i<4;i++){
      const x=((time*9+i*190)%760)-380;
      box(v,[x,70+i*13,-90-i*60],[8,2.5,3],'#455d55');
      box(v,[x-4.2,70+i*13,-90-i*60],[.2,.6,2],'#b7e68e',1);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER,this.dynamic);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(v),gl.DYNAMIC_DRAW);
    this.bind(this.dynamic);gl.drawArrays(gl.TRIANGLES,0,v.length/10);
  }
  project(p) {return this.matrix?project(p,this.matrix,this.canvas.clientWidth,this.canvas.clientHeight):null;}
}
