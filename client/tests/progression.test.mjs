// In-memory checks for long progression, reachable trees, and combat build limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {experienceFor,talentBudget,spentTalents,talentBlock,talentPanel,respecCost,validateProgression} from '../src/progression.js';
import {validateEconomy} from '../src/economy.js';
import {stats} from '../src/prediction.js';
import {statCaps,equipmentSlots} from '../src/item-catalog.js';
import {founderXpReward} from '../src/founders.js';

const data=Object.fromEntries(['economy','rules','enemies','talents','races','npcs','world','abilities'].map(n=>[n,JSON.parse(readFileSync(new URL(`../data/${n}.json`,import.meta.url)))]));
validateEconomy(data);
const character=()=>({level:0,xp:0,health:100,energy:60,gold:500,race:'human',talents:{},items:{},equipment:{},buffs:{}});

test('every level costs exactly 1100 times the previous curve and a full character needs 73,425,000 XP',()=>{
  let total=0,patrolKills=0;
  for(let level=0;level<60;level++) {
    const cost=experienceFor(level,data.rules);
    assert.equal(cost,1100*(80+level*35));total+=cost;
    patrolKills+=cost/(28+level*9);
  }
  assert.equal(total,73425000);
  assert.ok(patrolKills/8/60>500,'even eight same-level kills per minute is a months-long baseline');
});

test('quarter-level talent points remain monotonic across level boundaries and cap at 246',()=>{
  const c=character();assert.equal(talentBudget(c,data.rules),6);
  for(let level=0;level<60;level++)for(let quarter=1;quarter<=4;quarter++) {
    c.level=level;c.xp=experienceFor(level,data.rules)*quarter/4-1;
    assert.equal(talentBudget(c,data.rules),6+level*4+quarter-1);
    if(quarter===4){c.level++;c.xp=0;}else c.xp++;
    assert.equal(talentBudget(c,data.rules),6+level*4+quarter);
  }
  c.level=60;c.xp=Number.MAX_SAFE_INTEGER;assert.equal(talentBudget(c,data.rules),246);
});

test('six branching trees contain 78 reachable nodes and enforce their capstone choices',()=>{
  validateProgression(data);
  const branches=[...new Set(data.talents.map(t=>t.branch))];assert.equal(branches.length,6);assert.equal(data.talents.length,78);
  for(const branch of branches) {
    const c=character();c.level=60;
    const nodes=data.talents.filter(t=>t.branch===branch).sort((a,b)=>a.row-b.row);
    assert.match(talentBlock(c,data,nodes.find(t=>t.row===1)),/Requires/);
    for(const node of nodes.filter(n=>n.row<4))for(let rank=1;rank<=node.maxRank;rank++) {
      assert.equal(talentBlock(c,data,node),'',node.id);c.talents[node.id]=rank;
    }
    const caps=nodes.filter(n=>n.row===4);assert.equal(caps.length,3);
    for(const cap of caps)assert.equal(talentBlock(c,data,cap),'');
    c.talents[caps[0].id]=1;
    assert.match(talentBlock(c,data,caps[1]),/already chose a final talent/);
    assert.match(talentBlock(c,data,caps[0]),/highest rank/);
  }
});

test('talent gates reject cycles, missing dependencies, overspending, dead training, and low levels',()=>{
  const corruptions=[d=>d.talents[0].requires=[{id:d.talents[0].id,rank:1}],d=>d.talents[1].requires=[{id:'missing',rank:1}],d=>d.talents[1].requires[0].rank=99,d=>d.talents[1].row=0,d=>d.talents[0].amount=NaN];
  for(const corrupt of corruptions){const copy={...data,talents:structuredClone(data.talents)};corrupt(copy);assert.throws(()=>validateProgression(copy),/Invalid progression/);}
  const c=character(),root=data.talents.find(t=>t.id==='plating');
  c.health=0;assert.match(talentBlock(c,data,root),/Return to life/);c.health=100;
  c.talents={capacitor:3,symbiosis:3};assert.equal(spentTalents(c),6);assert.match(talentBlock(c,data,root),/Earn more XP/);
  assert.match(talentBlock(c,data,data.talents.find(t=>t.row===4)),/level 30/);
});

test('talent UI explains dependencies, shows one tree, and gates the paid refund at Patch',()=>{
  const c=character();c.talents={plating:1};
  assert.equal(respecCost(c,data.rules),100);
  const enabled=talentPanel(c,data,'Anchor',true),disabled=talentPanel(c,data,'Anchor',false);
  assert.equal((enabled.match(/class="talent-card/g)||[]).length,13);
  assert.match(enabled,/Soft armor 1 →/);assert.match(enabled,/CHOOSE ONE/);
  assert.match(enabled,/data-do="respec" >RESET TALENTS/);assert.match(disabled,/data-do="respec" disabled/);
  c.health=0;assert.match(talentPanel(c,data,'Anchor',true),/data-do="respec" disabled/);
});

test('gear and tree bonuses obey combat caps before resurrection sickness',()=>{
  const c=character();c.level=60;
  for(const t of data.talents)c.talents[t.id]=t.maxRank;
  for(const slot of equipmentSlots)c.equipment[slot]=`mod-5-${slot}-bastion-sanguine-renewal`;
  const s=stats(c,data);for(const [key,cap]of Object.entries(statCaps))assert.ok(s[key]<=cap,key);
  for(const [key,value]of Object.entries(s))assert.ok(Number.isFinite(value)&&value>=0,key);
  assert.equal(s.armor,.6);assert.equal(s.leech,.2);
  for(const slot of equipmentSlots)c.equipment[slot]=`mod-5-${slot}-clockwork-swift-rhythm`;
  assert.equal(stats(c,data).haste,.4);
  c.resurrectionSickness=1;assert.equal(stats(c,data).speed,s.speed*.75);
});

test('founder bonus observes the new prologue and level-ten boundaries',()=>{
  const c={...character(),founderHalo:1};
  assert.deepEqual(founderXpReward(c,180,data.rules),{xp:180,remainder:0});
  const first=experienceFor(0,data.rules);
  assert.deepEqual(founderXpReward(c,first+100,data.rules),{xp:first+105,remainder:0});
  c.level=9;c.xp=experienceFor(9,data.rules)-21;
  assert.deepEqual(founderXpReward(c,120,data.rules),{xp:121,remainder:0});
  c.xp=experienceFor(9,data.rules)-1;c.founderXpRemainder=19;
  assert.deepEqual(founderXpReward(c,1,data.rules),{xp:1,remainder:0});
});
