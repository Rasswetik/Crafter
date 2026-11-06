const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ctx=vm.createContext({document:{addEventListener(){} }});
vm.runInContext(fs.readFileSync('static/arena.js','utf8'),ctx,{filename:'arena.js'});
const cells=vm.runInContext('arenaCells',ctx);
const landing=vm.runInContext('arenaWinnerLanding',ctx);
const inside=vm.runInContext('arenaInside',ctx);
const puck=vm.runInContext('arenaPuckFrame',ctx);
const arena=vm.runInContext('arena',ctx);
const eps=1e-5;

function check(players, weights, seed){
 const regions=cells(players,seed,weights);
 assert.equal(regions.length,players.length);
 for(const cell of regions){
  const point=landing(cell,seed);
  assert(inside(point,cell.points),'The puck must stop on the winning side');
  assert(point.x>=4-eps&&point.x<=96+eps);
  assert(point.y>=4-eps&&point.y<=96+eps);
  const distance=Math.hypot(point.x-cell.center.x,point.y-cell.center.y);
  assert(distance>cell.radius+3,
   'Finish should be outside the winner avatar, not at its center: '+JSON.stringify(cell));
  assert.deepEqual(landing(cell,seed),point,'Landing must be deterministic for synchronized clients');
 }
 return regions;
}
const two=[{id:'alice',name:'Alice'},{id:'bob',name:'Bob'}];
for(const seed of [0,17,92857,4294967295]){
 const regions=check(two,[50,50],seed);
 for(const cell of regions){
  arena.cells=regions;
  arena.playback=null;arena.serverOrigin=0;
  const data={round_id:'round-'+seed+'-'+cell.index,seed,target:cell.player.id,
    bet_until:0,aim_ms:3000,flight_ms:4000,finish_ms:4000};
  const t=3000+4000+4000;
  const result=puck(data,t);
  const goal=landing(cell,seed);
  assert(Math.abs(result.x-goal.x)<.000001);
  assert(Math.abs(result.y-goal.y)<.000001);
  assert(inside(result,cell.points));
  assert(Math.hypot(result.x-cell.center.x,result.y-cell.center.y)>cell.radius+3);
  const before=puck(data,t-50);
  assert(Math.hypot(result.x-before.x,result.y-before.y)<8,'The puck should brake smoothly');
 }
}
check([{id:'a'},{id:'b'},{id:'c'}],[40,40,20],117);
check([{id:'a'},{id:'b'},{id:'c'},{id:'d'}],[30,25,20,25],789);
console.log('Arena puck finishes inside winner territory away from centered avatar.');
