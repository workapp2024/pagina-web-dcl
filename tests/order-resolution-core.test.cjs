/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

const migration = '20260920020000_order_resolution_core.sql';
let db;
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const resolution = (order, type, reference = null, note = 'Motivo confirmado', key = randomUUID()) =>
  scalar('SELECT resolve_order($1,$2,$3,$4,$5)', [order, type, reference, note, key]);
const state = order => db.query(`SELECT o.status,o.operational_status,t.status AS payment_status,t.sale_id,s.status AS sale_status
  FROM orders o JOIN payment_transactions t ON t.order_id=o.id LEFT JOIN sales s ON s.id=t.sale_id WHERE o.id=$1`, [order]);
const webhook = (order, status = 'processed') => scalar(
  "SELECT complete_mercadopago_order($1::uuid,'test-'||$1::text,'payment-'||$1::text,200,'ARS',$2)", [order, status]);
async function effects(fixture) {
  return {
    state: (await state(fixture.order)).rows[0],
    stock: await scalar('SELECT stock FROM products WHERE id=$1', [fixture.product]),
    reservations: (await db.query('SELECT status FROM inventory_reservations WHERE order_id=$1 ORDER BY id', [fixture.order])).rows,
    sales: await scalar('SELECT count(*)::int FROM sales WHERE customer_id=(SELECT customer_id FROM orders WHERE id=$1)', [fixture.order]),
    saleItems: await scalar('SELECT count(*)::int FROM sale_items WHERE sale_id=(SELECT sale_id FROM payment_transactions WHERE order_id=$1)', [fixture.order]),
    inventory: await scalar('SELECT count(*)::int FROM inventory_movements WHERE product_id=$1', [fixture.product]),
    cash: await scalar('SELECT count(*)::int FROM cash_movements WHERE sale_id=(SELECT sale_id FROM payment_transactions WHERE order_id=$1)', [fixture.order]),
  };
}
async function create(method = 'transfer', stock = 10) {
  const product = randomUUID();
  await db.query('INSERT INTO products(id,name,slug,price,stock) VALUES($1,$1,$1,100,$2)', [product, stock]);
  const order = await scalar("SELECT create_public_order($1,$1,'','pickup','','',$2,$3::jsonb,$4)",
    [randomUUID(), method, JSON.stringify([{ productId: product, quantity: 2 }]), randomUUID()]);
  return { order, product };
}
async function pay(fixture, method = 'transfer') {
  if (method === 'transfer') {
    await scalar('SELECT declare_manual_transfer($1)', [fixture.order]);
    return scalar('SELECT complete_manual_transfer($1)', [fixture.order]);
  }
  await db.query("UPDATE payment_transactions SET external_order_id='test-'||order_id WHERE order_id=$1", [fixture.order]);
  return scalar("SELECT complete_mercadopago_order($1::uuid,'test-'||$1::text,'payment-'||$1::text,200,'ARS','processed')", [fixture.order]);
}

before(async () => {
  db = new PGlite(); // In-memory PostgreSQL, without remote credentials.
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;');
  for (const file of fs.readdirSync('supabase/migrations').filter(name => /^\d{14}_/.test(name) && !name.includes('storage_setup') && name < migration).sort()) {
    await db.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
  }
  await db.exec("INSERT INTO site_settings(id,transfer_alias,transfer_holder,transfer_institution) VALUES(1,'test.alias','Test','Test') ON CONFLICT(id) DO UPDATE SET transfer_alias='test.alias',transfer_holder='Test',transfer_institution='Test'");
  await db.exec("INSERT INTO financial_periods(name,status) VALUES('Local test period','open')");
  await db.exec(fs.readFileSync('supabase/migrations/' + migration, 'utf8'));
});
after(async () => { await db?.close(); });

test('cancel pending releases reservation without physical stock effects and retries once', async () => {
  const fixture = await create(); const key = randomUUID();
  const beforeStock = await scalar('SELECT stock FROM products WHERE id=$1', [fixture.product]);
  const first = await resolution(fixture.order, 'CANCEL_PENDING', null, 'No se cobró', key);
  const again = await resolution(fixture.order, 'CANCEL_PENDING', null, 'No se cobró', key);
  assert.equal(first.id, again.id);
  assert.equal((await state(fixture.order)).rows[0].status, 'cancelled');
  assert.equal((await state(fixture.order)).rows[0].operational_status, 'cancelled');
  assert.equal(await scalar('SELECT stock FROM products WHERE id=$1', [fixture.product]), beforeStock);
  assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements WHERE product_id=$1', [fixture.product]), 0);
  assert.equal(await scalar("SELECT status FROM inventory_reservations WHERE order_id=$1", [fixture.order]), 'released');
  await assert.rejects(resolution(fixture.order, 'CANCEL_PENDING', null, 'Otro intento'), /ORDER_RESOLUTION_ALREADY_APPLIED/);
});

