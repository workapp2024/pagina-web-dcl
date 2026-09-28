/* eslint-disable @typescript-eslint/no-require-imports */
require('./offline-network.cjs');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const database=require('./database.cjs');
let db;
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
before(async()=>{db=await database();await scalar('SELECT activate_finances(0,0,$1)',[randomUUID()]);});
after(async()=>{await db?.close();});
async function fixture(income=true) {
  const product=randomUUID();
  await db.query('INSERT INTO products(id,name,slug,price,stock) VALUES($1,$1,$1,100,2)',[product]);
  const order=await scalar("SELECT create_public_order($1,$1,'','pickup','','','transfer',$2::jsonb,$3)",[randomUUID(),JSON.stringify([{productId:product,quantity:1}]),randomUUID()]);
  await scalar('SELECT declare_manual_transfer($1)',[order]);
  if(!income)await db.exec("UPDATE financial_activation SET activated_at=clock_timestamp()+interval '1 day'");
  const sale=await scalar('SELECT complete_manual_transfer($1)',[order]);
  if(!income)await db.exec('UPDATE financial_activation SET activated_at=clock_timestamp()');
  const original=(await db.query("SELECT * FROM cash_movements WHERE sale_id=$1 AND movement_type='sale_income'",[sale])).rows[0];
  return {order,sale,product,original};
}
const resolve=(f,type='REFUND_VERIFIED',key=randomUUID())=>scalar('SELECT resolve_order($1,$2,$3,$4,$5)',[f.order,type,type.startsWith('REFUND')?('local-refund-'+f.order):null,'Local A4',key]);
const close=()=>scalar("SELECT close_financial_period('Next local period',false,$1)",[randomUUID()]);
async function period(id) {
  return {period:(await db.query('SELECT * FROM financial_periods WHERE id=$1',[id])).rows,
    movements:(await db.query('SELECT * FROM cash_movements WHERE period_id=$1 ORDER BY id',[id])).rows};
}
async function effects(f) {
  return {order:(await db.query('SELECT * FROM orders WHERE id=$1',[f.order])).rows,
    payment:(await db.query('SELECT * FROM payment_transactions WHERE order_id=$1',[f.order])).rows,
    sale:(await db.query('SELECT * FROM sales WHERE id=$1',[f.sale])).rows,
    stock:await scalar('SELECT stock FROM products WHERE id=$1',[f.product]),
    inventory:(await db.query('SELECT * FROM inventory_movements WHERE product_id=$1 ORDER BY id',[f.product])).rows,
    cash:(await db.query('SELECT * FROM cash_movements WHERE sale_id=$1 ORDER BY id',[f.sale])).rows,
    pending:(await db.query('SELECT * FROM financial_pending_postings WHERE order_id=$1 ORDER BY id',[f.order])).rows,
    resolutions:(await db.query('SELECT * FROM order_resolutions WHERE order_id=$1 ORDER BY id',[f.order])).rows};
}
for(const type of ['REFUND_VERIFIED','TRANSFER_APPROVAL_ERROR']) {
  for(const closed of [false,true]) {
    test(`${type}: ${closed?'closed period untouched; current period receives reversal':'open period receives reversal'}; three retries are inert`,async()=>{
      const f=await fixture(), target=closed?await close():f.original.period_id;
      const originalPeriod=await period(f.original.period_id),key=randomUUID();
      const first=await resolve(f,type,key),state=await effects(f);
      const reversals=state.cash.filter(m=>m.movement_type==='sale_reversal');
      assert.equal(reversals.length,1);assert.equal(reversals[0].amount,'-100.00');
      assert.equal(reversals[0].account_id,f.original.account_id);assert.equal(reversals[0].period_id,target);
      assert.equal(reversals[0].reversal_of_id,f.original.id);
      assert.deepEqual(state.cash.find(m=>m.id===f.original.id),f.original);
      assert.equal(state.stock,2);assert.equal(state.sale[0].status,'cancelled');assert.equal(state.resolutions.length,1);
      assert.equal(state.payment[0].status,type==='REFUND_VERIFIED'?'refunded':'cancelled');
      if(closed)assert.deepEqual(await period(f.original.period_id),originalPeriod);
      for(let n=0;n<3;n++)assert.deepEqual(await resolve(f,type,key),first);
      await assert.rejects(resolve(f,type),/ALREADY_APPLIED/);
      assert.deepEqual(await effects(f),state);
    });
  }
}
test('no original income: neither refund nor approval correction invents an expense',async()=>{
  for(const type of ['REFUND_VERIFIED','TRANSFER_APPROVAL_ERROR']) {
    const f=await fixture(false);assert.equal(f.original,undefined);
    await resolve(f,type);const state=await effects(f);
    assert.equal(state.cash.length,0);assert.equal(state.stock,2);
    for(const pending of state.pending)await scalar('SELECT post_financial_pending($1)',[pending.id]);
    assert.equal((await effects(f)).cash.length,0);
  }
});
test('REFUND_STOCK_UNAVAILABLE: reverses only a related existing income through A1 posting, in current period',async()=>{
  const f=await fixture();
  // Existing historical A1 linkage remains authoritative even without payment.sale_id.
  await db.query('UPDATE payment_transactions SET sale_id=NULL WHERE order_id=$1',[f.order]);
  await db.query("UPDATE orders SET status='stock_unavailable' WHERE id=$1",[f.order]);
  const current=await close(),old=await period(f.original.period_id),before=await effects(f),key=randomUUID();
  const first=await resolve(f,'REFUND_STOCK_UNAVAILABLE',key),state=await effects(f);
  assert.deepEqual(await period(f.original.period_id),old);
  assert.equal(state.stock,before.stock);assert.deepEqual(state.inventory,before.inventory);assert.deepEqual(state.sale,before.sale);
  const reversals=state.cash.filter(m=>m.movement_type==='sale_reversal');
  assert.equal(reversals.length,1);assert.equal(reversals[0].period_id,current);assert.equal(reversals[0].reversal_of_id,f.original.id);
  for(let n=0;n<3;n++)assert.deepEqual(await resolve(f,'REFUND_STOCK_UNAVAILABLE',key),first);
  assert.deepEqual(await effects(f),state);
});
test('REFUND_STOCK_UNAVAILABLE with no income creates no financial movement',async()=>{
  const f=await fixture(false);
  await db.query('UPDATE payment_transactions SET sale_id=NULL WHERE order_id=$1',[f.order]);
  await db.query("UPDATE orders SET status='stock_unavailable' WHERE id=$1",[f.order]);
  const before=await effects(f);await resolve(f,'REFUND_STOCK_UNAVAILABLE');const state=await effects(f);
  assert.equal(state.cash.length,0);assert.equal(state.stock,before.stock);assert.deepEqual(state.inventory,before.inventory);
});
test('no current period: refund fails atomically instead of writing to closed period',async()=>{
  const f=await fixture();
  await db.exec("UPDATE financial_periods SET status='closed',ends_at=clock_timestamp(),closed_at=clock_timestamp() WHERE status='open'");
  const before=await effects(f),old=await period(f.original.period_id);
  await assert.rejects(resolve(f),/FINANCE_NOT_READY/);
  assert.deepEqual(await effects(f),before);assert.deepEqual(await period(f.original.period_id),old);
});
