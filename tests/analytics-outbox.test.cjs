/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const migration = '20260923010000_commercial_analytics_outbox.sql';
let db, legacy;
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const events = async order => (await db.query('SELECT * FROM analytics_outbox WHERE order_id=$1 ORDER BY occurred_at,id', [order])).rows;
async function fixture(method = 'mercadopago', context = null, old = false) {
  const product = randomUUID(), key = randomUUID(), customer = randomUUID();
  await db.query('INSERT INTO products(id,name,slug,price,stock) VALUES($1,$1,$1,100,10)', [product]);
  const args = [customer, method, JSON.stringify([{ productId: product, quantity: 2 }]), key];
  const sql = "SELECT create_public_order($1,$1,'','pickup','','',$2,$3::jsonb,$4" + (old ? ')' : ",$5::jsonb,'production')");
  if (!old) args.push(JSON.stringify(context));
  return { product, key, customer, order: await scalar(sql, args), args, sql };
}
async function pay(f, method = 'mercadopago') {
  if (method === 'transfer') {
    await scalar('SELECT declare_manual_transfer($1)', [f.order]);
    return scalar("SELECT complete_manual_transfer($1,'preview')", [f.order]);
  }
  await db.query("UPDATE payment_transactions SET external_order_id='test-'||order_id WHERE order_id=$1", [f.order]);
  return scalar("SELECT complete_mercadopago_order($1::uuid,'test-'||$1::text,'payment-'||$1::text,200,'ARS','processed','production')", [f.order]);
}
const resolve = (f, type, key = randomUUID()) => scalar('SELECT resolve_order($1,$2,NULL,$3,$4,$5)', [f.order, type, 'Local test', key, 'preview']);
before(async () => {
  db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;');
  for (const file of fs.readdirSync('supabase/migrations').filter(n => /^\d{14}_/.test(n) && !n.includes('storage_setup') && n < migration).sort()) await db.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
  await db.exec("INSERT INTO site_settings(id,transfer_alias,transfer_holder,transfer_institution) VALUES(1,'test','Test','Test') ON CONFLICT(id) DO UPDATE SET transfer_alias='test',transfer_holder='Test',transfer_institution='Test'; INSERT INTO financial_periods(name,status) VALUES('Test','open')");
  legacy = await fixture('mercadopago', null, true);
  await db.exec(fs.readFileSync('supabase/migrations/' + migration, 'utf8'));
});
after(async () => { await db?.close(); });

test('latest commercial SQL bodies are unchanged except enqueue calls and optional signatures', () => {
  const updated = fs.readFileSync('supabase/migrations/' + migration, 'utf8');
  const specs = [['create_public_order','20260920010000_customer_admin.sql'],['complete_manual_transfer','20260904020000_inventory_reservations_safety.sql'],['complete_mercadopago_order','20260920020000_order_resolution_core.sql'],['resolve_order','20260920020000_order_resolution_core.sql']];
  const body = (text, name) => text.match(new RegExp('FUNCTION public\\.'+name+'\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)END \\$\\$;'))[1].replace(/\r/g, '');
  for (const [name, file] of specs) {
    const original = body(fs.readFileSync('supabase/migrations/' + file, 'utf8'), name);
    const current = body(updated, name).split('\n').filter(line => !line.includes('PERFORM enqueue_commercial_analytics(')).join('\n');
    assert.equal(current, original, name);
  }
});

test('new order only, idempotency conflict, immutable context and exact SQL properties', async () => {
  const context = { distinct_id: randomUUID(), session_id: randomUUID() };
  const f = await fixture('mercadopago', context);
  const sequence = await scalar('SELECT last_value FROM order_commercial_number_seq');
  const args = [...f.args]; args[4] = JSON.stringify({ distinct_id: randomUUID() });
  assert.equal(await scalar(f.sql, args), f.order);
  const conflict = [...args]; conflict[0] = randomUUID();
  await assert.rejects(scalar(f.sql, conflict), /IDEMPOTENCY_CONFLICT/);
  assert.equal(await scalar('SELECT last_value FROM order_commercial_number_seq'), sequence);
  const rows = await events(f.order);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].distinct_id, context.distinct_id);
  assert.equal(rows[0].session_id, context.session_id);
  assert.deepEqual(Object.keys(rows[0].properties).sort(), ['order_id','order_number','payment_method','total','currency','item_count','product_ids'].sort());
  assert.equal(rows[0].properties.total, 200); assert.equal(rows[0].properties.item_count, 2);
  assert.deepEqual(rows[0].properties.product_ids, [f.product]);
  await assert.rejects(db.query("UPDATE analytics_outbox SET distinct_id='order:'||order_id WHERE id=$1", [rows[0].id]), /IMMUTABLE/);
  await assert.rejects(db.query("UPDATE analytics_outbox SET properties=properties||'{\"phone\":\"secret\"}'::jsonb WHERE id=$1", [rows[0].id]), /IMMUTABLE/);
  await scalar("SELECT enqueue_commercial_analytics('order_created',$1,'development')", [f.order]);
  assert.equal((await events(f.order)).length, 1);
});