test('transfer refund and erroneous approval reverse stock once and keep payment semantics distinct', async () => {
  for (const [type, expected] of [['REFUND_VERIFIED', 'refunded'], ['TRANSFER_APPROVAL_ERROR', 'cancelled']]) {
    const fixture = await create(); const sale = await pay(fixture);
    await assert.rejects(scalar('SELECT cancel_sale_with_reversal($1,$2)', [sale, 'Fuera de flujo']), /ORDER_RESOLUTION_REQUIRED/);
    const key = randomUUID(); const reference = type === 'REFUND_VERIFIED' ? randomUUID() : null;
    const first = await resolution(fixture.order, type, reference, 'Revisión administrativa', key);
    assert.equal((await resolution(fixture.order, type, reference, 'Revisión administrativa', key)).id, first.id);
    const row = (await state(fixture.order)).rows[0];
    assert.equal(row.status, expected); assert.equal(row.payment_status, expected);
    assert.equal(row.sale_status, 'cancelled'); assert.equal(row.operational_status, 'cancelled');
    assert.equal(await scalar('SELECT stock FROM products WHERE id=$1', [fixture.product]), 10);
    assert.equal(await scalar("SELECT count(*)::int FROM inventory_movements WHERE reference_type='sale_reversal' AND reference_id=$1", [sale]), 1);
    assert.equal(await scalar("SELECT count(*)::int FROM cash_movements WHERE sale_id=$1 AND movement_type='sale_reversal'", [sale]), 0);
  }
});

test('Mercado Pago full refund reverses original financial entry in the same account and period', async () => {
  const fixture = await create('mercadopago'); const sale = await pay(fixture, 'mercadopago');
  const original = (await db.query("SELECT amount,account_id,period_id FROM cash_movements WHERE sale_id=$1 AND movement_type='sale_income'", [sale])).rows[0];
  assert.ok(original);
  const key = randomUUID();
  await resolution(fixture.order, 'REFUND_VERIFIED', randomUUID(), 'Reintegro confirmado', key);
  const reversed = (await db.query("SELECT amount,account_id,period_id FROM cash_movements WHERE sale_id=$1 AND movement_type='sale_reversal'", [sale])).rows;
  assert.equal(reversed.length, 1);
  assert.equal(Number(reversed[0].amount), -Number(original.amount));
  assert.equal(reversed[0].account_id, original.account_id);
  assert.equal(reversed[0].period_id, original.period_id);
  assert.equal(await scalar('SELECT stock FROM products WHERE id=$1', [fixture.product]), 10);
  assert.equal((await state(fixture.order)).rows[0].status, 'refunded');
  await assert.rejects(resolution(fixture.order, 'REFUND_VERIFIED', randomUUID()), /ORDER_RESOLUTION_ALREADY_APPLIED/);
});

test('independent cash sale reverses only its actual income in the original account and period', async () => {
  const fixture = await create();
  await resolution(fixture.order, 'CANCEL_PENDING', null, 'Pedido sin cobro');
  const customer = await scalar('SELECT customer_id FROM orders WHERE id=$1', [fixture.order]);
  const sale = await scalar("SELECT create_sale_with_inventory($1,NULL,'', $2::jsonb,FALSE,'cash')",
    [customer, JSON.stringify([{ productId: fixture.product, quantity: 2 }])]);
  const original = (await db.query("SELECT amount,account_id,period_id FROM cash_movements WHERE sale_id=$1 AND movement_type='sale_income'", [sale])).rows[0];
  assert.ok(original);
  await scalar('SELECT cancel_sale_with_reversal($1,$2)', [sale, 'Venta independiente anulada']);
  await scalar('SELECT cancel_sale_with_reversal($1,$2)', [sale, 'Reintento']);
  const reversed = (await db.query("SELECT amount,account_id,period_id FROM cash_movements WHERE sale_id=$1 AND movement_type='sale_reversal'", [sale])).rows;
  assert.equal(reversed.length, 1);
  assert.equal(Number(reversed[0].amount), -Number(original.amount));
  assert.equal(reversed[0].account_id, original.account_id);
  assert.equal(reversed[0].period_id, original.period_id);
  assert.equal(await scalar("SELECT count(*)::int FROM inventory_movements WHERE reference_type='sale_reversal' AND reference_id=$1", [sale]), 1);
  assert.equal(await scalar('SELECT stock FROM products WHERE id=$1', [fixture.product]), 10);
});

