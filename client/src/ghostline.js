// Ghostline movement history and swept contact geometry. GPL-3.0-or-later.
import { clamp, distance, mix3 } from './math.js';

export class GhostTrail {
  constructor(rules, maxSpeed) { this.rules=rules;this.maxSpeed=maxSpeed;this.samples=[]; }
  clear() { this.samples=[]; }
  record(time,position) {
    const r=this.rules,last=this.samples.at(-1);
    // Never connect a teleport, lift, or a stale recording into a combat route.
    if(last&&(time<last.time||time-last.time>r.sampleSeconds*3||distance(last.position,position)>this.maxSpeed*(time-last.time)+1))this.clear();
    this.samples=this.samples.filter(s=>s.time>=time-r.historySeconds-1e-8);
    if(this.samples.length&&time-this.samples.at(-1).time<r.sampleSeconds-1e-8)return;
    this.samples.push({time,position:[...position]});
    this.samples=this.samples.slice(-Math.ceil(r.historySeconds/r.sampleSeconds)-1);
  }
  get charge() {
    const seconds=this.samples.length?this.samples.at(-1).time-this.samples[0].time:0;
    const meters=this.samples.reduce((sum,s,i)=>sum+(i?distance(s.position,this.samples[i-1].position):0),0);
    return {seconds,meters,ready:seconds+1e-8>=this.rules.minSeconds&&meters>=this.rules.minDistance};
  }
  release(character,time) {
    if(!this.charge.ready)return null;
    const start=this.samples[0].time;
    return {owner:character.id,name:character.name,started:time,path:this.samples.map(s=>({time:s.time-start,position:[...s.position]}))};
  }
}

export function ghostPosition(ghost,time) {
  const elapsed=clamp(time-ghost.started,0,ghost.path.at(-1).time);
  const next=ghost.path.findIndex(s=>s.time>=elapsed);
  if(next<=0)return [...ghost.path[next===0?0:ghost.path.length-1].position];
  const a=ghost.path[next-1],b=ghost.path[next];
  return mix3(a.position,b.position,(elapsed-a.time)/(b.time-a.time));
}

export function ghostContact(ghost,time,dt,players,world,rules) {
  const armed=ghost.started+rules.armSeconds,expires=ghost.started+ghost.path.at(-1).time;
  if(time<armed||time-dt>expires+1e-8)return null;
  const toTime=Math.min(time,expires),fromTime=Math.min(toTime,Math.max(time-dt,armed)),from=ghostPosition(ghost,fromTime),to=ghostPosition(ghost,toTime);
  if(!world.lineOfSight(from,to))return null;
  let best=null;
  for(const player of players){
    if(player.health<=0)continue;
    const previous=mix3(player.previous,player.position,dt>0?clamp((fromTime-(time-dt))/dt,0,1):1);
    const current=mix3(player.previous,player.position,dt>0?clamp((toTime-(time-dt))/dt,0,1):1);
    const relative=from.map((v,i)=>v-previous[i]);
    const delta=to.map((v,i)=>v-current[i]-relative[i]);
    const length=delta.reduce((n,v)=>n+v*v,0);
    const t=length?clamp(-relative.reduce((n,v,i)=>n+v*delta[i],0)/length,0,1):0;
    const separation=Math.hypot(...relative.map((v,i)=>v+delta[i]*t));
    const position=mix3(from,to,t),contact=mix3(previous,current,t);
    if(separation>rules.triggerRadius||world.collides(...position,.1)||!world.lineOfSight(position,contact))continue;
    if(!best||separation<best.separation||(separation===best.separation&&player.id<best.id))best={id:player.id,position,separation};
  }
  return best;
}
