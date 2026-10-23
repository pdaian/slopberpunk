// A reusable WebGL fitting bay, sampled by the existing WebGL interface painter.
// GPL-3.0-or-later.
import { CharacterMeshes, motionPose, gesturePose } from './character.js';
import { box, bevelBox, transformMesh } from './geometry.js';
import { perspective, lookAt, multiply } from './math.js';
import { founderHaloParts, hasFounderHalo } from './founders.js';

const vertex=`attribute vec3 position; attribute vec3 normal; attribute vec3 tint; attribute float glow;
uniform mat4 matrix; varying mediump vec3 N; varying mediump vec3 C; varying mediump vec3 P; varying mediump float G;
void main(){N=normal;C=tint;P=position;G=glow;gl_Position=matrix*vec4(position,1.);}`;
const fragment=`precision mediump float;
varying vec3 N; varying vec3 C; varying vec3 P; varying float G; uniform vec3 eye; uniform float finish;
void main(){vec3 n=normalize(N),v=normalize(eye-P),l=normalize(vec3(-3.,5.,6.));
float diffuse=.32+max(dot(n,l),0.)*.65+max(dot(n,normalize(vec3(4.,2.,-4.))),0.)*.3;
float spec=pow(max(dot(n,normalize(l+v)),0.),mix(20.,65.,finish))*mix(.12,.5,finish);
vec3 c=C*mix(diffuse,1.65,G)+vec3(.62,.8,1.)*spec*(1.-G);
c+=vec3(.035,.09,.12)*pow(1.-max(dot(n,v),0.),3.);
gl_FragColor=vec4(pow(max(c,vec3(0.)),vec3(.9)),1.);}`;

export class FramePreview {
  constructor(models,catalog) {
    this.canvas=document.createElement('canvas');this.canvas.className='forge-canvas';
    this.canvas.setAttribute('role','img');this.canvas.setAttribute('aria-label','Live three-dimensional frame preview');
    const gl=this.gl=this.canvas.getContext('webgl',{alpha:false,antialias:true,depth:true,preserveDrawingBuffer:false});
    if(!gl)throw new Error('The fitting bay needs WebGL. Your frame can still be edited.');
    this.program=gl.createProgram();
    for(const [type,source]of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]) {
      const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error('Fitting bay shader could not compile.');
      gl.attachShader(this.program,shader);gl.deleteShader(shader);
    }
    gl.linkProgram(this.program);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error('Fitting bay shader could not link.');
    this.attributes=['position','normal','tint','glow'].map(n=>gl.getAttribLocation(this.program,n));
    this.uniforms=Object.fromEntries(['matrix','eye','finish'].map(n=>[n,gl.getUniformLocation(this.program,n)]));
    this.buffer=gl.createBuffer();this.characters=new CharacterMeshes(models);this.characters.forge=catalog;
    this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.lost=true;});
    this.canvas.addEventListener('webglcontextrestored',()=>location.reload());
  }
  render(character,appearance,{angle=.4,pose='idle',rotate=false,reducedMotion=false}={},timestamp=0) {
    if(this.lost||!this.canvas.isConnected)return;
    const stamp=Math.floor(timestamp/100);if(this.stamp===stamp)return;this.stamp=stamp;
    const gl=this.gl,ratio=Math.min(globalThis.devicePixelRatio||1,1.5);
    const width=Math.max(1,Math.floor(this.canvas.clientWidth*ratio)),height=Math.max(1,Math.floor(this.canvas.clientHeight*ratio));
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
    const time=reducedMotion?0:timestamp/1000,yaw=angle+(rotate&&!reducedMotion?time*.28:0);
    const v=[],walking=pose==='stride',bones=gesturePose(motionPose(walking?5:0,time*4,true,0,time),pose==='salute'?'wave':null,time);
    this.characters.draw(v,{model:'humanoid',position:[0,0,0],race:character.race,yaw,forge:{appearance}},bones,true);
    if(hasFounderHalo(character)) {
      const mesh=[],local=[];
      for(const part of founderHaloParts(time))bevelBox(mesh,[part.center[0],part.center[1]-1.8,part.center[2]],part.size,part.color,part.emissive,part.yaw);
      transformMesh(local,mesh,bones.head.position,0,bones.head.pitch);transformMesh(v,local,[0,0,0],yaw);
    }
    bevelBox(v,[0,-.12,0],[2.9,.18,2.9],'#243644',0,Math.PI/4,.12);
    for(let i=0;i<48;i++){const a=i/48*Math.PI*2;box(v,[Math.sin(a)*1.25,-.018,Math.cos(a)*1.25],[.07,.02,.07],i%4?'#3b5966':'#71e7ed',i%4?.1:.7);}
    const aspect=width/height,eye=[0,2.25,Math.max(5.5,3.3/aspect)],matrix=multiply(perspective(.65,aspect,.1,30),lookAt(eye,[0,1.23,0]));
    gl.viewport(0,0,width,height);gl.clearColor(.035,.065,.09,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.matrix,false,matrix);gl.uniform3fv(this.uniforms.eye,eye);
    gl.uniform1f(this.uniforms.finish,appearance?.finish==='alloy'?1:appearance?.finish==='carbon'?0:.5);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(v),gl.DYNAMIC_DRAW);
    for(const [i,attribute]of this.attributes.entries()){gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,i===3?1:3,gl.FLOAT,false,40,i*12);}
    gl.drawArrays(gl.TRIANGLES,0,v.length/10);
    const label=`${character.name||'Your character'}: ${appearance?.frame||'original'} frame, ${pose} pose. Rotate with the fitting bay buttons.`;
    if(this.canvas.getAttribute('aria-label')!==label)this.canvas.setAttribute('aria-label',label);
  }
}