test('delivered orders cannot use the generic refund', async () => {
  const fixture = await create(); await pay(fixture);
  for (const [from, to] of [['received','preparing'],['preparing','ready'],['ready','delivered']]) {
    await scalar('SELECT set_order_operational_status($1,$2,$3)', [fixture.order, from, to]);
  }
  await assert.rejects(resolution(fixture.order, 'REFUND_VERIFIED', randomUUID()), /ORDER_RESOLUTION_DELIVERED/);
});

test('stock unavailable can complete once with current stock or refund without inventory effects', async () => {
  const pending = await create('mercadopago');
  await db.query("UPDATE inventory_reservations SET expires_at=clock_timestamp()-INTERVAL '1 minute' WHERE order_id=$1", [pending.order]);
  assert.equal(await pay(pending, 'mercadopago'), null);
  assert.equal((await state(pending.order)).rows[0].status, 'stock_unavailable');
  await db.query('UPDATE products SET stock=1 WHERE id=$1', [pending.product]);
  await assert.rejects(resolution(pending.order, 'COMPLETE_STOCK_UNAVAILABLE'), /ORDER_RESOLUTION_INSUFFICIENT_STOCK/);
  assert.equal((await state(pending.order)).rows[0].sale_id, null);
  await db.query('UPDATE products SET stock=10 WHERE id=$1', [pending.product]);
  const key = randomUUID();
  const first = await resolution(pending.order, 'COMPLETE_STOCK_UNAVAILABLE', null, 'Stock repuesto', key);
  assert.equal((await resolution(pending.order, 'COMPLETE_STOCK_UNAVAILABLE', null, 'Stock repuesto', key)).id, first.id);
  assert.equal((await state(pending.order)).rows[0].status, 'completed');
  assert.equal((await state(pending.order)).rows[0].payment_status, 'approved');
  assert.equal(await scalar('SELECT stock FROM products WHERE id=$1', [pending.product]), 8);

  const refund = await create('mercadopago');
  await db.query("UPDATE inventory_reservations SET expires_at=clock_timestamp()-INTERVAL '1 minute' WHERE order_id=$1", [refund.order]);
  assert.equal(await pay(refund, 'mercadopago'), null);
  const stock = await scalar('SELECT stock FROM products WHERE id=$1', [refund.product]);
  const movements = await scalar('SELECT count(*)::int FROM inventory_movements WHERE product_id=$1', [refund.product]);
  await resolution(refund.order, 'REFUND_STOCK_UNAVAILABLE', randomUUID(), 'Reintegro sin venta');
  const row = (await state(refund.order)).rows[0];
  assert.equal(row.status, 'refunded'); assert.equal(row.payment_status, 'refunded');
  assert.equal(row.operational_status, 'cancelled'); assert.equal(row.sale_id, null);
  assert.equal(await scalar('SELECT stock FROM products WHERE id=$1', [refund.product]), stock);
  assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements WHERE product_id=$1', [refund.product]), movements);
});

test('a repeated approved webhook cannot reopen a refunded stock-unavailable order', async () => {
  const fixture = await create('mercadopago');
  await db.query("UPDATE inventory_reservations SET expires_at=clock_timestamp()-INTERVAL '1 minute' WHERE order_id=$1", [fixture.order]);
  assert.equal(await pay(fixture, 'mercadopago'), null);
  await resolution(fixture.order, 'REFUND_STOCK_UNAVAILABLE', randomUUID(), 'Reintegro confirmado');
  const before = await effects(fixture);
  assert.equal(before.state.status, 'refunded');
  assert.equal(before.state.payment_status, 'refunded');
  assert.equal(before.state.sale_id, null);
  for (const status of ['processed', 'rejected', 'cancelled', 'pending']) {
    assert.equal(await webhook(fixture.order, status), null);
    assert.deepEqual(await effects(fixture), before);
  }
});

test('a late webhook leaves a verified refund and all reversal effects unchanged', async () => {
  const fixture = await create('mercadopago');
  const sale = await pay(fixture, 'mercadopago');
  await resolution(fixture.order, 'REFUND_VERIFIED', randomUUID(), 'Reintegro confirmado');
  const before = await effects(fixture);
  assert.equal(before.state.status, 'refunded');
  assert.equal(before.state.payment_status, 'refunded');
  assert.equal(before.state.sale_status, 'cancelled');
  assert.equal(before.stock, 10);
  for (const status of ['processed', 'rejected', 'cancelled', 'pending']) {
    assert.equal(await webhook(fixture.order, status), sale);
    assert.deepEqual(await effects(fixture), before);
  }
});