test('invalid optional context and PII never block purchase or persist; SDK IDs retained only when valid', async () => {
  const pii = ['name','customer_name','phone','email','document','address','message','payment_details'];
  for (const context of [null, [], '', 123, {}, { distinct_id: 'person@example.test' }, { distinct_id: randomUUID(), session_id: 'bad' }, ...pii.map(key => ({ distinct_id: randomUUID(), [key]: 'private' }))]) {
    const f = await fixture('mercadopago', context), row = (await events(f.order))[0];
    assert.equal(row.distinct_id, 'order:' + f.order); assert.equal(row.session_id, null);
    assert.doesNotMatch(JSON.stringify(row), /private|person@|customer_name|payment_details/);
  }
});

test('MP and transfer approval produce exactly three events and preserve original attribution', async () => {
  for (const method of ['mercadopago','transfer']) {
    const context = { distinct_id: randomUUID(), session_id: randomUUID() };
    const f = await fixture(method, context), sale = await pay(f, method);
    assert.ok(sale); assert.equal(await pay(f, method), sale);
    const rows = await events(f.order);
    assert.deepEqual(rows.map(r => r.event_type), ['order_created','payment_approved','purchase_completed']);
    for (const row of rows) { assert.equal(row.distinct_id, context.distinct_id); assert.equal(row.environment, 'production'); }
    assert.equal(rows[1].properties.resulting_order_status, 'completed');
    assert.equal(rows[1].properties.checkout_session_id, context.session_id);
    assert.equal(rows[2].properties.checkout_session_id, context.session_id);
    assert.equal(rows[2].properties.sale_id, sale);
    assert.equal(await scalar('SELECT stock FROM products WHERE id=$1', [f.product]), 8);
    assert.equal(await scalar('SELECT count(*)::int FROM sale_items WHERE sale_id=$1', [sale]), 1);
  }
});

test('stock unavailable records payment only, later resolution records purchase once', async () => {
  const f = await fixture();
  await db.query("UPDATE inventory_reservations SET expires_at=clock_timestamp()-INTERVAL '1 minute' WHERE order_id=$1", [f.order]);
  assert.equal(await pay(f), null); assert.equal(await pay(f), null);
  let rows = await events(f.order);
  assert.deepEqual(rows.map(r => r.event_type), ['order_created','payment_approved']);
  assert.equal(rows[1].properties.resulting_order_status, 'stock_unavailable');
  const key = randomUUID(); await resolve(f, 'COMPLETE_STOCK_UNAVAILABLE', key); await resolve(f, 'COMPLETE_STOCK_UNAVAILABLE', key);
  rows = await events(f.order);
  assert.equal(rows.length, 3); assert.equal(rows[2].event_type, 'purchase_completed');
  assert.equal(await scalar('SELECT stock FROM products WHERE id=$1', [f.product]), 8);
});

test('late approval after cancellation records refund_required, never purchase; refunds stay terminal', async () => {
  const f = await fixture(); await resolve(f, 'CANCEL_PENDING');
  assert.equal(await pay(f), null); assert.equal(await pay(f), null);
  const rows = await events(f.order);
  assert.equal(rows.length, 2); assert.equal(rows[1].properties.resulting_order_status, 'refund_required');
  await scalar('SELECT resolve_order($1,$2,$3,$4,$5)', [f.order, 'REFUND_STOCK_UNAVAILABLE', randomUUID(), 'Refund verified', randomUUID()]);
  assert.equal(await pay(f), null);
  assert.deepEqual(await events(f.order), rows);
  assert.equal(await scalar('SELECT stock FROM products WHERE id=$1', [f.product]), 10);
});

