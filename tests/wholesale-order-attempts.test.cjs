/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

const base = fs.readFileSync('supabase/migrations/20261008020000_wholesale_orders_base.sql', 'utf8');
const attemptsMigration = fs.readFileSync('supabase/migrations/20261008030000_wholesale_order_attempts.sql', 'utf8');
let db;
let customer1;
let customer2;
const items = JSON.stringify([{ productId: 'p1', quantity: 2 }]);

before(async () => {
  // PGlite is an isolated in-memory PostgreSQL instance; this test never connects to Supabase.
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE FUNCTION public.sha256(p_input BYTEA) RETURNS BYTEA
      LANGUAGE SQL IMMUTABLE AS $$ SELECT decode(md5(p_input) || md5(p_input || decode('00','hex')), 'hex') $$;
    CREATE TABLE public.customers (
      id UUID PRIMARY KEY, wholesale_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      wholesale_access_active BOOLEAN NOT NULL DEFAULT FALSE, archived_at TIMESTAMPTZ
    );
    CREATE TABLE public.admin_profiles (
      id UUID PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('ADMIN','VENDEDOR')), active BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE TABLE public.products (
      id VARCHAR(64) PRIMARY KEY, name VARCHAR(255) NOT NULL, category TEXT, connector_type TEXT,
      wholesale_price NUMERIC(12,2), cost_price NUMERIC(12,2), active BOOLEAN NOT NULL DEFAULT TRUE,
      show_in_catalog BOOLEAN NOT NULL DEFAULT TRUE
    );
    INSERT INTO public.products(id,name,category,connector_type,wholesale_price,cost_price)
      VALUES ('p1','Lámpara de prueba','Iluminación','H7',100,50);
  `);
  await db.exec(base);
  await db.exec(attemptsMigration);
});
beforeEach(async () => {
  customer1 = randomUUID();
  customer2 = randomUUID();
  await db.query('INSERT INTO public.customers(id,wholesale_enabled,wholesale_access_active) VALUES ($1,TRUE,TRUE),($2,TRUE,TRUE)', [customer1, customer2]);
});
after(async () => { await db?.close(); });

async function start(customer = customer1, newIntent = false, payload = items) {
  const result = await db.query('SELECT public.start_wholesale_order_attempt($1,$2::JSONB,$3) AS value', [customer, payload, newIntent]);
  return result.rows[0].value;
}
async function submit(attemptId, customer = customer1) {
  const result = await db.query('SELECT public.submit_wholesale_order_attempt($1,$2) AS id', [customer, attemptId]);
  return result.rows[0].id;
}

test('attempt migration adds private server-owned operation table and one-open-per-customer index', async () => {
  const table = await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.wholesale_order_attempts'::regclass");
  assert.equal(table.rows[0].relrowsecurity, true);
  const index = await db.query(`SELECT i.indisunique, pg_get_expr(i.indpred,i.indrelid) AS predicate
    FROM pg_index i WHERE i.indexrelid='public.wholesale_order_attempts_one_open_per_customer_idx'::regclass`);
  assert.equal(index.rows[0].indisunique, true);
  assert.match(index.rows[0].predicate, /status = 'open'/);
  const access = await db.query(`SELECT has_table_privilege('anon','public.wholesale_order_attempts','SELECT') anon_read,
    has_function_privilege('anon','public.start_wholesale_order_attempt(uuid,jsonb,boolean)','EXECUTE') anon_start,
    has_function_privilege('service_role','public.submit_wholesale_order_attempt(uuid,uuid)','EXECUTE') service_submit`);
  assert.deepEqual(access.rows[0], { anon_read: false, anon_start: false, service_submit: true });
});

test('attempt migration rejects different owners for submit and internal creation functions', async () => {
  const ownerGuard = attemptsMigration.match(/DO \$wholesale_attempt_owner_check\$[\s\S]*?\$wholesale_attempt_owner_check\$;/)?.[0];
  assert.ok(ownerGuard, 'migration must contain the explicit function-owner guard');
  assert.match(ownerGuard, /v_submit_owner IS DISTINCT FROM v_create_owner/);
  assert.match(ownerGuard, /WHOLESALE_FUNCTION_OWNER_MISMATCH/);

  const owner = await db.query(`SELECT pg_get_userbyid(p.proowner) AS name
    FROM pg_proc p WHERE p.oid='public.create_wholesale_order_for_attempt(uuid,uuid)'::regprocedure`);
  const quoteIdentifier = value => `"${value.replaceAll('"', '""')}"`;
  await db.exec('CREATE ROLE wholesale_attempts_owner_mismatch_test');
  try {
    await db.exec('ALTER FUNCTION public.create_wholesale_order_for_attempt(uuid,uuid) OWNER TO wholesale_attempts_owner_mismatch_test');
    await assert.rejects(db.exec(ownerGuard), /WHOLESALE_FUNCTION_OWNER_MISMATCH/);
  } finally {
    await db.exec(`ALTER FUNCTION public.create_wholesale_order_for_attempt(uuid,uuid) OWNER TO ${quoteIdentifier(owner.rows[0].name)}`);
    await db.exec('DROP ROLE wholesale_attempts_owner_mismatch_test');
  }
});

