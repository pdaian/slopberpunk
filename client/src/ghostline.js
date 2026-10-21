// Render server-authored Ghostline routes. GPL-3.0-or-later.
import { clamp, mix3 } from './math.js';

export function ghostPosition(ghost,time) {
  const elapsed=clamp(time-ghost.started,0,ghost.path.at(-1).time);
  const next=ghost.path.findIndex(s=>s.time>=elapsed);
  if(next<=0)return [...ghost.path[next===0?0:ghost.path.length-1].position];
  const a=ghost.path[next-1],b=ghost.path[next];
  return mix3(a.position,b.position,(elapsed-a.time)/(b.time-a.time));
}
