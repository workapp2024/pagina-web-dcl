/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const migration = '20260913010000_order_operations.sql';
let db, legacy, beforeMigration, protectedFunctions;
const backfillCases = [
  { name: 'cancelled without payment or sale', status: 'cancelled', expected: 'cancelled' },
  { name: 'rejected without payment or sale', status: 'rejected', expected: 'cancelled' },
  { name: 'completed never implies delivered', status: 'completed', expected: 'received' },
  ...['cancelled', 'rejected'].flatMap(status => [
    { name: `${status} with approved payment`, status, payment: 'approved', expected: 'received' },
    { name: `${status} with active sale but no approved payment`, status, sale: true, expected: 'received' },
  ]),
  ...['pending_payment', 'pending_manual_verification', 'stock_unavailable', 'paid'].map(status => (
    { name: `${status} stays received`, status, expected: 'received' }
  )),
];
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
async function create(method = 'transfer', name = randomUUID()) {
  const product = randomUUID();
  await db.query('INSERT INTO products(id,name,slug,price,stock) VALUES($1,$1,$1,100,20)', [product]);
  const id = await scalar("SELECT create_public_order($1,$1,'','delivery','Test address','',$2,$3::jsonb,$4)",
    [name, method, JSON.stringify([{ productId: product, quantity: 2 }]), randomUUID()]);
  return { id, product };
}
async function pay(id, method = 'transfer') {
  if (method === 'transfer') {
    await scalar('SELECT declare_manual_transfer($1)', [id]);
    return scalar('SELECT complete_manual_transfer($1)', [id]);
  }
  await db.query("UPDATE payment_transactions SET external_order_id='test-'||order_id WHERE order_id=$1", [id]);
  return scalar("SELECT complete_mercadopago_order($1::uuid,'test-'||$1::text,'payment-'||$1::text,200,'ARS','processed')", [id]);
}
const change = (id, expected, status, note = '') => scalar('SELECT set_order_operational_status($1,$2,$3,$4)', [id, expected, status, note]);
const history = id => db.query('SELECT previous_status,new_status,source,actor,note FROM order_operational_history WHERE order_id=$1 ORDER BY id', [id]);
async function financialSnapshot() {
  const result = {};
  for (const table of ['products','payment_transactions','inventory_reservations','inventory_movements','sales','sale_items','cash_movements']) {
    result[table] = (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
  }
  result.orderLegacy = (await db.query("SELECT to_jsonb(o)-'operational_status'-'updated_at' AS record FROM orders o ORDER BY id")).rows;
  return result;
}
const definitions = () => db.query("SELECT proname,pg_get_functiondef(oid) AS definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('create_public_order','complete_manual_transfer','complete_mercadopago_order','cancel_public_order','cancel_sale_with_reversal','apply_inventory_movement','guard_product_reserved_stock','get_order_payment_window','create_sale_with_inventory','list_admin_orders','record_cash_sale_income') ORDER BY proname");

before(async () => {
  // PostgreSQL WASM in memory only. No environment, credentials or remote URL.
  db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;');
  for (const file of fs.readdirSync('supabase/migrations').filter(f => /^\d{14}_/.test(f) && !f.includes('storage_setup') && f < migration).sort()) {
    await db.exec(fs.readFileSync(path.join('supabase/migrations', file), 'utf8'));
  }
  await db.exec("INSERT INTO site_settings(id,transfer_alias,transfer_holder,transfer_institution) VALUES(1,'test.alias','Test','Test') ON CONFLICT(id) DO UPDATE SET transfer_alias='test.alias',transfer_holder='Test',transfer_institution='Test'");
  const paid = await create(); await pay(paid.id);
  const pending = await create();
  const cancelled = await create(); await scalar('SELECT cancel_public_order($1)', [cancelled.id]);
  legacy = [{ ...paid, expected: 'received' }, { ...pending, expected: 'received' }, { ...cancelled, expected: 'cancelled' }];
  // Preparar contradicciones sólo en la base efímera, antes de aplicar el backfill.
  for (const fixture of backfillCases) {
    const order = await create();
    fixture.id = order.id;
    if (fixture.sale) {
      await pay(order.id);
      await db.query("UPDATE payment_transactions SET status='rejected' WHERE order_id=$1", [order.id]);
    } else if (fixture.payment) {
      await db.query('UPDATE payment_transactions SET status=$2 WHERE order_id=$1', [order.id, fixture.payment]);
    } else {
      await db.query('DELETE FROM payment_transactions WHERE order_id=$1', [order.id]);
    }
    await db.query('UPDATE orders SET status=$2 WHERE id=$1', [order.id, fixture.status]);
    legacy.push({ ...order, expected: fixture.expected });
  }
  beforeMigration = (await db.query('SELECT to_jsonb(o) AS original FROM orders o ORDER BY id')).rows.map(row => row.original);
  const effectsBefore = await financialSnapshot();
  protectedFunctions = (await definitions()).rows;
  await db.exec(fs.readFileSync(path.join('supabase/migrations', migration), 'utf8'));
  const effectsAfter = await financialSnapshot();
  delete effectsAfter.orderLegacy; delete effectsBefore.orderLegacy;
  assert.deepEqual(effectsAfter, effectsBefore);
});
after(async () => { await db?.close(); });

test('migration preserves legacy UUIDs and every old order field; completed never implies delivered', async () => {
  const afterRows = (await db.query("SELECT to_jsonb(o)-'order_number'-'operational_status' AS original FROM orders o ORDER BY id")).rows.map(row => row.original);
  assert.deepEqual(afterRows, beforeMigration);
  for (const { id, expected } of legacy) {
    assert.equal(await scalar('SELECT operational_status FROM orders WHERE id=$1', [id]), expected);
    const entries = (await history(id)).rows;
    assert.equal(entries.length, 1); assert.equal(entries[0].source, 'migration');
    assert.equal(entries[0].previous_status, null);
    assert.equal(entries[0].new_status, expected);
  }
  assert.deepEqual((await definitions()).rows, protectedFunctions);
});

for (const fixture of backfillCases) test(`historical backfill: ${fixture.name}`, async () => {
  assert.equal(await scalar('SELECT operational_status FROM orders WHERE id=$1', [fixture.id]), fixture.expected);
  assert.equal((await history(fixture.id)).rows[0].new_status, fixture.expected);
});

test('new orders receive unique stable commercial numbers; simultaneous submissions use the sequence', async () => {
  // PGlite serializes execution: this checks submitted requests, not independent PG sessions.
  const orders = await Promise.all(Array.from({ length: 12 }, () => create()));
  const rows = (await db.query('SELECT order_number FROM orders')).rows;
  assert.equal(new Set(rows.map(r => r.order_number)).size, rows.length);
  for (const row of rows) assert.match(row.order_number, /^DCL-\d{6,}$/);
  const id = orders[0].id;
  await assert.rejects(db.query("UPDATE orders SET order_number='DCL-999999' WHERE id=$1", [id]), /ORDER_NUMBER_IMMUTABLE/);
  const number = await scalar('SELECT order_number FROM orders WHERE id=$1', [id]);
  await assert.rejects(db.query('INSERT INTO orders(customer_id,idempotency_key,fulfillment_method,payment_method,order_number) SELECT customer_id,$2,fulfillment_method,payment_method,$3 FROM orders WHERE id=$1', [id, randomUUID(), number]), /orders_order_number_unique/);
  assert.equal(await scalar('SELECT operational_status FROM orders WHERE id=$1', [id]), 'received');
  assert.equal((await history(id)).rows[0].source, 'order_creation');
});

test('number formatting grows beyond six digits and does not truncate', async () => {
  await db.exec("SELECT setval('order_commercial_number_seq',999999)");
  const { id } = await create();
  assert.equal(await scalar('SELECT order_number FROM orders WHERE id=$1', [id]), 'DCL-1000000');
});

test('transfer and MP approval keep received, including duplicate confirmations', async () => {
  for (const method of ['transfer', 'mercadopago', 'card']) {
    const { id } = await create(method);
    const sale = await pay(id, method); assert.ok(sale);
    assert.equal(await pay(id, method), sale);
    assert.equal(await scalar('SELECT operational_status FROM orders WHERE id=$1', [id]), 'received');
    assert.equal((await history(id)).rows.length, 1);
  }
});

test('all allowed advances preserve stock/payment/reservations/sales/finance and append actor/note', async () => {
  const { id } = await create(); await pay(id);
  const snapshot = await financialSnapshot();
  for (const [from, to] of [['received','preparing'],['preparing','ready'],['ready','delivered']]) {
    assert.equal(await change(id, from, to, 'Operación probada'), to);
    assert.equal(await change(id, from, to, 'Reintento'), to);
  }
  assert.deepEqual(await financialSnapshot(), snapshot);
  const rows = (await history(id)).rows;
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(r => r.new_status), ['received','preparing','ready','delivered']);
  assert.ok(rows.slice(1).every(r => r.source === 'admin' && r.actor === 'admin' && r.note === 'Operación probada'));
  await assert.rejects(change(id, 'delivered', 'ready'), /OPERATIONAL_INVALID_TRANSITION/);
});

