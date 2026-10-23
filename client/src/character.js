// Articulated runner rigs and cached, distance-scaled source meshes. GPL-3.0-or-later.
import { clamp, color } from './math.js';
import { box, bevelBox, ellipsoid, transformMesh } from './geometry.js';

function joint(parent, offset, pitch = 0) {
  const c=Math.cos(parent.pitch),s=Math.sin(parent.pitch);
  return {position:[parent.position[0]+offset[0],parent.position[1]+offset[1]*c-offset[2]*s,parent.position[2]+offset[1]*s+offset[2]*c],pitch:parent.pitch+pitch};
}

export function motionPose(speed, phase, grounded = true, vertical = 0, time = 0) {
  const moving=clamp(speed/3,0,1), run=clamp((speed-6)/11,0,1);
  const bob=grounded?Math.abs(Math.cos(phase))*.045*moving:0;
  const lean=grounded?.035+run*.14:clamp(vertical*.012,-.1,.16);
  const body={position:[0,1.03+bob-run*.08+Math.sin(time*1.8)*.008*(1-moving),0],pitch:lean};
  const bones={body,head:joint(body,[0,.77,0],-lean*.65)};
  for (const [side,sign] of [['left',-1],['right',1]]) {
    const p=phase+(sign>0?Math.PI:0), swing=Math.sin(p), lift=Math.max(0,Math.cos(p));
    // Solve a two-bone leg to a planted foot through the stance half of the stride.
    const footZ=grounded?swing*(.2+run*.28)*moving:sign*.19;
    const footY=grounded?.12+lift*(.18+run*.24)*moving:.24+(sign<0?.14:0);
    const dy=footY-body.position[1],dz=footZ, length=clamp(Math.hypot(dy,dz),.1,.975), segment=.49;
    const bend=Math.acos(clamp((length*length-2*segment*segment)/(2*segment*segment),-1,1));
    const thigh={position:[sign*.19,body.position[1],0],pitch:Math.atan2(-dz,-dy)-bend/2};
    const shin=joint(thigh,[0,-segment,0],bend), foot=joint(shin,[0,-segment,0],-shin.pitch);
    bones[`${side}Thigh`]=thigh;bones[`${side}Shin`]=shin;bones[`${side}Foot`]=foot;
    const armSwing=grounded?swing*(.3+run*.65)*moving:sign*.3;
    const upper=joint(body,[sign*.47,.49,0],armSwing-.12);
    bones[`${side}Arm`]=upper;
    bones[`${side}Forearm`]=joint(upper,[0,-.35,0],-.22-run*.85-moving*.15);
    bones[`${side}Coat`]=joint(body,[sign*.22,-.03,-.12],-.08-Math.max(0,-swing)*.32*moving);
  }
  return bones;
}

export function activityPose(bones, activity, time) {
  const beat = Math.sin(time * 3);
  const arm = (side, pitch, bend) => {
    const sign = side === 'left' ? -1 : 1;
    bones[`${side}Arm`] = joint(bones.body, [sign * .47, .49, 0], pitch);
    bones[`${side}Forearm`] = joint(bones[`${side}Arm`], [0, -.35, 0], bend);
  };
  if (activity === 'carry') for (const side of ['left', 'right']) arm(side, -.65, -1.05);
  else if (activity === 'repair') { arm('left', -.7, -.5);arm('right', -.65 + beat * .18, -.8); }
  else if (activity === 'work') { arm('left', -.65, -.85);arm('right', -.9, -.5 + beat * .08); }
  else if (activity === 'serve') { arm('left', -.65, -.7);arm('right', -.8 + beat * .2, -.65); }
  else if (activity === 'eat') { arm('left', -.7, -1.05);arm('right', -.5 - (beat + 1) * .2, -1.6); }
  else if (activity === 'talk') arm('right', -.25, -.5 - (beat + 1) * .25);
  else if (activity === 'tend') { arm('left', -.6, -.55);arm('right', -.55 + beat * .12, -.45); }
  else if (activity === 'flee') for (const side of ['left', 'right']) arm(side, -1.4, -1.2);
  if (['repair', 'work', 'eat', 'tend'].includes(activity)) bones.head = joint(bones.body, [0, .77, 0], .2);
  return bones;
}