test('same open cart reuses its attempt; different cart conflicts without losing either selection', async () => {
  const first = await start();
  const repeated = await start();
  assert.equal(repeated.attemptId, first.attemptId);
  await assert.rejects(start(customer1, false, JSON.stringify([{ productId: 'p1', quantity: 3 }])), /WHOLESALE_ATTEMPT_CONFLICT/);
  const stillOpen = await db.query('SELECT status FROM public.wholesale_order_attempts WHERE id=$1', [first.attemptId]);
  assert.equal(stillOpen.rows[0].status, 'open');
});

test('attempt stores immutable normalized items and recovery restores the original after the local cart changes', async () => {
  const original = JSON.stringify([
    { productId: 'p1', quantity: 1 }, { productId: 'p1', quantity: 1 },
  ]);
  const attempt = await start(customer1, false, original);
  const changedLocalCart = JSON.stringify([{ productId: 'p1', quantity: 5 }]);
  await assert.rejects(start(customer1, false, changedLocalCart), /WHOLESALE_ATTEMPT_CONFLICT/);

  const stored = await db.query('SELECT request_items,request_fingerprint,idempotency_key FROM public.wholesale_order_attempts WHERE id=$1', [attempt.attemptId]);
  assert.deepEqual(stored.rows[0].request_items, [{ productId: 'p1', quantity: 2 }]);
  await assert.rejects(
    db.query("UPDATE public.wholesale_order_attempts SET request_items='[{\"productId\":\"p1\",\"quantity\":5}]'::JSONB WHERE id=$1", [attempt.attemptId]),
    /WHOLESALE_ATTEMPT_IMMUTABLE_FIELD/,
  );
  const recovered = await db.query('SELECT public.get_wholesale_order_attempts($1) AS value', [customer1]);
  assert.deepEqual(recovered.rows[0].value[0].items, [{ productId: 'p1', quantity: 2 }]);
  assert.equal(Object.hasOwn(recovered.rows[0].value[0], 'idempotencyKey'), false);

  // A fresh page can submit only the attempt ID; the database reads its saved items.
  const orderId = await submit(attempt.attemptId);
  assert.equal(await submit(attempt.attemptId), orderId);
  const count = await db.query('SELECT count(*)::INTEGER AS count FROM public.wholesale_orders WHERE customer_id=$1', [customer1]);
  assert.equal(count.rows[0].count, 1);
});

