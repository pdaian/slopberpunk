// Render server-committed attack footprints; the client never decides hits. GPL-3.0-or-later.
import { box } from './geometry.js';
import { color, distance, clamp } from './math.js';

const kinds = new Set(['burst','fan','bombard','combo','lunge','grenades','cleave','shockwave','charge','artillery']);

export function validateEnemyCombat(data) {
  const fail = () => { throw new Error('Invalid enemy combat profile.'); };
  const ids = new Set();
  for (const e of data.enemies) {
    const p = e.combat;
    if (!e.id || ids.has(e.id) || ['health','damage','speed'].some(k => !Number.isFinite(e[k]) || e[k] <= 0)
        || !p || !Number.isFinite(p.preferredRange) || p.preferredRange < 1 || p.preferredRange > 25
        || !Array.isArray(p.attacks) || p.attacks.length < 3 || p.attacks.length > 4
        || new Set(p.attacks.map(a => a.kind)).size !== p.attacks.length) fail();
    ids.add(e.id);
    for (const a of p.attacks) {
      if (!kinds.has(a.kind) || typeof a.name !== 'string' || !a.name.trim() || a.name.length > 48
          || ['windup','recovery','minRange','range','power'].some(k => !Number.isFinite(a[k]))
          || a.windup < .65 || a.windup > 2 || a.recovery < .3 || a.recovery > 2
          || a.minRange < 0 || a.minRange >= a.range || a.range < 5 || a.range > 50 || a.power < .1 || a.power > 2) fail();
    }
  }
  for (const key of ['enemyAttackSeconds','enemyHealthPerLevel','enemyDamagePerLevel']) {
    if (!Number.isFinite(data.rules.combat[key]) || data.rules.combat[key] <= 0) fail();
  }
}

export function enemyAttackStatus(enemy, time) {
  if (!enemy.attack || enemy.health <= 0 || enemy.stunUntil > time) return '';
  const next = enemy.attack.strikes.filter(s => s.hitsAt > time).sort((a,b) => a.hitsAt-b.hitsAt)[0];
  if (next) return `${enemy.attack.name} · ${(next.hitsAt-time).toFixed(1)}s`;
  return enemy.attack.strikes.some(s => time <= s.hitsAt+.25) ? `${enemy.attack.name} · STRIKE` : '';
}

export function enemyAttackGeometry(vertices, enemies, eye, time, reducedMotion = false) {
  const line = (a, b, width, hex, height = .12) => {
    const length = Math.hypot(b[0]-a[0],b[2]-a[2]);
    if (length < .001) return;
    // Flat quads keep overlapping telegraphs cheap even on the lowest render setting.
    const x=(b[2]-a[2])/length*width/2,z=-(b[0]-a[0])/length*width/2,rgb=color(hex);
    const corners=[[a[0]-x,a[2]-z],[b[0]-x,b[2]-z],[b[0]+x,b[2]+z],[a[0]+x,a[2]+z]];
    for(const i of [0,1,2,0,2,3])vertices.push(corners[i][0],a[1]+height,corners[i][1],0,1,0,...rgb,.9);
  };
  const triangle = (a,b,c,hex) => {
    const rgb = color(hex);
    for (const p of [a,b,c]) vertices.push(p[0],p[1]+.08,p[2],0,1,0,...rgb,.35);
  };
  for (const e of enemies) {
    if (!e.attack || e.health <= 0 || e.stunUntil > time || distance(eye,e.position) > 140) continue;
    for (const s of e.attack.strikes) {
      if (time > s.hitsAt+.25 || time < e.attack.started) continue;
      const active = time >= s.hitsAt, hex = active ? '#fff0cb' : '#ffad70', fill = active ? '#ad573a' : '#613d36';
      const progress = clamp((time-e.attack.started)/Math.max(.01,s.hitsAt-e.attack.started),0,1);
      const p = s.position;
      if (s.shape === 'lane') {
        if (s.length < .001) continue;
        const forward = [Math.sin(s.yaw),0,Math.cos(s.yaw)], side = [Math.cos(s.yaw),0,-Math.sin(s.yaw)];
        const point = (along,across) => p.map((v,i) => v+forward[i]*along+side[i]*across);
        const a=point(0,-s.width/2),b=point(s.length,-s.width/2),c=point(s.length,s.width/2),d=point(0,s.width/2);
        triangle(a,b,c,fill);triangle(a,c,d,fill);
        line(a,b,.12,hex);line(c,d,.12,hex);line(a,d,.12,hex);line(b,c,.12,hex);
        // Crossbars mark the whole lane, with a filling centerline for the countdown.
        for(let n=1;n<s.length;n+=2)line(point(n,-s.width/2),point(n,s.width/2),.12,hex);
        line(p,point(s.length*progress,0),.14,hex);
        if(active&&!reducedMotion)line(p,point(s.length,0),.2,hex,1.1);
      } else if (s.shape === 'circle' || s.shape === 'cone') {
        const inner = s.shape === 'circle' ? s.innerRadius : 0;
        const start = s.shape === 'cone' ? s.yaw-s.angle : 0;
        const sweep = s.shape === 'cone' ? s.angle*2 : Math.PI*2;
        const steps = Math.ceil(sweep/(Math.PI/24));
        const point = (angle,r) => [p[0]+Math.sin(angle)*r,p[1],p[2]+Math.cos(angle)*r];
        for(let i=0;i<steps;i++) {
          const a=start+sweep*i/steps,b=start+sweep*(i+1)/steps;
          const ai=point(a,inner),ao=point(a,s.radius),bi=point(b,inner),bo=point(b,s.radius);
          triangle(ai,ao,bo,fill);if(inner>0)triangle(ai,bo,bi,fill);
          line(ao,bo,.15,i/steps<=progress?hex:'#b47555');
          if(inner>0)line(ai,bi,.15,hex);
          if(i%4===0)line(ai,ao,.12,hex);
        }
        if(s.shape==='cone')for(const a of [start,start+sweep])line(p,point(a,s.radius),.15,hex);
        if(active&&!reducedMotion)for(let i=0;i<8;i++) {
          const q=point(start+sweep*(i+.5)/8,(inner+s.radius)/2);
          box(vertices,[q[0],q[1]+.45,q[2]],[.16,.8,.16],hex,1);
        }
      }
    }
  }
}
