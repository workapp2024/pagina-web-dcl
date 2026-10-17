const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const load = require('./load-ts.cjs');
const { buildSectorCash } = load('lib/finance-sector-cash.ts');
const row = (id,amount,extra={}) => ({ id,amount,movement_type:'income',account_id:'cash',period_id:'p',occurred_at:'2026-10-17T12:00:00Z',description:'Motivo',...extra });

test('cash is counted once; opening and manual money stay unassigned; sales and pending entries cannot invent cash', () => {
  const result=buildSectorCash([
    row('opening',100,{movement_type:'opening_balance'}), row('manual',10),
    row('sale',200,{movement_type:'sale_income',sale_id:'s'}),
    row('reversal',-200,{movement_type:'sale_reversal',sale_id:'s'}),
    row('wholesale',70,{wholesale_payment_entry_id:'pay'}),
    row('refund',-20,{wholesale_payment_entry_id:'refund'}),
    row('out',-40,{movement_type:'adjustment',transfer_id:'t'}),row('in',40,{movement_type:'adjustment',transfer_id:'t',account_id:'bank'}),
  ]);
  assert.equal(result.total,160);
  assert.deepEqual({...result.minoristas},{available:0,income:200,expense:200});
  assert.deepEqual({...result.mayoristas},{available:50,income:70,expense:20});
  assert.deepEqual({...result.unassigned},{available:110,income:10,expense:0});
  assert.equal(result.minoristas.available+result.mayoristas.available+result.unassigned.available,result.total);
});

test('explicit sector transfers net zero and reversals retain references, while shared opening never inherits an arbitrary split', () => {
  const rows=[row('opening',100,{movement_type:'opening_balance'}),row('a',-30,{transfer_id:'t',movement_type:'adjustment'}),row('b',30,{transfer_id:'t',movement_type:'adjustment'})];
  const result=buildSectorCash(rows,[{cash_movement_id:'a',sector:'unassigned'},{cash_movement_id:'b',sector:'mayoristas'}]);
  assert.equal(result.total,100);assert.equal(result.mayoristas.available,30);assert.equal(result.unassigned.available,70);
  assert.equal(result.mayoristas.income,0);assert.equal(result.unassigned.expense,0);
  assert.equal(result.sharedOpening,true);
  assert.throws(()=>buildSectorCash([row('bad',NaN)]),/inválido/);
  assert.throws(()=>buildSectorCash([row('bad',0.001)]),/inválido/);
  assert.throws(()=>buildSectorCash([row('x',1),row('x',1)]),/duplicado/);
  assert.equal(buildSectorCash([row('negative',-1,{sale_id:'s',movement_type:'sale_reversal'})]).minoristas.available,-1);
});

test('finance API totals every cash page independently of filtered history, excludes noncash wholesale activity and reports retail pending', async () => {
  const cash=Array.from({length:1003},(_,i)=>row(String(i),1,{sale_id:'s',movement_type:'sale_income'}));
  const datasets={ financial_accounts:[{id:'cash',name:'Caja',active:true}],financial_periods:[{id:'p',name:'Actual',status:'open',starts_at:'2026-01-01'}],financial_activation:{activated_at:'2026-01-01',initial_period_id:'p'},cash_movements:cash,financial_pending_postings:[{id:'pending',amount:50,currency:'ARS',status:'pending'}] };
  function query(table){let start=0,end=Infinity,limit=Infinity;const q={select:()=>q,order:()=>q,gte:()=>q,lte:()=>q,eq:()=>q,in:()=>q,maybeSingle:()=>q,limit:n=>{limit=n;return q;},range:(a,b)=>{start=a;end=b;return q;},then:resolve=>Promise.resolve(table==='financial_sector_allocations'?{data:null,error:{code:'42P01'}}:{data:Array.isArray(datasets[table])?datasets[table].slice(start,Math.min(end+1,limit)):datasets[table]||[],error:null}).then(resolve)};return q;}
  const { GET }=load('app/api/admin/finances/route.ts',{
    '@/lib/admin-auth':{isAdminAuthenticated:async()=>true},
    '@/lib/supabase/server':{isServiceRoleConfigured:()=>true,createAdminServerClient:()=>({from:query})},
  });
  const response=await GET(new Request('https://test.invalid?from=2026-10-17&movementType=income'));
  const body=await response.json();assert.equal(response.status,200);
  assert.equal(body.data.cashBySector.total,1003);assert.equal(body.data.cashBySector.minoristas.available,1003);
  assert.equal(body.data.cashBySector.movements.length,1003);assert.equal(body.data.retailPending.length,1);
  assert.equal(body.data.cashBySector.unassigned.available,0);
});

