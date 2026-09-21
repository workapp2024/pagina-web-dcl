/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

const migration = '20260920030000_order_refunded_archiving.sql';
let db;
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const archive = (order, value = true) => scalar('SELECT set_order_archived($1,$2)', [order, value]);
async function create(method = 'mercadopago') {
  const product = randomUUID();
  await db.query('INSERT INTO products(id,name,slug,price,stock) VALUES($1,$1,$1,100,10)', [product]);
  const order = await scalar("SELECT create_public_order($1,$1,'','pickup','','',$2,$3::jsonb,$4)",
    [randomUUID(), method, JSON.stringify([{ productId: product, quantity: 2 }]), randomUUID()]);
  return { order, product };
}
async function approve(fixture, method = 'mercadopago') {
  if (method === 'transfer') {
    await scalar('SELECT declare_manual_transfer($1)', [fixture.order]);
    return scalar('SELECT complete_manual_transfer($1)', [fixture.order]);
  }
  await db.query("UPDATE payment_transactions SET external_order_id='test-'||order_id WHERE order_id=$1", [fixture.order]);
  return scalar("SELECT complete_mercadopago_order($1::uuid,'test-'||$1::text,'payment-'||$1::text,200,'ARS','processed')", [fixture.order]);
}
async function refund(fixture, type = 'REFUND_VERIFIED') {
  return scalar('SELECT resolve_order($1,$2,$3,$4,$5)',
    [fixture.order, type, randomUUID(), 'Reembolso externo confirmado', randomUUID()]);
}
async function effects(fixture) {
  const tables = {};
  for (const [name, sql, args] of [
    ['payment', 'SELECT * FROM payment_transactions WHERE order_id=$1 ORDER BY id', [fixture.order]],
    ['sale', 'SELECT * FROM sales WHERE id=(SELECT sale_id FROM payment_transactions WHERE order_id=$1) ORDER BY id', [fixture.order]],
    ['stock', 'SELECT stock FROM products WHERE id=$1', [fixture.product]],
    ['reservations', 'SELECT * FROM inventory_reservations WHERE order_id=$1 ORDER BY id', [fixture.order]],
    ['inventory', 'SELECT * FROM inventory_movements WHERE product_id=$1 ORDER BY id', [fixture.product]],
    ['cash', 'SELECT * FROM cash_movements WHERE sale_id=(SELECT sale_id FROM payment_transactions WHERE order_id=$1) ORDER BY id', [fixture.order]],
    ['resolutions', 'SELECT * FROM order_resolutions WHERE order_id=$1 ORDER BY id', [fixture.order]],
  ]) tables[name] = (await db.query(sql, args)).rows;
  return tables;
}

before(async () => {
  db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;');
  for (const file of fs.readdirSync('supabase/migrations').filter(name => /^\d{14}_/.test(name) && !name.includes('storage_setup') && name < migration).sort()) {
    await db.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
  }
  await db.exec("INSERT INTO site_settings(id,transfer_alias,transfer_holder,transfer_institution) VALUES(1,'test.alias','Test','Test') ON CONFLICT(id) DO UPDATE SET transfer_alias='test.alias',transfer_holder='Test',transfer_institution='Test'");
  await db.exec("INSERT INTO financial_periods(name,status) VALUES('Local archive period','open')");
  await db.exec(fs.readFileSync('supabase/migrations/' + migration, 'utf8'));
});
after(async () => { await db?.close(); });

test('refunded order with cancelled sale archives once without changing commercial effects or resolution history', async () => {
  const fixture = await create(); const sale = await approve(fixture); await refund(fixture);
  assert.equal(await scalar('SELECT status FROM sales WHERE id=$1', [sale]), 'cancelled');
  const before = await effects(fixture);
  const operational = await scalar('SELECT operational_status FROM orders WHERE id=$1', [fixture.order]);
  assert.equal(await archive(fixture.order), true);
  const archivedAt = await scalar('SELECT archived_at FROM orders WHERE id=$1', [fixture.order]);
  assert.ok(archivedAt);
  assert.equal(await archive(fixture.order), true);
  assert.equal((await scalar('SELECT archived_at FROM orders WHERE id=$1', [fixture.order])).toISOString(), archivedAt.toISOString());
  assert.deepEqual(await effects(fixture), before);
  assert.equal(await scalar('SELECT operational_status FROM orders WHERE id=$1', [fixture.order]), operational);
  assert.equal(await scalar("SELECT count(*)::int FROM order_operational_history WHERE order_id=$1 AND action='archive'", [fixture.order]), 1);
});

