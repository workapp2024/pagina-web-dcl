/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const migration = '20260913020000_order_archiving.sql';
let db, priorRows, priorHistory, priorEffects, priorFunctions;
const scalar = async (sql, args = []) => Object.values((await db.query(sql,args)).rows[0])[0];
const archive = (id, value = true) => scalar('SELECT set_order_archived($1,$2)', [id,value]);
const list = (q = '', archived = false, status = 'all', operational = 'all', page = 1, limit = 50) => scalar('SELECT list_admin_operational_orders($1,$2,NULL,$3,$4,$5,$6)', [q,status,page,limit,operational,archived]);
const change = (id, from, to) => scalar('SELECT set_order_operational_status($1,$2,$3)', [id,from,to]);
async function create(target = 'received', name = randomUUID()) {
  const product = randomUUID();
  await db.query('INSERT INTO products(id,name,slug,price,stock) VALUES($1,$1,$1,100,10)', [product]);
  const id = await scalar("SELECT create_public_order($1,$1,'','delivery','Test address','','transfer',$2::jsonb,$3)", [name,JSON.stringify([{productId:product,quantity:1}]),randomUUID()]);
  if (target === 'cancelled') {
    await scalar('SELECT cancel_public_order($1)',[id]); await change(id,'received','cancelled');
  } else if (target !== 'received') {
    await scalar('SELECT declare_manual_transfer($1)',[id]); await scalar('SELECT complete_manual_transfer($1)',[id]);
    for (const [from,to] of [['received','preparing'],['preparing','ready'],['ready','delivered']]) {
      await change(id,from,to); if (to === target) break;
    }
  }
  return { id, product };
}
async function effects() {
  const snapshot = {};
  for (const table of ['payment_transactions','sales','sale_items','products','inventory_reservations','inventory_movements','order_items','cash_movements']) snapshot[table] = (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
  return snapshot;
}
const functions = () => db.query("SELECT proname,pg_get_functiondef(oid) AS definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('create_public_order','complete_manual_transfer','complete_mercadopago_order','cancel_public_order','cancel_sale_with_reversal','apply_inventory_movement','guard_product_reserved_stock','set_order_operational_status','record_order_operation') ORDER BY proname");

before(async () => {
  db = new PGlite(); // Memoria solamente: no .env, credenciales, red ni datos reales.
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;');
  for (const file of fs.readdirSync('supabase/migrations').filter(f => /^\d{14}_/.test(f) && !f.includes('storage_setup') && f < migration).sort()) await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  await db.exec("INSERT INTO site_settings(id,transfer_alias,transfer_holder,transfer_institution) VALUES(1,'test.alias','Test','Test') ON CONFLICT(id) DO UPDATE SET transfer_alias='test.alias',transfer_holder='Test',transfer_institution='Test'");
  await create('delivered'); await create('cancelled'); await create();
  priorRows = (await db.query('SELECT to_jsonb(o) AS row FROM orders o ORDER BY id')).rows;
  priorHistory = (await db.query('SELECT to_jsonb(h) AS row FROM order_operational_history h ORDER BY id')).rows;
  priorEffects = await effects(); priorFunctions = (await functions()).rows;
  await db.exec(fs.readFileSync('supabase/migrations/'+migration,'utf8'));
});
after(async () => { await db?.close(); });

test('additive archive migration preserves all existing records and functions; all start active', async () => {
  assert.deepEqual((await db.query("SELECT to_jsonb(o)-'archived_at' AS row FROM orders o ORDER BY id")).rows, priorRows);
  assert.deepEqual((await db.query("SELECT to_jsonb(h)-'action' AS row FROM order_operational_history h ORDER BY id")).rows, priorHistory);
  assert.equal(await scalar('SELECT count(*)::int FROM orders WHERE archived_at IS NOT NULL'),0);
  assert.deepEqual(await effects(),priorEffects); assert.deepEqual((await functions()).rows,priorFunctions);
});

for (const status of ['delivered','cancelled']) test(`${status} archives/restores without deleting or changing payment, sale, stock, reservations or references`, async () => {
  const { id } = await create(status);
  const before = await effects();
  const original = await scalar("SELECT to_jsonb(o)-'archived_at'-'updated_at' FROM orders o WHERE id=$1",[id]);
  const historyBefore = (await db.query('SELECT * FROM order_operational_history WHERE order_id=$1 ORDER BY id',[id])).rows;
  assert.equal(await archive(id),true);
  const archivedAt = await scalar('SELECT archived_at FROM orders WHERE id=$1',[id]); assert.ok(archivedAt);
  assert.equal(await archive(id),true); // Doble clic no cambia fecha ni duplica historial.
  assert.deepEqual(await scalar('SELECT archived_at FROM orders WHERE id=$1',[id]),archivedAt);
  assert.equal((await list(id)).pagination.total,0);
  assert.equal((await list(id,true)).pagination.total,1);
  assert.equal((await scalar("SELECT list_admin_operational_orders($1,'all',NULL,1,50,'all')",[id])).pagination.total,0);
  assert.equal(await archive(id,false),false); assert.equal(await archive(id,false),false);
  assert.equal((await list(id)).pagination.total,1); assert.equal((await list(id,true)).pagination.total,0);
  assert.equal(await scalar('SELECT archived_at FROM orders WHERE id=$1',[id]),null);
  assert.deepEqual(await effects(),before);
  assert.deepEqual(await scalar("SELECT to_jsonb(o)-'archived_at'-'updated_at' FROM orders o WHERE id=$1",[id]),original);
  const historyAfter = (await db.query('SELECT * FROM order_operational_history WHERE order_id=$1 ORDER BY id',[id])).rows;
  assert.deepEqual(historyAfter.slice(0,historyBefore.length),historyBefore);
  assert.deepEqual(historyAfter.slice(historyBefore.length).map(h=>h.action),['archive','restore']);
  assert.ok(historyAfter.slice(historyBefore.length).every(h=>h.actor==='admin' && h.source==='admin' && h.previous_status===status && h.new_status===status));
});

for (const status of ['received','preparing','ready']) test(`${status} cannot be archived, including a direct UPDATE bypass attempt`, async () => {
  const { id } = await create(status); const before = await effects();
  await assert.rejects(archive(id),/ARCHIVE_NOT_ALLOWED: ORDER_NOT_TERMINAL/);
  await assert.rejects(db.query('UPDATE orders SET archived_at=clock_timestamp() WHERE id=$1',[id]),/ARCHIVE_NOT_ALLOWED/);
  assert.equal(await scalar('SELECT archived_at FROM orders WHERE id=$1',[id]),null);
  assert.equal(await scalar("SELECT count(*)::int FROM order_operational_history WHERE order_id=$1 AND action='archive'",[id]),0);
  assert.deepEqual(await effects(),before);
});

for (const paymentStatus of ['pending','error','refunded','rejected']) test(`delivered with ${paymentStatus} payment cannot hide a financial incident`, async () => {
  const { id } = await create('delivered');
  await db.query('UPDATE payment_transactions SET status=$2 WHERE order_id=$1',[id,paymentStatus]);
  await assert.rejects(archive(id),/ARCHIVE_NOT_ALLOWED/);
});

test('stock unavailable, pending manual verification, annulled sale, active reservation and amount mismatch are blocked', async () => {
  for (const technical of ['stock_unavailable','pending_manual_verification','pending_payment']) {
    const { id } = await create('delivered');
    await db.query('UPDATE orders SET status=$2 WHERE id=$1',[id,technical]);
    await assert.rejects(archive(id),/ORDER_REQUIRES_ATTENTION/);
  }
  const annulled = await create('delivered');
  const sale = await scalar('SELECT sale_id FROM payment_transactions WHERE order_id=$1',[annulled.id]);
  await scalar("SELECT cancel_sale_with_reversal($1,'Test')",[sale]);
  await assert.rejects(archive(annulled.id),/DELIVERY_FINANCIAL_MISMATCH/);
  const reserved = await create('cancelled');
  await db.query("UPDATE inventory_reservations SET status='active',expires_at=clock_timestamp()+interval '1 hour' WHERE order_id=$1",[reserved.id]);
  await assert.rejects(archive(reserved.id),/RESERVATION_ACTIVE/);
  const mismatch = await create('delivered');
  await db.query('UPDATE payment_transactions SET amount=1 WHERE order_id=$1',[mismatch.id]);
  await assert.rejects(archive(mismatch.id),/PAYMENT_MISMATCH/);
});

test('cancelled with approved payment, missing payment or multiple payments fails closed', async () => {
  const paid = await create('cancelled');
  await db.query("UPDATE payment_transactions SET status='approved' WHERE order_id=$1",[paid.id]);
  await assert.rejects(archive(paid.id),/CANCELLATION_FINANCIAL_MISMATCH/);
  const missing = await create('cancelled');
  await db.query('DELETE FROM payment_transactions WHERE order_id=$1',[missing.id]);
  await assert.rejects(archive(missing.id),/PAYMENT_AMBIGUOUS/);
  const multiple = await create('cancelled');
  await db.query("INSERT INTO payment_transactions(order_id,provider,status,amount,currency,external_idempotency_key) VALUES($1,'transfer','cancelled',100,'ARS',$2)",[multiple.id,randomUUID()]);
  await assert.rejects(archive(multiple.id),/PAYMENT_AMBIGUOUS/);
});

test('search and every normal filter/count exclude archived; archived pagination is isolated', async () => {
  const { id, product } = await create('delivered','Archive-search-client');
  await db.query("UPDATE customers SET phone='Archive-search-phone' WHERE id=(SELECT customer_id FROM orders WHERE id=$1)",[id]);
  const number = await scalar('SELECT order_number FROM orders WHERE id=$1',[id]);
  await archive(id);
  for (const q of [number.toLowerCase(),id,'Archive-search-client','Archive-search-phone',product]) {
    assert.equal((await list(q)).pagination.total,0);
    const found = await list(q,true); assert.equal(found.pagination.total,1); assert.equal(found.data[0].id,id);
    assert.equal(found.data[0].operationalHistory[0].action,'archive');
  }
  for (const status of ['all','attention','pending','transfer','paid','delivery','completed','cancelled']) assert.equal((await list(id,false,status)).pagination.total,0);
  for (const operational of ['all','received','preparing','ready','delivered','cancelled']) assert.equal((await list(id,false,'all',operational)).pagination.total,0);
  const other = await create('cancelled','Archive-page'); await archive(other.id);
  const first = await list('',true,'all','all',1,1), second = await list('',true,'all','all',2,1);
  assert.equal(first.pagination.total,second.pagination.total); assert.ok(first.pagination.total>=2);
  assert.notEqual(first.data[0].id,second.data[0].id);
});

test('restoration remains available even if a financial incident appeared after archiving', async () => {
  const { id } = await create('delivered'); await archive(id);
  await db.query("UPDATE payment_transactions SET status='error' WHERE order_id=$1",[id]);
  const before = await effects();
  await archive(id,false);
  assert.deepEqual(await effects(),before); assert.equal((await list(id)).pagination.total,1);
});

test('service role can archive/restore, cannot edit history; public RPCs are forbidden', async () => {
  const { id } = await create('cancelled');
  for (const role of ['anon','authenticated']) assert.equal(await scalar("SELECT has_function_privilege($1,'set_order_archived(uuid,boolean)','EXECUTE')",[role]),false);
  await db.exec('SET ROLE service_role');
  try {
    await archive(id); assert.equal((await list(id,true)).pagination.total,1); await archive(id,false);
    await assert.rejects(db.query("UPDATE order_operational_history SET action='restore' WHERE order_id=$1",[id]),/permission denied/);
    await assert.rejects(db.query('DELETE FROM order_operational_history WHERE order_id=$1',[id]),/permission denied/);
  } finally { await db.exec('RESET ROLE'); }
});

test('archive and its history roll back together; new orders are never archived', async () => {
  const { id } = await create('cancelled');
  await db.exec('BEGIN'); await archive(id); await db.exec('ROLLBACK');
  assert.equal(await scalar('SELECT archived_at FROM orders WHERE id=$1',[id]),null);
  assert.equal(await scalar("SELECT count(*)::int FROM order_operational_history WHERE order_id=$1 AND action='archive'",[id]),0);
  const fresh = await create(); assert.equal(await scalar('SELECT archived_at FROM orders WHERE id=$1',[fresh.id]),null);
});