test('legacy orders receive new facts with technical fallback, without fabricated order_created', async () => {
  await pay(legacy);
  const rows = await events(legacy.order);
  assert.deepEqual(rows.map(r => r.event_type), ['payment_approved','purchase_completed']);
  assert.ok(rows.every(r => r.distinct_id === 'order:' + legacy.order && r.session_id === null));
});

test('commercial rollback rolls back all outbox facts and inventory', async () => {
  const before = await scalar('SELECT count(*)::int FROM analytics_outbox');
  await db.exec('BEGIN');
  const f = await fixture(); await pay(f);
  await db.exec('ROLLBACK');
  assert.equal(await scalar('SELECT count(*)::int FROM analytics_outbox'), before);
  assert.equal(await scalar('SELECT count(*)::int FROM orders WHERE id=$1', [f.order]), 0);
  const invalid = await fixture();
  await db.exec("CREATE FUNCTION reject_analytics_test_movement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_STOCK_FAILURE'; END $$; CREATE TRIGGER reject_analytics_test_movement BEFORE INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION reject_analytics_test_movement()");
  await assert.rejects(pay(invalid), /TEST_STOCK_FAILURE/);
  await db.exec('DROP TRIGGER reject_analytics_test_movement ON inventory_movements; DROP FUNCTION reject_analytics_test_movement()');
  assert.equal((await events(invalid.order)).length, 1);
  assert.equal(await scalar('SELECT stock FROM products WHERE id=$1', [invalid.product]), 10);
});

test('unexpected outbox SQL failure rolls back approval, sale, stock and finance atomically', async () => {
  const f = await fixture();
  const before = await scalar('SELECT count(*)::int FROM cash_movements');
  await db.exec("CREATE FUNCTION reject_analytics_test_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='purchase_completed' THEN RAISE EXCEPTION 'TEST_OUTBOX_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_analytics_test_outbox BEFORE INSERT ON analytics_outbox FOR EACH ROW EXECUTE FUNCTION reject_analytics_test_outbox()");
  try {
    await assert.rejects(pay(f), /TEST_OUTBOX_FAILURE/);
    assert.deepEqual((await events(f.order)).map(r => r.event_type), ['order_created']);
    assert.equal(await scalar('SELECT status FROM orders WHERE id=$1', [f.order]), 'pending_payment');
    assert.equal(await scalar('SELECT status FROM payment_transactions WHERE order_id=$1', [f.order]), 'pending');
    assert.equal(await scalar('SELECT sale_id FROM payment_transactions WHERE order_id=$1', [f.order]), null);
    assert.equal(await scalar('SELECT count(*)::int FROM sales WHERE customer_id=(SELECT customer_id FROM orders WHERE id=$1)', [f.order]), 0);
    assert.equal(await scalar('SELECT stock FROM products WHERE id=$1', [f.product]), 10);
    assert.equal(await scalar('SELECT count(*)::int FROM inventory_movements WHERE product_id=$1', [f.product]), 0);
    assert.equal(await scalar('SELECT count(*)::int FROM cash_movements'), before);
  } finally { await db.exec('DROP TRIGGER reject_analytics_test_outbox ON analytics_outbox; DROP FUNCTION reject_analytics_test_outbox()'); }
});

test('property validation rejects PII, incorrect types and oversized arrays; private RLS and unique constraint', async () => {
  const f = await fixture(), row = (await events(f.order))[0];
  const valid = row.properties;
  const validate = p => scalar("SELECT valid_analytics_properties('order_created',$1::jsonb)", [JSON.stringify(p)]);
  for (const key of ['phone','email','name','customer_name','document','address','message','payment_details','product_name','external_payment_id','customer_id']) assert.equal(await validate({ ...valid, [key]: 'private' }), false);
  for (const ids of [Array.from({ length: 51 }, (_, i) => 'p' + i), ['x','x'], [1], {}, null]) assert.notEqual(await validate({ ...valid, product_ids: ids }), true);
  assert.equal(await validate({ ...valid, product_ids: Array.from({ length: 50 }, (_, i) => 'p' + String(i).padStart(2,'0')) }), true);
  assert.notEqual(await validate({ ...valid, item_count: '2' }), true);
  assert.notEqual(await validate({ ...valid, total: null }), true);
  for (const key of ['currency','payment_method','order_number','order_id']) assert.notEqual(await validate({ ...valid, [key]: null }), true);
  assert.equal(await scalar("SELECT relrowsecurity FROM pg_class WHERE oid='analytics_outbox'::regclass"), true);
  for (const role of ['anon','authenticated']) {
    assert.equal(await scalar("SELECT has_table_privilege($1,'analytics_outbox','SELECT')", [role]), false);
    assert.equal(await scalar("SELECT has_function_privilege($1,'claim_analytics_outbox(text,integer)','EXECUTE')", [role]), false);
  }
  for (const name of ['create_public_order','complete_manual_transfer','complete_mercadopago_order','resolve_order']) {
    assert.equal(await scalar("SELECT count(*)::int FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=$1", [name]), 1);
    assert.equal(await scalar("SELECT has_function_privilege('anon',oid,'EXECUTE') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=$1", [name]), false);
  }
  await assert.rejects(db.query('INSERT INTO analytics_outbox(event_type,order_id,distinct_id,environment,properties) VALUES($1,$2,$3,$4,$5)', [row.event_type,row.order_id,row.distinct_id,row.environment,JSON.stringify(row.properties)]), /unique/);
});

