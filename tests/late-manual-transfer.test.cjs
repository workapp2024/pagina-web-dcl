/* eslint-disable @typescript-eslint/no-require-imports */
require('./offline-network.cjs');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const database = require('./database.cjs');
let db;
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
before(async () => { db = await database(); await db.exec('SELECT activate_finances(0,0,gen_random_uuid())'); });
after(async () => { await db?.close(); });
async function fixture(product = randomUUID()) {
  await db.query('INSERT INTO products(id,name,slug,price,stock) VALUES($1,$1,$1,100,1) ON CONFLICT DO NOTHING', [product]);
  const order = await scalar("SELECT create_public_order($1,$1,'','pickup','','','transfer',$2::jsonb,$3)", [randomUUID(), JSON.stringify([{ productId: product, quantity: 1 }]), randomUUID()]);
  assert.equal(await scalar('SELECT declare_manual_transfer($1)', [order]), true);
  await db.query("UPDATE inventory_reservations SET expires_at=clock_timestamp()-interval '1 minute' WHERE order_id=$1", [order]);
  return { order, product };
}
const confirm = f => scalar('SELECT complete_manual_transfer($1)', [f.order]);
const resolve = (f, type, key = randomUUID()) => scalar('SELECT resolve_order($1,$2,$3,$4,$5)', [f.order, type, type.startsWith('REFUND') ? 'verified-local-refund' : null, 'Local A3 test', key]);
async function state(f) {
  return {
    order: await scalar('SELECT status FROM orders WHERE id=$1', [f.order]),
    payment: (await db.query('SELECT id,status,sale_id,amount,currency,approved_at FROM payment_transactions WHERE order_id=$1', [f.order])).rows,
    stock: await scalar('SELECT stock FROM products WHERE id=$1', [f.product]),
    sales: await scalar('SELECT count(*)::int FROM sales WHERE customer_id=(SELECT customer_id FROM orders WHERE id=$1)', [f.order]),
    inventory: await scalar('SELECT count(*)::int FROM inventory_movements WHERE product_id=$1', [f.product]),
    finance: (await db.query('SELECT id,status,reason,account_id,amount FROM financial_pending_postings WHERE order_id=$1', [f.order])).rows,
    cash: (await db.query('SELECT movement_type,account_id,amount FROM cash_movements WHERE sale_id=(SELECT sale_id FROM payment_transactions WHERE order_id=$1)', [f.order])).rows,
    notes: await scalar('SELECT count(*)::int FROM order_notes WHERE order_id=$1', [f.order]),
    resolutions: await scalar('SELECT count(*)::int FROM order_resolutions WHERE order_id=$1', [f.order]),
  };
}
async function unavailable() {
  const f = await fixture(); await db.query('UPDATE products SET stock=0 WHERE id=$1', [f.product]);
  assert.equal(await confirm(f), null); return f;
}
test('expired reservation completes original order once; A1 posts once to mercadopago', async () => {
  const f = await fixture(); const sale = await confirm(f); assert.ok(sale);
  const s = await state(f); assert.equal(s.order, 'completed'); assert.equal(s.stock, 0);
  assert.equal(s.sales, 1); assert.equal(s.inventory, 1); assert.equal(s.payment.length, 1);
  assert.equal(s.payment[0].status, 'approved'); assert.equal(s.payment[0].sale_id, sale);
  assert.deepEqual(s.cash, [{ movement_type: 'sale_income', account_id: 'mercadopago', amount: '100.00' }]);
  assert.equal(s.finance.length, 1); assert.equal(s.finance[0].status, 'posted');
  for (let i = 0; i < 3; i++) assert.equal(await confirm(f), sale);
  assert.deepEqual(await state(f), s);
});
test('expired reservation without stock retains receipt and exactly one A1 pending on retries', async () => {
  const f = await unavailable(), s = await state(f);
  assert.equal(s.order, 'stock_unavailable'); assert.equal(s.payment[0].status, 'approved');
  assert.equal(s.payment[0].amount, '100.00'); assert.equal(s.payment[0].currency, 'ARS'); assert.ok(s.payment[0].approved_at);
  assert.equal(s.payment[0].sale_id, null); assert.equal(s.sales, 0); assert.equal(s.inventory, 0); assert.equal(s.stock, 0); assert.deepEqual(s.cash, []);
  assert.equal(s.finance.length, 1); assert.equal(s.finance[0].reason, 'payment_without_sale'); assert.equal(s.finance[0].status, 'pending');
  for (let i = 0; i < 3; i++) assert.equal(await confirm(f), null);
  assert.deepEqual(await state(f), s);
});
test('COMPLETE_STOCK_UNAVAILABLE uses replenished stock and the same A1 pending, idempotently', async () => {
  const f = await unavailable(), pending = (await state(f)).finance[0].id;
  await assert.rejects(resolve(f, 'COMPLETE_STOCK_UNAVAILABLE'), /INSUFFICIENT_STOCK/);
  await db.query('UPDATE products SET stock=1 WHERE id=$1', [f.product]);
  const key = randomUUID(), result = await resolve(f, 'COMPLETE_STOCK_UNAVAILABLE', key), s = await state(f);
  assert.equal(s.order, 'completed'); assert.equal(s.stock, 0); assert.equal(s.sales, 1); assert.equal(s.inventory, 1);
  assert.equal(s.finance.length, 1); assert.equal(s.finance[0].id, pending); assert.equal(s.finance[0].status, 'posted');
  assert.equal(s.cash.length, 1); assert.equal(s.cash[0].account_id, 'mercadopago'); assert.equal(s.resolutions, 1);
  assert.deepEqual(await resolve(f, 'COMPLETE_STOCK_UNAVAILABLE', key), result);
  await assert.rejects(resolve(f, 'COMPLETE_STOCK_UNAVAILABLE'), /ALREADY_APPLIED/);
  await confirm(f); assert.deepEqual(await state(f), s);
});
test('REFUND_STOCK_UNAVAILABLE closes transfer without sale or inventory; retries do not duplicate resolution', async () => {
  const f = await unavailable(), key = randomUUID(); const result = await resolve(f, 'REFUND_STOCK_UNAVAILABLE', key), s = await state(f);
  assert.equal(s.order, 'refunded'); assert.equal(s.payment[0].status, 'refunded'); assert.equal(s.sales, 0); assert.equal(s.inventory, 0);
  assert.equal(s.stock, 0); assert.equal(s.cash.length, 0); assert.equal(s.finance.length, 1); assert.equal(s.finance[0].status, 'cancelled'); assert.equal(s.resolutions, 1);
  assert.deepEqual(await resolve(f, 'REFUND_STOCK_UNAVAILABLE', key), result);
  await assert.rejects(resolve(f, 'REFUND_STOCK_UNAVAILABLE'), /ALREADY_APPLIED/);
  assert.equal(await confirm(f), null); assert.deepEqual(await state(f), s);
});
test('TRANSFER_APPROVAL_ERROR still reverses the completed late transfer exactly once', async () => {
  const f = await fixture(); await confirm(f); const key = randomUUID();
  await resolve(f, 'TRANSFER_APPROVAL_ERROR', key); const s = await state(f);
  assert.equal(s.order, 'cancelled'); assert.equal(s.payment[0].status, 'cancelled'); assert.equal(s.stock, 1); assert.equal(s.cash.length, 2);
  await resolve(f, 'TRANSFER_APPROVAL_ERROR', key); await confirm(f); assert.deepEqual(await state(f), s);
});
test('last unit: both serialized contenders orders leave exactly one sale and nonnegative stock', async () => {
  // PGlite uses one backend: test both serial outcomes, not independent sessions.
  for (const reverse of [false, true]) {
    const a = await fixture(), b = await fixture(a.product), contenders = reverse ? [b, a] : [a, b];
    const results = await Promise.all(contenders.map(confirm)); assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await scalar('SELECT stock FROM products WHERE id=$1', [a.product]), 0);
    assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements WHERE product_id=$1', [a.product]), 1);
  }
  const definition = await scalar("SELECT pg_get_functiondef('complete_manual_transfer(uuid,text)'::regprocedure)");
  assert.match(definition, /ORDER BY p.id FOR UPDATE/);
  assert.ok(definition.indexOf('ORDER BY p.id FOR UPDATE') < definition.indexOf('p.stock-i.quantity'));
});
test('another active reservation protects the last unit from late transfer', async () => {
  const a = await fixture(), b = await fixture(a.product);
  await db.query("UPDATE inventory_reservations SET expires_at=clock_timestamp()+interval '1 hour' WHERE order_id=$1", [b.order]);
  assert.equal(await confirm(a), null); assert.ok(await confirm(b));
  assert.equal((await state(a)).stock, 0);
});