export function gesturePose(bones, gesture, time) {
  const arm = (side, pitch, bend) => {
    const sign = side === 'left' ? -1 : 1;
    bones[`${side}Arm`] = joint(bones.body, [sign * .47, .49, 0], pitch);
    bones[`${side}Forearm`] = joint(bones[`${side}Arm`], [0, -.35, 0], bend);
  };
  if (gesture === 'wave') arm('right', -2.6, -.3 + Math.sin(time * 8) * .35);
  else if (gesture === 'nod') bones.head = joint(bones.body, [0, .77, 0], .18 + Math.sin(time * 5) * .2);
  else if (gesture === 'cheer') for (const side of ['left', 'right']) arm(side, -2.7 + Math.sin(time * 5) * .1, -.25);
  else if (gesture === 'point') arm('right', -Math.PI / 2, 0);
  return bones;
}

export class CharacterMeshes {
  constructor(models) { this.models=models;this.meshes=new Map();this.motion=new Map(); }
  pose(actor,time) {
    const key=`${actor.model}:${actor.id||actor.name||'preview'}`;
    let state=this.motion.get(key);
    if(!state){state={time,position:[...actor.position],moved:time,speed:0,phase:0,yaw:actor.yaw||0};this.motion.set(key,state);}
    const dt=clamp(time-state.time,0,.05), dx=actor.position[0]-state.position[0],dz=actor.position[2]-state.position[2];
    let target=state.speed;
    if(actor.velocity)target=Math.hypot(actor.velocity[0],actor.velocity[2]);
    else if(Math.hypot(dx,dz)>.005){target=Math.hypot(dx,dz)/Math.max(.05,time-state.moved);state.moved=time;}
    else if(time-state.moved>.14)target=0;
    if(Math.hypot(dx,dz)>8){target=0;state.phase=0;}
    state.speed+=(clamp(target,0,22)-state.speed)*(1-Math.exp(-dt*12));
    state.phase=(state.phase+state.speed*dt*.95)%(Math.PI*2);
    state.position=[...actor.position];state.time=time;
    const heading=actor.velocity&&Math.hypot(actor.velocity[0],actor.velocity[2])>.5&&actor.model!=='drone'?Math.atan2(actor.velocity[0],actor.velocity[2]):actor.yaw||0;
    state.yaw+=Math.atan2(Math.sin(heading-state.yaw),Math.cos(heading-state.yaw))*(1-Math.exp(-dt*14));
    const animationTime=this.reducedMotion?0:time;
    const bones=activityPose(motionPose(state.speed,state.phase,actor.grounded!==false,actor.velocity?.[1]||0,animationTime),actor.activity,animationTime);
    return {...gesturePose(bones,actor.gesture,animationTime),yaw:state.yaw};
  }
  parts(model,race,detail) {
    const key=`${model}:${race}:${detail}`;
    if(this.meshes.has(key))return this.meshes.get(key);
    const source=[...(this.models[model]||[]),...(model==='humanoid'?this.models.lineages?.[race]||[]:[])];
    const parts=source.map(part=>{
      const v=[],shape=detail&&part.shape==='round'?ellipsoid:detail?bevelBox:box;
      const skin={human:'#c69b88',lattice:'#c7dbe6',revenant:'#b5a9be',bloom:'#a4b18d'}[race]||'#8b9ba7';
      const shade=part.color==='accent'?'#ffffff':part.color==='skin'?skin:part.color;
      if(shape===bevelBox)shape(v,part.center,part.size,shade,part.emissive||0,part.yaw||0,.12,part.taper||1);
      else shape(v,part.center,part.size,shade,part.emissive||0,part.yaw||0);
      return {...part,mesh:v};
    });
    this.meshes.set(key,parts);return parts;
  }
  draw(v,actor,pose,detail) {
    const model=actor.model||'humanoid',tint=color(actor.color||'#81e5ed'),scale=model==='warden'?1.35:1,yaw=actor.yaw||0,cs=Math.cos(yaw),sn=Math.sin(yaw);
    for(const part of this.parts(model,actor.race,detail)) {
      const bone=pose[part.joint]||{position:[0,0,0],pitch:0};
      const [x,y,z]=bone.position,position=[actor.position[0]+(x*cs+z*sn)*scale,actor.position[1]+y*scale,actor.position[2]+(-x*sn+z*cs)*scale];
      transformMesh(v,part.mesh,position,yaw,bone.pitch,0,actor.ghost||part.color==='accent'?tint:null,actor.ghost?.8:null,scale);
    }
  }
  prune(time) { for(const [id,state]of this.motion)if(time-state.time>5)this.motion.delete(id); }
}