test('server revalidates current product eligibility and prices from the saved attempt items', async () => {
  const attempt = await start();
  await db.query("UPDATE public.products SET wholesale_price=175, cost_price=90 WHERE id='p1'");
  const orderId = await submit(attempt.attemptId);
  const price = await db.query(`SELECT ri.unit_price,ri.unit_cost_reference
    FROM public.wholesale_orders o JOIN public.wholesale_order_revision_items ri
      ON ri.revision_id=o.current_revision_id WHERE o.id=$1`, [orderId]);
  assert.deepEqual(price.rows[0], { unit_price: '175.00', unit_cost_reference: '90.00' });

  const unavailable = await start(customer2);
  await db.query("UPDATE public.products SET active=FALSE WHERE id='p1'");
  await assert.rejects(submit(unavailable.attemptId, customer2), /WHOLESALE_PRODUCT_UNAVAILABLE/);
  await db.query("UPDATE public.products SET active=TRUE, wholesale_price=100, cost_price=50 WHERE id='p1'");
});

test('created request can be recovered after a lost response and remains recoverable before acknowledgment', async () => {
  const created = await start();
  const orderId = await submit(created.attemptId);
  // Simulate the response disappearing: the caller intentionally ignores orderId.
  const attempts = await db.query('SELECT public.get_wholesale_order_attempts($1) AS value', [customer1]);
  const recoveredAttempt = attempts.rows[0].value.find(entry => entry.attemptId === created.attemptId);
  assert.equal(recoveredAttempt.status, 'created');
  assert.equal(recoveredAttempt.order.id, orderId);
  assert.equal(recoveredAttempt.order.items[0].quantity, 2);
  const retryStart = await start();
  assert.equal(retryStart.recovered, true);
  assert.equal(retryStart.orderId, orderId);
  const count = await db.query('SELECT count(*)::INTEGER AS count FROM public.wholesale_orders WHERE customer_id=$1', [customer1]);
  assert.equal(count.rows[0].count, 1);
});

test('acknowledgment is optional for order recovery; historical order and attempt link are retained', async () => {
  const created = await start();
  const orderId = await submit(created.attemptId);
  await db.query('SELECT public.acknowledge_wholesale_order_attempt($1,$2)', [customer1, created.attemptId]);
  const attempt = await db.query('SELECT status,order_id FROM public.wholesale_order_attempts WHERE id=$1', [created.attemptId]);
  assert.deepEqual(attempt.rows[0], { status: 'acknowledged', order_id: orderId });
  const recoverable = await db.query('SELECT public.get_wholesale_order_attempts($1) AS value', [customer1]);
  assert.equal(recoverable.rows[0].value.some(entry => entry.attemptId === created.attemptId), false);
  const history = await db.query('SELECT public.list_wholesale_customer_orders($1,25,NULL,NULL) AS value', [customer1]);
  assert.equal(history.rows[0].value.some(order => order.id === orderId), true);
  const repeat = await start(customer1, false);
  assert.equal(repeat.recovered, true);
  assert.equal(repeat.orderId, orderId);
});

test('intentional identical request gets a new attempt only when explicitly requested', async () => {
  const first = await start();
  const firstOrder = await submit(first.attemptId);
  const recovered = await start();
  assert.equal(recovered.orderId, firstOrder);
  const second = await start(customer1, true);
  assert.notEqual(second.attemptId, first.attemptId);
  const secondOrder = await submit(second.attemptId);
  assert.notEqual(secondOrder, firstOrder);
  const count = await db.query('SELECT count(*)::INTEGER AS count FROM public.wholesale_orders WHERE customer_id=$1', [customer1]);
  assert.equal(count.rows[0].count, 2);
});

test('legacy RPC fails closed even with a fresh key after reload and cannot create a duplicate', async () => {
  const first = await start();
  const orderId = await submit(first.attemptId);
  const secondFreshKey = randomUUID();
  await assert.rejects(
    db.query('SELECT public.create_wholesale_order($1,$2::JSONB,$3)', [customer1, items, secondFreshKey]),
    /WHOLESALE_LEGACY_SUBMISSION_DISABLED/,
  );
  await assert.rejects(
    db.query('SELECT public.create_wholesale_order($1,$2::JSONB,$3)', [customer1, items, randomUUID()]),
    /WHOLESALE_LEGACY_SUBMISSION_DISABLED/,
  );
  const orders = await db.query('SELECT id FROM public.wholesale_orders WHERE customer_id=$1', [customer1]);
  assert.deepEqual(orders.rows.map(row => row.id), [orderId]);
  const privileges = await db.query(`SELECT has_function_privilege('service_role',
    'public.create_wholesale_order(uuid,jsonb,uuid)','EXECUTE') AS legacy_exec,
    has_function_privilege('service_role','public.submit_wholesale_order_attempt(uuid,uuid)','EXECUTE') AS attempt_exec`);
  assert.deepEqual(privileges.rows[0], { legacy_exec: false, attempt_exec: true });
});