test('leases simulate competing sequential claims, expiry, stale worker and bounded backoff', async () => {
  await db.exec("UPDATE analytics_outbox SET next_attempt_at=clock_timestamp()+INTERVAL '1 day' WHERE sent_at IS NULL");
  const f = await fixture();
  const claim = async () => (await db.query("SELECT * FROM claim_analytics_outbox('production',5)")).rows;
  const first = (await claim())[0]; assert.equal(first.order_id, f.order); assert.equal(first.attempts, 1);
  assert.equal((await claim()).length, 0);
  assert.equal((await db.query("SELECT * FROM claim_analytics_outbox('preview',5)")).rows.length, 0);
  await db.query("UPDATE analytics_outbox SET locked_until=clock_timestamp()-INTERVAL '1 second' WHERE id=$1", [first.id]);
  assert.equal(await scalar('SELECT ack_analytics_outbox($1,$2)', [first.id,first.lease_token]), false);
  const second = (await claim())[0]; assert.notEqual(second.lease_token, first.lease_token); assert.equal(second.attempts, 2);
  assert.equal(await scalar("SELECT fail_analytics_outbox($1,$2,'http_500')", [first.id,first.lease_token]), false);
  assert.equal(await scalar("SELECT fail_analytics_outbox($1,$2,'secret email')", [second.id,second.lease_token]), true);
  const failed = (await events(f.order))[0]; assert.equal(failed.last_error, 'dispatch_error');
  assert.ok(new Date(failed.next_attempt_at) > new Date()); assert.equal((await claim()).length, 0);
  await db.query("UPDATE analytics_outbox SET next_attempt_at=clock_timestamp()-INTERVAL '1 second' WHERE id=$1", [first.id]);
  const third = (await claim())[0];
  for (const key of ['id','event_type','distinct_id','occurred_at','properties']) assert.deepEqual(third[key], first[key]);
  assert.equal(await scalar('SELECT ack_analytics_outbox($1,$2)', [third.id,third.lease_token]), true);
  assert.equal((await claim()).length, 0);
  assert.ok((await events(f.order))[0].sent_at);
});

test('persistent 400/401/403 errors use increasing delays capped at one hour', async () => {
  await db.exec("UPDATE analytics_outbox SET next_attempt_at=clock_timestamp()+INTERVAL '1 day' WHERE sent_at IS NULL");
  const f = await fixture();
  for (let attempt = 1; attempt <= 9; attempt++) {
    const row = (await db.query("SELECT * FROM claim_analytics_outbox('production',5)")).rows[0];
    assert.equal(row.order_id, f.order);
    const code = ['http_400','http_401','http_403'][(attempt-1)%3];
    await scalar('SELECT fail_analytics_outbox($1,$2,$3)', [row.id,row.lease_token,code]);
    const delay = Number(await scalar('SELECT EXTRACT(EPOCH FROM next_attempt_at-clock_timestamp()) FROM analytics_outbox WHERE id=$1', [row.id]));
    const expected = Math.min(3600,30*2**(attempt-1));
    assert.ok(delay <= expected && delay > expected-2);
    assert.equal((await db.query("SELECT * FROM claim_analytics_outbox('production',5)")).rows.length, 0);
    await db.query("UPDATE analytics_outbox SET next_attempt_at=clock_timestamp()-INTERVAL '1 second' WHERE id=$1", [row.id]);
  }
});
