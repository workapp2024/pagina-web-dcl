/* eslint-disable @typescript-eslint/no-require-imports */
require('./offline-network.cjs');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const database = require('./database.cjs');
let db;
const scalar = async (sql, args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
before(async()=>{ db=await database(); });
after(async()=>{ await db?.close(); });
async function fixture() {
  const product=randomUUID(),customer=randomUUID();
  await db.query('INSERT INTO products(id,name,slug,price,stock) VALUES($1,$1,$1,100,10)',[product]);
  await db.query("INSERT INTO customers(id,full_name) VALUES($1,'Test')",[customer]);
  return {product,customer,items:JSON.stringify([{productId:product,quantity:1}])};
}
const manual=(f,method='cash',key=randomUUID())=>scalar("SELECT create_sale_with_inventory($1,NULL,'',$2::jsonb,false,$3,$4)",[f.customer,f.items,method,key]);
const order=(f,method='transfer',key=randomUUID())=>scalar("SELECT create_public_order('Test','123','','pickup','','',$1,$2::jsonb,$3)",[method,f.items,key]);
async function pay(id,method='transfer') {
  if(method==='transfer') {
    await scalar('SELECT declare_manual_transfer($1)',[id]);
    return scalar('SELECT complete_manual_transfer($1)',[id]);
  }
  await db.query("UPDATE payment_transactions SET external_order_id='mock-'||order_id WHERE order_id=$1",[id]);
  return scalar("SELECT complete_mercadopago_order($1::uuid,'mock-'||$1::text,'payment-'||$1::text,100,'ARS','processed')",[id]);
}
const ready=()=>scalar('SELECT activate_finances(0,0,$1)',[randomUUID()]);
const off=()=>db.exec('UPDATE financial_activation SET activated_at=clock_timestamp()+interval \'1 day\'');
const on=()=>db.exec('UPDATE financial_activation SET activated_at=clock_timestamp()');

test('disabled finance rejects new manual sale and checkout atomically',async()=>{
  const f=await fixture();
  await assert.rejects(manual(f),/FINANCE_NOT_READY/);
  await assert.rejects(order(f),/FINANCE_NOT_READY/);
  for(const table of ['sales','sale_items','orders','order_items','inventory_reservations','payment_transactions','inventory_movements','financial_pending_postings'])
    assert.equal(await scalar(`SELECT count(*)::int FROM ${table}`),0);
  assert.equal(await scalar('SELECT stock FROM products WHERE id=$1',[f.product]),10);
});
test('readiness requires activation, valid current period and both active accounts',async()=>{
  await ready(); assert.ok(await scalar('SELECT financial_ready_period()'));
  await off(); assert.equal(await scalar('SELECT financial_ready_period()'),null); await on();
  await db.exec("UPDATE financial_accounts SET active=false WHERE id='mercadopago'");
  assert.equal(await scalar('SELECT financial_ready_period()'),null);
  await db.exec("UPDATE financial_accounts SET active=true WHERE id='mercadopago'; UPDATE financial_periods SET starts_at=clock_timestamp()+interval '1 day'");
  assert.equal(await scalar('SELECT financial_ready_period()'),null);
  await db.exec('UPDATE financial_periods SET starts_at=clock_timestamp()');
});
test('manual mapping and retries; unknown accounts are blocked without stock changes',async()=>{
  for(const method of ['cash','transfer','mercadopago']) {
    const f=await fixture(),key=randomUUID(),sale=await manual(f,method,key);
    assert.equal(await manual(f,method,key),sale);
    assert.equal(await scalar("SELECT account_id FROM cash_movements WHERE sale_id=$1 AND movement_type='sale_income'",[sale]),method==='cash'?'cash':'mercadopago');
    await off(); assert.equal(await manual(f,method,key),sale); await on();
  }
  const f=await fixture();
  for(const method of ['debit','credit','other']) await assert.rejects(manual(f,method),/FINANCIAL_ACCOUNT_REQUIRED/);
  assert.equal(await scalar('SELECT stock FROM products WHERE id=$1',[f.product]),10);
  assert.equal(await scalar('SELECT count(*)::int FROM sales WHERE customer_id=$1',[f.customer]),0);
  assert.equal(await scalar('SELECT count(*)::int FROM sale_items WHERE product_id=$1',[f.product]),0);
  assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements WHERE product_id=$1',[f.product]),0);
});
test('transfer, Mercado Pago and public card post once and preserve commercial methods',async()=>{
  for(const method of ['transfer','mercadopago','card']) {
    const f=await fixture(),id=await order(f,method),sale=await pay(id,method);
    assert.equal(await pay(id,method),sale);
    assert.equal(await scalar('SELECT stock FROM products WHERE id=$1',[f.product]),9);
    assert.equal(await scalar('SELECT status FROM inventory_reservations WHERE order_id=$1',[id]),'consumed');
    assert.equal(await scalar('SELECT status FROM payment_transactions WHERE order_id=$1',[id]),'approved');
    assert.equal(await scalar('SELECT status FROM sales WHERE id=$1',[sale]),'completed');
    assert.equal(await scalar('SELECT payment_method FROM sales WHERE id=$1',[sale]),method==='transfer'?'transfer':'mercadopago');
    assert.deepEqual((await db.query("SELECT account_id,amount FROM cash_movements WHERE sale_id=$1 AND movement_type='sale_income'",[sale])).rows,[{account_id:'mercadopago',amount:'100.00'}]);
    const posting=await scalar('SELECT id FROM financial_pending_postings WHERE sale_id=$1',[sale]);
    assert.equal(await scalar("SELECT count(*)::int FROM financial_pending_postings WHERE order_id=$1 AND status='pending'",[id]),0);
    assert.equal(await scalar('SELECT count(*)::int FROM financial_pending_postings WHERE order_id=$1',[id]),1);
    assert.equal(await scalar('SELECT post_financial_pending($1)',[posting]),'posted');
    assert.equal(await scalar('SELECT count(*)::int FROM financial_pending_postings WHERE sale_id=$1',[sale]),1);
    await assert.rejects(db.query("INSERT INTO cash_movements(movement_type,amount,sale_id,account_id,period_id) SELECT movement_type,amount,sale_id,account_id,period_id FROM cash_movements WHERE sale_id=$1",[sale]),/unique/);
    await assert.rejects(db.query("INSERT INTO financial_pending_postings(operation_type,sale_id,account_id,amount,currency,reason,reference_key) VALUES('sale_income',$1::uuid,'mercadopago',100,'ARS','finance_not_ready','sale:'||$1::text)",[sale]),/unique/);
  }
});
test('existing orders remain payable with finance off; recovery and posting retries are safe',async()=>{
  for(const method of ['transfer','mercadopago']) {
    const f=await fixture(),key=randomUUID(),id=await order(f,method,key);
    await off(); assert.equal(await order(f,method,key),id);
    const sale=await pay(id,method); assert.ok(sale); assert.equal(await pay(id,method),sale);
    assert.equal(await scalar('SELECT status FROM sales WHERE id=$1',[sale]),'completed');
    assert.equal(await scalar('SELECT status FROM payment_transactions WHERE order_id=$1',[id]),'approved');
    assert.equal(await scalar('SELECT count(*)::int FROM financial_pending_postings WHERE order_id=$1',[id]),1);
    const posting=await scalar('SELECT id FROM financial_pending_postings WHERE sale_id=$1',[sale]);
    assert.equal(await scalar('SELECT post_financial_pending($1)',[posting]),'pending');
    assert.equal(await scalar('SELECT count(*)::int FROM cash_movements WHERE sale_id=$1',[sale]),0);
    await on(); assert.equal(await scalar('SELECT post_financial_pending($1)',[posting]),'posted');
    assert.equal(await scalar('SELECT post_financial_pending($1)',[posting]),'posted');
    assert.equal(await scalar('SELECT count(*)::int FROM cash_movements WHERE sale_id=$1',[sale]),1);
  }
});
test('received external payment without sale has durable pending and no invented income',async()=>{
  const f=await fixture(),id=await order(f,'mercadopago');
  await db.query("UPDATE inventory_reservations SET expires_at=clock_timestamp()-interval '1 second' WHERE order_id=$1",[id]);
  assert.equal(await pay(id,'mercadopago'),null); assert.equal(await pay(id,'mercadopago'),null);
  assert.deepEqual((await db.query('SELECT status,reason,sale_id FROM financial_pending_postings WHERE order_id=$1',[id])).rows,[{status:'pending',reason:'payment_without_sale',sale_id:null}]);
  assert.equal(await scalar('SELECT status FROM payment_transactions WHERE order_id=$1',[id]),'approved');
});
test('posting failure preserves payment and sale; missing period queues then posts in current period',async()=>{
  const f=await fixture(),id=await order(f);
  await db.exec("CREATE FUNCTION fail_income() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.movement_type='sale_income' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_income BEFORE INSERT ON cash_movements FOR EACH ROW EXECUTE FUNCTION fail_income()");
  const sale=await pay(id); assert.ok(sale);
  assert.equal(await scalar('SELECT reason FROM financial_pending_postings WHERE sale_id=$1',[sale]),'posting_failed');
  await db.exec('DROP TRIGGER fail_income ON cash_movements; DROP FUNCTION fail_income()');
  const posting=await scalar('SELECT id FROM financial_pending_postings WHERE sale_id=$1',[sale]);
  await db.exec("UPDATE financial_periods SET status='closed',ends_at=clock_timestamp(),closed_at=clock_timestamp() WHERE status='open'");
  assert.equal(await scalar('SELECT post_financial_pending($1)',[posting]),'pending');
  const period=await scalar("INSERT INTO financial_periods(name) VALUES('Next') RETURNING id");
  assert.equal(await scalar('SELECT post_financial_pending($1)',[posting]),'posted');
  assert.equal(await scalar('SELECT period_id FROM cash_movements WHERE sale_id=$1',[sale]),period);
});
test('metadata updates cannot backfill legacy sales and untrusted roles cannot post',async()=>{
  await db.exec('ALTER TABLE sales DISABLE TRIGGER record_cash_sale_income_after_total');
  const f=await fixture();
  const id=await scalar("INSERT INTO sales(customer_id,total,subtotal,payment_method) VALUES($1,100,100,'cash') RETURNING id",[f.customer]);
  await db.exec('ALTER TABLE sales ENABLE TRIGGER record_cash_sale_income_after_total');
  for(const update of ["notes='metadata only'",'archived_at=clock_timestamp()','archived_at=NULL',"created_at=created_at-interval '1 day'"]) {
    await db.query(`UPDATE sales SET ${update} WHERE id=$1`,[id]);
    assert.equal(await scalar('SELECT count(*)::int FROM financial_pending_postings WHERE sale_id=$1',[id]),0);
    assert.equal(await scalar('SELECT count(*)::int FROM cash_movements WHERE sale_id=$1',[id]),0);
  }
  for(const role of ['anon','authenticated']) {
    assert.equal(await scalar("SELECT has_function_privilege($1,'public.post_financial_pending(uuid)','execute')",[role]),false);
    assert.equal(await scalar("SELECT has_table_privilege($1,'public.financial_pending_postings','select')",[role]),false);
  }
});

test('payment without sale reuses the same posting after real commercial resolution',async()=>{
  for(const financeOff of [false,true]) {
    const f=await fixture(),id=await order(f,'mercadopago');
    await db.query("UPDATE inventory_reservations SET expires_at=clock_timestamp()-interval '1 second' WHERE order_id=$1",[id]);
    assert.equal(await pay(id,'mercadopago'),null);
    const payment=await scalar('SELECT id FROM payment_transactions WHERE order_id=$1',[id]);
    const original=(await db.query('SELECT * FROM financial_pending_postings WHERE order_id=$1',[id])).rows;
    assert.equal(original.length,1);
    assert.equal(original[0].reference_key,`payment:${payment}`);
    assert.equal(original[0].operation_type,'payment_received');
    assert.equal(original[0].reason,'payment_without_sale');
    assert.equal(original[0].sale_id,null);
    assert.equal(await scalar('SELECT status FROM payment_transactions WHERE id=$1',[payment]),'approved');
    if(financeOff) await off();
    const key=randomUUID();
    const resolve=()=>scalar("SELECT resolve_order($1,'COMPLETE_STOCK_UNAVAILABLE',NULL,'Local A1 validation',$2)",[id,key]);
    await resolve(); await resolve();
    const sale=await scalar('SELECT sale_id FROM payment_transactions WHERE id=$1',[payment]);
    assert.ok(sale);
    assert.equal(await scalar('SELECT status FROM sales WHERE id=$1',[sale]),'completed');
    assert.equal(await scalar('SELECT stock FROM products WHERE id=$1',[f.product]),9);
    const rows=(await db.query('SELECT id,sale_id,operation_type,status FROM financial_pending_postings WHERE order_id=$1 OR sale_id=$2',[id,sale])).rows;
    assert.deepEqual(rows,[{id:original[0].id,sale_id:sale,operation_type:'sale_income',status:financeOff?'pending':'posted'}]);
    if(financeOff) {
      assert.equal(await scalar('SELECT count(*)::int FROM cash_movements WHERE sale_id=$1',[sale]),0);
      await on();
    }
    for(let retry=0;retry<3;retry++) assert.equal(await scalar('SELECT post_financial_pending($1)',[original[0].id]),'posted');
    assert.equal(await pay(id,'mercadopago'),sale);
    assert.deepEqual((await db.query("SELECT account_id,amount FROM cash_movements WHERE sale_id=$1 AND movement_type='sale_income'",[sale])).rows,[{account_id:'mercadopago',amount:'100.00'}]);
    assert.equal(await scalar('SELECT count(*)::int FROM financial_pending_postings WHERE order_id=$1 OR sale_id=$2',[id,sale]),1);
    assert.equal(await scalar("SELECT count(*)::int FROM financial_pending_postings WHERE (order_id=$1 OR sale_id=$2) AND status='pending'",[id,sale]),0);
  }
});

test('financial posting table RLS and all function grants are least privilege',async()=>{
  assert.equal(await scalar("SELECT relrowsecurity FROM pg_class WHERE oid='public.financial_pending_postings'::regclass"),true);
  for(const role of ['anon','authenticated','service_role']) {
    for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) {
      assert.equal(await scalar('SELECT has_table_privilege($1,$2,$3)',[role,'public.financial_pending_postings',privilege]),role==='service_role'&&['SELECT','INSERT','UPDATE'].includes(privilege),`${role} ${privilege}`);
    }
    for(const fn of ['financial_ready_period()','financial_income_account(text)','guard_sale_income_period()','post_financial_pending(uuid)','capture_financial_posting(uuid,uuid)','record_cash_sale_income()','record_approved_payment_finance()']) {
      assert.equal(await scalar('SELECT has_function_privilege($1,$2,$3)',[role,`public.${fn}`,'EXECUTE']),role==='service_role',`${role} ${fn}`);
      assert.equal(await scalar("SELECT count(*)::int FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=$1::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'",[`public.${fn}`]),0);
    }
  }
  for(const role of ['anon','authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    try {
      await assert.rejects(db.query('SELECT * FROM public.financial_pending_postings'),/permission denied/);
      await assert.rejects(db.query('SELECT public.post_financial_pending($1)',[randomUUID()]),/permission denied/);
    } finally { await db.exec('RESET ROLE'); }
  }
});
test('missing account and absent open period never roll back an existing verified payment',async()=>{
  for(const anomaly of ['account','period']) {
    const f=await fixture(),id=await order(f,'mercadopago');
    if(anomaly==='account') await db.exec("UPDATE financial_accounts SET active=false WHERE id='cash'");
    else await db.exec("UPDATE financial_periods SET status='closed',ends_at=clock_timestamp(),closed_at=clock_timestamp() WHERE status='open'");
    const sale=await pay(id,'mercadopago'); assert.ok(sale);
    assert.equal(await scalar('SELECT status FROM payment_transactions WHERE order_id=$1',[id]),'approved');
    assert.equal(await scalar('SELECT reason FROM financial_pending_postings WHERE sale_id=$1',[sale]),'finance_not_ready');
    assert.equal(await scalar('SELECT count(*)::int FROM cash_movements WHERE sale_id=$1',[sale]),0);
    if(anomaly==='account') await db.exec("UPDATE financial_accounts SET active=true WHERE id='cash'");
    else await db.exec("INSERT INTO financial_periods(name) VALUES('Current')");
    const posting=await scalar('SELECT id FROM financial_pending_postings WHERE sale_id=$1',[sale]);
    const closed=await scalar("SELECT id FROM financial_periods WHERE status='closed' LIMIT 1");
    await assert.rejects(db.query("INSERT INTO cash_movements(movement_type,amount,sale_id,account_id,period_id) VALUES('sale_income',100,$1,'mercadopago',$2)",[sale,closed]),/FINANCIAL_CURRENT_PERIOD_REQUIRED/);
    assert.equal(await scalar('SELECT post_financial_pending($1)',[posting]),'posted');
  }
});
