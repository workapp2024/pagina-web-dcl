/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test');
const assert=require('node:assert/strict');
// Exhaustive two-transaction lock scheduler. This is a model, not a claim of
// separate PostgreSQL sessions: PGlite has only one backend in this environment.
function hasDeadlock(orders) {
  const seen=new Set();
  function visit(positions,owners,finished) {
    const key=JSON.stringify([positions,owners,finished]);if(seen.has(key))return false;seen.add(key);
    if(finished.every(Boolean))return false;
    let canProgress=false;
    for(let t=0;t<2;t++) {
      if(finished[t])continue;
      if(positions[t]===orders[t].length) {
        canProgress=true;const next=[...finished];next[t]=true;
        if(visit(positions,owners.map(owner=>owner===t?null:owner),next))return true;
      } else {
        const product=orders[t][positions[t]];
        if(owners[product]!==null&&owners[product]!==t)continue;
        canProgress=true;const nextPos=[...positions],nextOwners=[...owners];nextPos[t]++;nextOwners[product]=t;
        if(visit(nextPos,nextOwners,finished))return true;
      }
    }
    return !canProgress;
  }
  return visit([0,0],[null,null],[false,false]);
}
test('inverse product locks reproduce deadlock; ordered locks eliminate it across all modeled interleavings',()=>{
  assert.equal(hasDeadlock([[0,1],[1,0]]),true);
  assert.equal(hasDeadlock([[0,1],[1,0].sort()]),false);
});
