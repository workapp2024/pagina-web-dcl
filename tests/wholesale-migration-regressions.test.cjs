/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const database = require('./database.cjs');
let db, customer, admin;

before(async () => {
  db = await database();
  admin = randomUUID();
  await db.query('INSERT INTO auth.users(id) VALUES($1)', [admin]);
  await db.query("INSERT INTO admin_profiles(id,email,display_name,role) VALUES($1,'audit@example.invalid','Audit','ADMIN')", [admin]);
  customer = (await db.query("INSERT INTO customers(full_name,wholesale_enabled,wholesale_access_active,wholesale_code_hash) VALUES('Audit',true,true,$1) RETURNING id", ['a'.repeat(64)])).rows[0].id;
  await db.exec("INSERT INTO products(id,name,slug,category,wholesale_price) VALUES('regression','Audit','audit-regression','Audit',100)");
});
after(async () => { await db?.close(); });

async function order() {
  const attempt = (await db.query('SELECT start_wholesale_order_attempt($1,$2::jsonb,true) result', [customer, JSON.stringify([{ productId: 'regression', quantity: 2 }])])).rows[0].result;
  const id = (await db.query('SELECT submit_wholesale_order_attempt($1,$2) id', [customer, attempt.attemptId])).rows[0].id;
  const revision = (await db.query('SELECT current_revision_id FROM wholesale_orders WHERE id=$1', [id])).rows[0].current_revision_id;
  await db.query('SELECT start_wholesale_order_review($1,$2)', [id, admin]);
  await db.query("SELECT record_wholesale_stock_movement('regression','receipt',2,'Audit',$1,$2)", [randomUUID(), admin]);
  await db.query('SELECT confirm_wholesale_order_revision($1,$2,$3)', [id, revision, admin]);
  return { id, revision };
}

test('payment retries normalize padded, empty and null references without duplicate entries', async () => {
  const o = await order();
  for (const [reference, equivalent] of [['  REF  ', 'REF'], ['   ', null], [null, '']]) {
    const args = [o.id, o.revision, 10, 'ARS', 'cash', reference, new Date().toISOString(), randomUUID(), admin];
    const first = await db.query('SELECT record_wholesale_payment($1,$2,$3,$4,$5,$6,$7,$8,$9) id', args);
    const exact = await db.query('SELECT record_wholesale_payment($1,$2,$3,$4,$5,$6,$7,$8,$9) id', args);
    args[5] = equivalent;
    const normalized = await db.query('SELECT record_wholesale_payment($1,$2,$3,$4,$5,$6,$7,$8,$9) id', args);
    assert.equal(exact.rows[0].id, first.rows[0].id);
    assert.equal(normalized.rows[0].id, first.rows[0].id);
    args[5] = 'DIFFERENT';
    await assert.rejects(db.query('SELECT record_wholesale_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)', args), /WHOLESALE_IDEMPOTENCY_CONFLICT/);
  }
  assert.equal((await db.query('SELECT count(*)::int n FROM wholesale_payment_entries WHERE order_id=$1', [o.id])).rows[0].n, 3);
});

test('corrections and returns preserve the full 500-character reason and reject 501 characters atomically', async () => {
  const o = await order();
  const items = JSON.stringify([{ productId: 'regression', quantity: 1 }]);
  const delivery = (await db.query('SELECT record_wholesale_delivery($1,$2,$3::jsonb,$4,$5) id', [o.id, o.revision, JSON.stringify([{ productId: 'regression', quantity: 2 }]), randomUUID(), admin])).rows[0].id;
  const reason = 'ñ'.repeat(500);
  for (const fn of ['record_wholesale_delivery_correction', 'record_wholesale_physical_return']) {
    await assert.rejects(db.query(`SELECT ${fn}($1,$2,$3::jsonb,$4,$5,$6)`, [o.id, delivery, items, reason + 'ñ', randomUUID(), admin]), /WHOLESALE_INVALID_REQUEST/);
    const args = [o.id, delivery, items, reason, randomUUID(), admin];
    const first = await db.query(`SELECT ${fn}($1,$2,$3::jsonb,$4,$5,$6) id`, args);
    const retry = await db.query(`SELECT ${fn}($1,$2,$3::jsonb,$4,$5,$6) id`, args);
    assert.equal(first.rows[0].id, retry.rows[0].id);
  }
  const rows = (await db.query("SELECT reason FROM wholesale_inventory_movements WHERE order_id=$1 AND movement_type IN ('delivery_correction','physical_return')", [o.id])).rows;
  assert.deepEqual(rows.map(r => r.reason), [reason, reason]);
});

test('closure blocks older post-activation wholesale pending entries, not opening-snapshot history or unrelated mappings', async () => {
  await db.exec('BEGIN');
  try {
    await db.query('SELECT activate_finances(0,0,$1)', [randomUUID()]);
    await db.exec("UPDATE financial_activation SET activated_at=clock_timestamp()-interval '1 day'");
    const o = await order();
    const payment = (await db.query("SELECT record_wholesale_payment($1,$2,10,'ARS','bank_transfer',NULL,clock_timestamp(),$3,$4) id", [o.id, o.revision, randomUUID(), admin])).rows[0].id;
    // Existing pending history predates the current period, as after a legacy close.
    await db.exec("UPDATE financial_periods SET starts_at=clock_timestamp() WHERE status='open'");
    const closeKey = randomUUID();
    await db.exec('SAVEPOINT rejected_close');
    await assert.rejects(db.query("SELECT close_financial_period('Blocked',false,$1)", [closeKey]), /WHOLESALE_FINANCIAL_POSTINGS_PENDING/);
    await db.exec('ROLLBACK TO SAVEPOINT rejected_close');
    assert.equal((await db.query('SELECT count(*)::int n FROM financial_operation_requests WHERE idempotency_key=$1', [closeKey])).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int n FROM financial_periods WHERE status='closed'")).rows[0].n, 0);
    // Mapping another method must not resolve or hide this payment.
    await db.query("SELECT set_wholesale_financial_account_mapping('credit_card','mercadopago',$1)", [admin]);
    assert.equal((await db.query('SELECT status FROM wholesale_financial_postings WHERE payment_entry_id=$1', [payment])).rows[0].status, 'pending_mapping');
    await db.query("SELECT set_wholesale_financial_account_mapping('bank_transfer','cash',$1)", [admin]);
    assert.equal((await db.query('SELECT status FROM wholesale_financial_postings WHERE payment_entry_id=$1', [payment])).rows[0].status, 'posted');
    // Pre-activation unmapped history is covered by the opening snapshot;
    // it must not block, nor should an unused method without a mapping.
    await db.exec("UPDATE financial_activation SET activated_at=clock_timestamp()+interval '1 second'");
    await db.query("SELECT record_wholesale_payment($1,$2,10,'ARS','other',NULL,clock_timestamp(),$3,$4)", [o.id, o.revision, randomUUID(), admin]);
    const closed = await db.query("SELECT close_financial_period('Allowed',false,$1) id", [closeKey]);
    assert.ok(closed.rows[0].id);
    const retry = await db.query("SELECT close_financial_period('Allowed',false,$1) id", [closeKey]);
    assert.equal(retry.rows[0].id, closed.rows[0].id);
  } finally { await db.exec('ROLLBACK'); }
});