test('abandon and submit serialize: no order-linked attempt can be abandoned', async () => {
  const attempt = await start(customer2);
  const results = await Promise.allSettled([
    submit(attempt.attemptId, customer2),
    db.query('SELECT public.abandon_wholesale_order_attempt($1,$2)', [customer2, attempt.attemptId]),
  ]);
  const row = await db.query('SELECT status,order_id FROM public.wholesale_order_attempts WHERE id=$1', [attempt.attemptId]);
  if (row.rows[0].order_id) {
    assert.equal(row.rows[0].status, 'created');
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
  } else {
    assert.equal(row.rows[0].status, 'abandoned');
    assert.equal(results[0].status, 'rejected');
    assert.equal(results[1].status, 'fulfilled');
  }
});

test('concurrent submissions return one order and the submit RPC exposes no item override argument', async () => {
  const attempt = await start(customer2);
  const submissions = await Promise.all([submit(attempt.attemptId, customer2), submit(attempt.attemptId, customer2)]);
  assert.equal(submissions[0], submissions[1]);
  await assert.rejects(
    db.query('SELECT public.submit_wholesale_order_attempt($1::UUID,$2::UUID,$3::JSONB)', [customer2, attempt.attemptId, JSON.stringify([{ productId: 'p1', quantity: 4 }])]),
    /function public.submit_wholesale_order_attempt\(uuid, uuid, jsonb\) does not exist/i,
  );
  const orders = await db.query('SELECT count(*)::INTEGER AS count FROM public.wholesale_orders WHERE customer_id=$1', [customer2]);
  assert.equal(orders.rows[0].count, 1);
});

test('abandoned attempt cannot be submitted later', async () => {
  const attempt = await start(customer2);
  await db.query('SELECT public.abandon_wholesale_order_attempt($1,$2)', [customer2, attempt.attemptId]);
  await assert.rejects(submit(attempt.attemptId, customer2), /WHOLESALE_ATTEMPT_ABANDONED/);
  const orders = await db.query('SELECT count(*)::INTEGER AS count FROM public.wholesale_orders WHERE customer_id=$1', [customer2]);
  assert.equal(orders.rows[0].count, 0);
});

test('attempt operations are customer scoped and previous order history remains available', async () => {
  const attempt = await start(customer1);
  await assert.rejects(submit(attempt.attemptId, customer2), /WHOLESALE_ATTEMPT_NOT_FOUND/);
  await assert.rejects(db.query('SELECT public.abandon_wholesale_order_attempt($1,$2)', [customer2, attempt.attemptId]), /WHOLESALE_ATTEMPT_NOT_FOUND/);
  const otherHistory = await db.query('SELECT public.list_wholesale_customer_orders($1,25,NULL,NULL) AS value', [customer2]);
  assert.deepEqual(otherHistory.rows[0].value, []);

  const previousFlow = await start(customer2);
  const oldOrder = await submit(previousFlow.attemptId, customer2);
  const oldHistory = await db.query('SELECT public.list_wholesale_customer_orders($1,25,NULL,NULL) AS value', [customer2]);
  assert.equal(oldHistory.rows[0].value.some(order => order.id === oldOrder), true);
  const count = await db.query('SELECT count(*)::INTEGER AS count FROM public.wholesale_orders o LEFT JOIN public.wholesale_order_attempts a ON a.order_id=o.id WHERE o.customer_id=$1 AND a.id IS NULL', [customer2]);
  assert.equal(count.rows[0].count, 0);
});