test('invalid, stale, unpaid and direct bypass transitions are rejected without history changes', async () => {
  const { id } = await create();
  await assert.rejects(change(id, 'received', 'preparing'), /OPERATIONAL_PAYMENT_REQUIRED/);
  await assert.rejects(change(id, 'received', 'cancelled'), /OPERATIONAL_CLOSE_PAYMENT_FIRST/);
  await pay(id);
  await assert.rejects(change(id, 'received', 'delivered'), /OPERATIONAL_INVALID_TRANSITION/);
  await assert.rejects(db.query("UPDATE orders SET operational_status='delivered' WHERE id=$1", [id]), /OPERATIONAL_INVALID_TRANSITION/);
  await change(id, 'received', 'preparing');
  await assert.rejects(change(id, 'received', 'ready'), /OPERATIONAL_STALE_STATE/);
  assert.equal((await history(id)).rows.length, 2);
});

test('paid orders and approved-without-stock cannot be cancelled operationally', async () => {
  for (const late of [false, true]) {
    const { id } = await create('mercadopago');
    if (late) await db.query("UPDATE inventory_reservations SET expires_at=clock_timestamp()-interval '1 second' WHERE order_id=$1", [id]);
    await pay(id, 'mercadopago');
    const before = await financialSnapshot();
    await assert.rejects(change(id, 'received', 'cancelled'), /OPERATIONAL_FINANCIAL_REVERSAL_REQUIRED/);
    assert.deepEqual(await financialSnapshot(), before);
  }
});

