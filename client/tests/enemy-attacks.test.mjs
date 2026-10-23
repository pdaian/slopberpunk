import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { enemyAttackGeometry, enemyAttackStatus, validateEnemyCombat } from '../src/enemy-attacks.js';

const data = Object.fromEntries(['enemies','rules'].map(name => [name,JSON.parse(readFileSync(new URL(`../data/${name}.json`,import.meta.url)))]));
const strike = (shape, extra={}) => ({shape,position:[0,0,0],hitsAt:11,...extra});
const enemy = strikes => ({position:[0,0,0],health:100,stunUntil:0,attack:{name:'Test attack',started:10,strikes}});
const render = (e,time=10.5,reducedMotion=false,eye=[0,2,0]) => {
  const vertices=[];enemyAttackGeometry(vertices,[e],eye,time,reducedMotion);return vertices;
};
const points = vertices => Array.from({length:vertices.length/10},(_,i) => vertices.slice(i*10,i*10+3));

test('all three enemy families have distinct, validated movesets with actionable warnings', () => {
  validateEnemyCombat(data);
  assert.equal(data.enemies.length,3);
  assert.equal(new Set(data.enemies.flatMap(e=>e.combat.attacks.map(a=>a.kind))).size,10);
  for(const e of data.enemies)for(const a of e.combat.attacks) {
    assert.ok(a.windup>=data.rules.network.snapshotHz**-1*6,'at least six snapshot intervals to read a warning');
    assert.ok(a.range<=data.rules.combat.leash);
  }
  for(const mutate of [
    d=>{d.enemies[0].combat.attacks[0].windup=.1;},
    d=>{d.enemies[0].combat.attacks[0].range=Infinity;},
    d=>{d.enemies[0].combat.attacks[0].kind='unknown';},
    d=>{d.enemies[0].combat.attacks[1].kind=d.enemies[0].combat.attacks[0].kind;},
    d=>{d.rules.combat.enemyDamagePerLevel=NaN;},
  ]) {const copy=structuredClone(data);mutate(copy);assert.throws(()=>validateEnemyCombat(copy));}
});

test('attack labels advance through the burst and expire without hiding the next strike', () => {
  const e=enemy([strike('circle',{radius:3,innerRadius:0}),strike('circle',{radius:3,innerRadius:0,hitsAt:11.4})]);
  assert.equal(enemyAttackStatus(e,10.5),'Test attack · 0.5s');
  assert.equal(enemyAttackStatus(e,11.1),'Test attack · 0.3s');
  assert.equal(enemyAttackStatus(e,11.5),'Test attack · STRIKE');
  assert.equal(enemyAttackStatus(e,12),'');
  e.stunUntil=12;assert.equal(enemyAttackStatus(e,10.5),'');
  e.stunUntil=0;e.health=0;assert.equal(enemyAttackStatus(e,10.5),'');
  assert.equal(enemyAttackStatus({health:1},10),'');
});

test('lane warnings rotate around the committed origin and keep their full width and length', () => {
  for(const yaw of [0,Math.PI/2,-Math.PI/3]) {
    const p=[12,24,-8],s=strike('lane',{position:p,yaw,length:18,width:3}),e=enemy([s]);
    const vertices=render(e),ps=points(vertices);
    assert.ok(vertices.length>0);assert.equal(vertices.length%30,0);assert.ok(vertices.every(Number.isFinite));
    const along=ps.map(q=>(q[0]-p[0])*Math.sin(yaw)+(q[2]-p[2])*Math.cos(yaw));
    const across=ps.map(q=>(q[0]-p[0])*Math.cos(yaw)-(q[2]-p[2])*Math.sin(yaw));
    assert.ok(Math.min(...along)>=-.07&&Math.max(...along)<=18.07);
    assert.ok(Math.min(...across)>=-1.57&&Math.max(...across)<=1.57);
    assert.ok(ps.every(q=>q[1]>=24&&q[1]<24.2));
  }
});

test('shockwave rings leave their center clear and cones leave space behind the attacker', () => {
  const ring=render(enemy([strike('circle',{radius:9,innerRadius:2.8})]));
  for(const [x,,z] of points(ring))assert.ok(Math.hypot(x,z)>2.65,'safe center must not be painted as danger');
  const cone=render(enemy([strike('cone',{radius:8,yaw:0,angle:1.05})]));
  assert.ok(cone.length>1000);
  for(const [x,,z] of points(cone)) {
    assert.ok(z>=-.1,'the back of a cleave is safe');
    assert.ok(Math.hypot(x,z)<=8.2);
  }
});

test('warnings survive reduced motion, while dead, interrupted, distant and expired attacks disappear', () => {
  const e=enemy([strike('circle',{radius:4,innerRadius:0})]);
  assert.deepEqual(render(e,10.5,true),render(e,10.5,false));
  assert.ok(render(e,11.1,true).length>0);
  assert.ok(render(e,11.1,false).length>render(e,11.1,true).length);
  assert.equal(render(e,12).length,0);
  assert.equal(render(e,9).length,0);
  assert.equal(render(e,10.5,false,[200,0,0]).length,0);
  assert.equal(render({...e,health:0}).length,0);
  assert.equal(render({...e,stunUntil:12}).length,0);
  assert.equal(render({...e,attack:null}).length,0);
  assert.equal(render(enemy([strike('lane',{length:0,width:3,yaw:0})])).length,0);
});

test('rendering a full simultaneous moveset stays bounded, finite and does not mutate snapshots', () => {
  const zones=[strike('lane',{length:44,width:1.8,yaw:.4}),strike('cone',{radius:8,angle:1.15,yaw:2}),strike('circle',{radius:15,innerRadius:9})];
  const actors=Array.from({length:12},()=>enemy(zones)),snapshot=JSON.stringify(actors),vertices=[];
  enemyAttackGeometry(vertices,actors,[0,2,0],10.5);
  assert.ok(vertices.length<500000);assert.ok(vertices.every(Number.isFinite));
  assert.equal(JSON.stringify(actors),snapshot);
});