test('refunded order without a sale archives after stock-unavailable or refund-required resolution', async () => {
  for (const source of ['stock_unavailable', 'refund_required']) {
    const fixture = await create();
    if (source === 'stock_unavailable') {
      await db.query("UPDATE inventory_reservations SET expires_at=clock_timestamp()-INTERVAL '1 minute' WHERE order_id=$1", [fixture.order]);
      assert.equal(await approve(fixture), null);
    } else {
      await db.query("UPDATE payment_transactions SET external_order_id='test-'||order_id WHERE order_id=$1", [fixture.order]);
      await scalar('SELECT resolve_order($1,$2,NULL,$3,$4)', [fixture.order, 'CANCEL_PENDING', 'No cobrado', randomUUID()]);
      assert.equal(await scalar("SELECT complete_mercadopago_order($1::uuid,'test-'||$1::text,'payment-'||$1::text,200,'ARS','processed')", [fixture.order]), null);
    }
    assert.equal(await scalar('SELECT status FROM orders WHERE id=$1', [fixture.order]), source);
    await refund(fixture, 'REFUND_STOCK_UNAVAILABLE');
    const before = await effects(fixture);
    assert.equal(before.sale.length, 0);
    assert.equal(await archive(fixture.order), true);
    assert.deepEqual(await effects(fixture), before);
  }
});

test('refunded with active sale, non-refunded payment, active reservation or ambiguous payment cannot archive', async () => {
  const activeSale = await create(); const sale = await approve(activeSale); await refund(activeSale);
  await db.query("UPDATE sales SET status='completed' WHERE id=$1", [sale]);
  await assert.rejects(archive(activeSale.order), /CANCELLATION_FINANCIAL_MISMATCH/);

  const payment = await create(); await approve(payment); await refund(payment);
  await db.query("UPDATE payment_transactions SET status='approved' WHERE order_id=$1", [payment.order]);
  await assert.rejects(archive(payment.order), /PAYMENT_REQUIRES_ATTENTION/);

  const reservation = await create(); await approve(reservation); await refund(reservation);
  await db.query("UPDATE inventory_reservations SET status='active',expires_at=clock_timestamp()+INTERVAL '1 hour' WHERE order_id=$1", [reservation.order]);
  await assert.rejects(archive(reservation.order), /RESERVATION_ACTIVE/);

  const ambiguous = await create(); await approve(ambiguous); await refund(ambiguous);
  await db.query("INSERT INTO payment_transactions(order_id,provider,status,amount,currency,external_idempotency_key) VALUES($1,'mercadopago','refunded',200,'ARS',$2)", [ambiguous.order, randomUUID()]);
  await assert.rejects(archive(ambiguous.order), /PAYMENT_AMBIGUOUS/);
});

test('delivered and cancelled retain their prior archive rules', async () => {
  const delivered = await create('transfer'); await approve(delivered, 'transfer');
  for (const [from, to] of [['received', 'preparing'], ['preparing', 'ready'], ['ready', 'delivered']]) {
    await scalar('SELECT set_order_operational_status($1,$2,$3)', [delivered.order, from, to]);
  }
  assert.equal(await archive(delivered.order), true);
  const invalidDelivered = await create('transfer'); await approve(invalidDelivered, 'transfer');
  for (const [from, to] of [['received', 'preparing'], ['preparing', 'ready'], ['ready', 'delivered']]) {
    await scalar('SELECT set_order_operational_status($1,$2,$3)', [invalidDelivered.order, from, to]);
  }
  await db.query("UPDATE payment_transactions SET status='error' WHERE order_id=$1", [invalidDelivered.order]);
  await assert.rejects(archive(invalidDelivered.order), /PAYMENT_REQUIRES_ATTENTION/);

  const cancelled = await create('transfer');
  await scalar('SELECT cancel_public_order($1)', [cancelled.order]);
  await scalar('SELECT set_order_operational_status($1,$2,$3)', [cancelled.order, 'received', 'cancelled']);
  assert.equal(await archive(cancelled.order), true);
  const invalidCancelled = await create('transfer');
  await scalar('SELECT cancel_public_order($1)', [invalidCancelled.order]);
  await scalar('SELECT set_order_operational_status($1,$2,$3)', [invalidCancelled.order, 'received', 'cancelled']);
  await db.query("UPDATE payment_transactions SET status='approved' WHERE order_id=$1", [invalidCancelled.order]);
  await assert.rejects(archive(invalidCancelled.order), /CANCELLATION_FINANCIAL_MISMATCH/);
});