test('operational cancellation only after existing cancellation, without additional effects', async () => {
  const { id } = await create();
  assert.equal(await scalar('SELECT cancel_public_order($1)', [id]), true);
  const before = await financialSnapshot();
  assert.equal(await change(id, 'received', 'cancelled', 'Cliente desistió'), 'cancelled');
  assert.equal(await change(id, 'received', 'cancelled'), 'cancelled');
  assert.deepEqual(await financialSnapshot(), before);
  assert.equal((await history(id)).rows.length, 2);
  await assert.rejects(change(id, 'cancelled', 'received'), /OPERATIONAL_INVALID_TRANSITION/);
});

test('annulled associated sale cannot advance and refunded payment requires financial review', async () => {
  const { id } = await create(); const sale = await pay(id);
  await scalar("SELECT cancel_sale_with_reversal($1,'Test')", [sale]);
  await assert.rejects(change(id, 'received', 'preparing'), /OPERATIONAL_PAYMENT_REQUIRED/);
  await assert.rejects(change(id, 'received', 'cancelled'), /OPERATIONAL_FINANCIAL_REVERSAL_REQUIRED/);
  await db.query("UPDATE payment_transactions SET status='refunded' WHERE order_id=$1", [id]);
  await assert.rejects(change(id, 'received', 'cancelled'), /OPERATIONAL_FINANCIAL_REVERSAL_REQUIRED/);
});

test('search by commercial number, UUID, customer, phone and product respects operational filters', async () => {
  const { id, product } = await create('transfer', 'Operational-search-customer');
  await db.query("UPDATE customers SET phone='555-OP-TEST' WHERE id=(SELECT customer_id FROM orders WHERE id=$1)", [id]);
  const number = await scalar('SELECT order_number FROM orders WHERE id=$1', [id]);
  for (const q of [number.toLowerCase(), id, 'Operational-search-customer', '555-OP-TEST', product]) {
    const result = await scalar("SELECT list_admin_operational_orders($1,'all',NULL,1,50,'received')", [q]);
    assert.equal(result.pagination.total, 1); assert.equal(result.data[0].id, id);
    assert.equal(result.data[0].operationalHistory.length, 1);
    assert.equal((await scalar("SELECT list_admin_operational_orders($1,'all',NULL,1,50,'delivered')", [q])).pagination.total, 0);
  }
  await pay(id);
  assert.equal((await scalar("SELECT list_admin_operational_orders($1,'delivery',NULL,1,50)", [number])).pagination.total, 1);
  await change(id, 'received', 'preparing'); await change(id, 'preparing', 'ready'); await change(id, 'ready', 'delivered');
  assert.equal((await scalar("SELECT list_admin_operational_orders($1,'delivery',NULL,1,50)", [number])).pagination.total, 0);
});

test('service role can use new RPCs but cannot rewrite/delete history; public cannot invoke them', async () => {
  for (const role of ['anon','authenticated']) {
    assert.equal(await scalar("SELECT has_function_privilege($1,'set_order_operational_status(uuid,text,text,text)','EXECUTE')", [role]), false);
    assert.equal(await scalar("SELECT has_table_privilege($1,'order_operational_history','SELECT')", [role]), false);
  }
  const { id } = await create();
  await db.exec('SET ROLE service_role');
  try {
    await pay(id);
    await change(id, 'received', 'preparing');
    assert.equal((await scalar("SELECT list_admin_operational_orders($1,'all',NULL,1,50)", [id])).data[0].operational_status, 'preparing');
    for (const sql of ['DELETE FROM order_operational_history', "UPDATE order_operational_history SET note='x'", "INSERT INTO order_operational_history(order_id,new_status,source,actor) VALUES($1,'ready','fake','fake')"]) {
      await assert.rejects(db.query(sql, sql.includes('$1') ? [id] : []), /permission denied/);
    }
    const fresh = await create(); assert.equal((await history(fresh.id)).rows.length, 1);
  } finally { await db.exec('RESET ROLE'); }
});

test('transaction rollback preserves reference and rolls back operational history with the state', async () => {
  const { id } = await create(); await pay(id);
  const reference = await scalar('SELECT order_number FROM orders WHERE id=$1', [id]);
  await db.exec('BEGIN'); await change(id, 'received', 'preparing'); await db.exec('ROLLBACK');
  assert.equal(await scalar('SELECT operational_status FROM orders WHERE id=$1', [id]), 'received');
  assert.equal(await scalar('SELECT order_number FROM orders WHERE id=$1', [id]), reference);
  assert.equal((await history(id)).rows.length, 1);
});