test('ordinary Mercado Pago approvals, retries, invalid reservations and rejections keep prior behavior', async () => {
  const pending = await create('mercadopago');
  await db.query("UPDATE payment_transactions SET external_order_id='test-'||order_id WHERE order_id=$1", [pending.order]);
  const sale = await webhook(pending.order);
  assert.ok(sale);
  assert.equal(await webhook(pending.order), sale);
  assert.equal((await state(pending.order)).rows[0].payment_status, 'approved');
  assert.equal((await state(pending.order)).rows[0].status, 'completed');
  assert.equal(await scalar('SELECT count(*)::int FROM sales WHERE id=$1', [sale]), 1);
  assert.equal(await scalar('SELECT stock FROM products WHERE id=$1', [pending.product]), 8);

  const alreadyApproved = await create('mercadopago');
  await db.query("UPDATE payment_transactions SET external_order_id='test-'||order_id,status='approved' WHERE order_id=$1", [alreadyApproved.order]);
  assert.ok(await webhook(alreadyApproved.order));
  assert.equal((await state(alreadyApproved.order)).rows[0].status, 'completed');

  const unavailable = await create('mercadopago');
  await db.query("UPDATE payment_transactions SET external_order_id='test-'||order_id WHERE order_id=$1", [unavailable.order]);
  await db.query("UPDATE inventory_reservations SET expires_at=clock_timestamp()-INTERVAL '1 minute' WHERE order_id=$1", [unavailable.order]);
  assert.equal(await webhook(unavailable.order), null);
  assert.equal((await state(unavailable.order)).rows[0].status, 'stock_unavailable');
  assert.equal((await state(unavailable.order)).rows[0].payment_status, 'approved');
  assert.equal(await webhook(unavailable.order, 'rejected'), null);
  assert.equal((await state(unavailable.order)).rows[0].payment_status, 'approved');

  for (const status of ['rejected', 'cancelled']) {
    const rejected = await create('mercadopago');
    await db.query("UPDATE payment_transactions SET external_order_id='test-'||order_id WHERE order_id=$1", [rejected.order]);
    assert.equal(await webhook(rejected.order, status), null);
    assert.equal((await state(rejected.order)).rows[0].status, 'rejected');
    assert.equal((await state(rejected.order)).rows[0].payment_status, 'rejected');
  }
});

test('late approval after CANCEL_PENDING becomes one refund-required incident and resolves without sale', async () => {
  const fixture = await create('mercadopago');
  await db.query("UPDATE payment_transactions SET external_order_id='test-'||order_id WHERE order_id=$1", [fixture.order]);
  await resolution(fixture.order, 'CANCEL_PENDING', null, 'Pedido cancelado antes del cobro');
  const stock = await scalar('SELECT stock FROM products WHERE id=$1', [fixture.product]);
  const sequence = await scalar('SELECT last_value FROM order_commercial_number_seq');
  assert.equal(await webhook(fixture.order), null);
  const incident = await effects(fixture);
  assert.equal(incident.state.status, 'refund_required');
  assert.equal(incident.state.payment_status, 'approved');
  assert.equal(incident.state.operational_status, 'cancelled');
  assert.equal(incident.state.sale_id, null);
  assert.equal(incident.stock, stock);
  assert.equal(incident.inventory, 0);
  assert.equal(incident.cash, 0);
  assert.equal(incident.sales, 0);
  assert.equal(incident.saleItems, 0);
  assert.equal(await scalar('SELECT count(*)::int FROM order_notes WHERE order_id=$1', [fixture.order]), 1);
  for (const status of ['processed', 'rejected', 'cancelled', 'pending']) {
    assert.equal(await webhook(fixture.order, status), null);
    assert.deepEqual(await effects(fixture), incident);
    assert.equal(await scalar('SELECT count(*)::int FROM order_notes WHERE order_id=$1', [fixture.order]), 1);
  }
  const key = randomUUID(); const reference = randomUUID();
  const first = await resolution(fixture.order, 'REFUND_STOCK_UNAVAILABLE', reference, 'Devolucion externa confirmada', key);
  assert.equal((await resolution(fixture.order, 'REFUND_STOCK_UNAVAILABLE', reference, 'Devolucion externa confirmada', key)).id, first.id);
  const refunded = await effects(fixture);
  assert.equal(refunded.state.status, 'refunded');
  assert.equal(refunded.state.payment_status, 'refunded');
  assert.equal(refunded.state.operational_status, 'cancelled');
  assert.equal(refunded.state.sale_id, null);
  assert.equal(refunded.stock, stock);
  assert.equal(refunded.inventory, 0);
  assert.equal(refunded.cash, 0);
  assert.equal(refunded.sales, 0);
  assert.equal(refunded.saleItems, 0);
  assert.equal(await scalar('SELECT count(*)::int FROM order_resolutions WHERE order_id=$1 AND resolution_type=$2',
    [fixture.order, 'REFUND_STOCK_UNAVAILABLE']), 1);
  assert.equal(await scalar('SELECT last_value FROM order_commercial_number_seq'), sequence);
  assert.equal(await webhook(fixture.order), null);
  assert.deepEqual(await effects(fixture), refunded);
});