test('proposed sector operations are idempotent, balanced, reversible, immutable and restricted to ADMIN/service_role',async()=>{
  const db=await require('./database.cjs')();
  try {
    await db.exec(fs.readFileSync('scripts/maintenance/proposed-block3-sector-finances.sql','utf8'));
    await db.exec(fs.readFileSync('scripts/maintenance/rollback-proposed-block3-sector-finances.sql','utf8'));
    assert.equal((await db.query("SELECT to_regclass('public.financial_sector_operations') AS name")).rows[0].name,null);
    await db.exec(fs.readFileSync('scripts/maintenance/proposed-block3-sector-finances.sql','utf8'));
    const actor=randomUUID(),seller=randomUUID();
    await db.query('INSERT INTO auth.users(id) VALUES($1),($2)',[actor,seller]);
    // Perfiles de prueba en la base efímera; nunca conecta con producción.
    await db.query("INSERT INTO admin_profiles(id,email,display_name,role,active) VALUES($1,'admin@test.invalid','Admin','ADMIN',true),($2,'seller@test.invalid','Seller','VENDEDOR',true)",[actor,seller]);
    await db.query('SELECT activate_finances(100,0,$1)',[randomUUID()]);
    await db.exec("UPDATE financial_periods SET starts_at=clock_timestamp()-interval '1 day' WHERE status='open'");
    const date=new Date().toISOString();
    const call=(action,amount,from,to,key=randomUUID(),reverse=null,who=actor,when=date,kind=null,legacy=null)=>db.query('SELECT record_sector_finance($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[action,action==='reverse'?null:'cash',amount,from,to,when,'Origen/destino','Motivo',who,key,reverse,kind,legacy]);
    await db.exec('SET ROLE service_role');
    const income=randomUUID();await call('income',50,null,'minoristas',income);await call('income',50,null,'minoristas',income);
    await assert.rejects(call('income',51,null,'minoristas',income),/KEY_REUSED/);
    const transfer=randomUUID();await call('transfer',20,'minoristas','mayoristas',transfer);
    assert.equal(Number((await db.query("SELECT sum(amount) AS n FROM cash_movements WHERE account_id='cash'")).rows[0].n),150);
    const allocations=(await db.query('SELECT * FROM financial_sector_allocations')).rows;
    const cash=(await db.query('SELECT * FROM cash_movements')).rows;
    let summary=buildSectorCash(cash,allocations);
    assert.equal(summary.minoristas.available,30);assert.equal(summary.mayoristas.available,20);assert.equal(summary.unassigned.available,100);
    await assert.rejects(call('transfer',31,'minoristas','mayoristas'),/INSUFFICIENT/);
    await assert.rejects(call('income',0,null,'minoristas'),/INVALID/);
    await assert.rejects(call('income',1,null,'otro'),/INVALID/);
    await assert.rejects(call('income',1,null,'minoristas',randomUUID(),null,seller),/ADMIN_REQUIRED/);
    await assert.rejects(call('withdrawal',1,'minoristas',null,randomUUID(),null,actor,new Date(Date.parse(date)-60000).toISOString()),/INSUFFICIENT/);
    await assert.rejects(call('income',1,null,'minoristas',randomUUID(),null,actor,new Date(Date.parse(date)+86400000).toISOString()),/INVALID/);
    await assert.rejects(call('income',1,null,'minoristas',randomUUID(),null,actor,date,'sale_income'),/INVALID/);
    await call('reverse',null,null,null,randomUUID(),transfer);
    await assert.rejects(call('reverse',null,null,null,randomUUID(),transfer),/REVERSAL_INVALID/);
    summary=buildSectorCash((await db.query('SELECT * FROM cash_movements')).rows,(await db.query('SELECT * FROM financial_sector_allocations')).rows);
    assert.equal(summary.minoristas.available,50);assert.equal(summary.mayoristas.available,0);assert.equal(summary.total,150);
    await assert.rejects(db.query("UPDATE cash_movements SET amount=999 WHERE id=$1",[allocations[0].cash_movement_id]),/IMMUTABLE/);
    await assert.rejects(db.query('DELETE FROM financial_sector_allocations'),/permission denied/);
    const early=new Date(Date.parse(date)-3600000).toISOString(),middle=new Date(Date.parse(date)-1800000).toISOString(),between=new Date(Date.parse(date)-2700000).toISOString();
    await call('income',20,null,'mayoristas',randomUUID(),null,actor,early);
    await call('withdrawal',20,'mayoristas',null,randomUUID(),null,actor,middle);
    const recent=randomUUID();await call('income',20,null,'mayoristas',recent);
    await assert.rejects(call('withdrawal',1,'mayoristas',null,randomUUID(),null,actor,between),/INSUFFICIENT/);
    await call('reverse',null,null,null,randomUUID(),recent);
    const legacy=(await db.query("SELECT record_financial_movement('expense',-5,'Gasto de prueba','cash',$1) AS id",[randomUUID()])).rows[0].id;
    const legacyBefore=(await db.query('SELECT * FROM cash_movements WHERE id=$1',[legacy])).rows[0];
    const actualDate=(await db.query('SELECT clock_timestamp()::text AS date')).rows[0].date;
    const reversalKey=randomUUID();await call('reverse',null,null,null,reversalKey,null,actor,actualDate,null,legacy);
    await call('reverse',null,null,null,reversalKey,null,actor,actualDate,null,legacy);
    await assert.rejects(call('reverse',null,null,null,randomUUID(),null,actor,actualDate,null,legacy),/FORBIDDEN/);
    assert.deepEqual((await db.query('SELECT * FROM cash_movements WHERE id=$1',[legacy])).rows[0],legacyBefore);
    await assert.rejects(db.query('UPDATE cash_movements SET amount=-999 WHERE id=$1',[legacy]),/IMMUTABLE/);
    const forbidden=(await db.query("SELECT id FROM cash_movements WHERE movement_type='opening_balance' LIMIT 1")).rows[0].id;
    await assert.rejects(call('reverse',null,null,null,randomUUID(),null,actor,actualDate,null,forbidden),/FORBIDDEN/);
    await db.exec('RESET ROLE');
    const beforeFailure=(await db.query('SELECT (SELECT count(*) FROM cash_movements) cash,(SELECT count(*) FROM financial_sector_operations) operations')).rows;
    await db.exec("CREATE FUNCTION fail_sector_allocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test atomic rollback'; END $$; CREATE TRIGGER fail_sector_allocation BEFORE INSERT ON financial_sector_allocations FOR EACH ROW EXECUTE FUNCTION fail_sector_allocation(); SET ROLE service_role");
    await assert.rejects(call('income',1,null,'minoristas'),/test atomic rollback/);
    await db.exec('RESET ROLE; DROP TRIGGER fail_sector_allocation ON financial_sector_allocations; DROP FUNCTION fail_sector_allocation()');
    assert.deepEqual((await db.query('SELECT (SELECT count(*) FROM cash_movements) cash,(SELECT count(*) FROM financial_sector_operations) operations')).rows,beforeFailure);
    await assert.rejects(db.exec(fs.readFileSync('scripts/maintenance/rollback-proposed-block3-sector-finances.sql','utf8')),/ROLLBACK_HAS_HISTORY/);
    await db.exec('ROLLBACK; SET ROLE service_role');
    const nextPeriod=(await db.query('SELECT close_financial_period($1,false,$2) AS id',['Siguiente',randomUUID()])).rows[0].id;
    await call('income',50,null,'minoristas',income); // Reintento antiguo: no duplica ni escribe en el período nuevo.
    const opening=buildSectorCash((await db.query('SELECT * FROM cash_movements WHERE period_id=$1',[nextPeriod])).rows);
    assert.equal(opening.total,150);assert.equal(opening.unassigned.available,150);assert.equal(opening.minoristas.available,0);
    assert.equal(opening.unassigned.income,0);
    for(const role of ['anon','authenticated']){
      await db.exec(`RESET ROLE; SET ROLE ${role}`);
      await assert.rejects(call('income',1,null,'minoristas'),/permission denied/);
    }
  } finally {await db.close();}
});
