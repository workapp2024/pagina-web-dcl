/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const load = require('./load-ts.cjs');

const migration = fs.readFileSync('supabase/migrations/20261008020000_wholesale_orders_base.sql', 'utf8');
const expectedRevisionMigration = fs.readFileSync('supabase/migrations/20261011010000_wholesale_revision_expected.sql', 'utf8');
const customerProposalResponsesMigration = fs.readFileSync('supabase/migrations/20261012010000_wholesale_customer_proposal_responses.sql', 'utf8');
let db;
let customer1;
let customer2;
let adminActor;
let sellerActor;

before(async () => {
  db = new PGlite();
  customer1 = randomUUID();
  customer2 = randomUUID();
  adminActor = randomUUID();
  sellerActor = randomUUID();
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
      id VARCHAR(64) PRIMARY KEY, name VARCHAR(255) NOT NULL, category TEXT,
      connector_type TEXT, wholesale_price NUMERIC(12,2), cost_price NUMERIC(12,2),
      stock INTEGER NOT NULL DEFAULT 7, active BOOLEAN NOT NULL DEFAULT TRUE,
      show_in_catalog BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE TABLE public.sales (id UUID PRIMARY KEY);
    CREATE TABLE public.payment_transactions (id UUID PRIMARY KEY);
    CREATE TABLE public.inventory_movements (id UUID PRIMARY KEY);
    CREATE TABLE public.inventory_reservations (id UUID PRIMARY KEY);
    INSERT INTO public.customers(id,wholesale_enabled,wholesale_access_active)
      VALUES ('${customer1}',TRUE,TRUE),('${customer2}',TRUE,TRUE);
    INSERT INTO public.admin_profiles(id,role,active)
      VALUES ('${adminActor}','ADMIN',TRUE),('${sellerActor}','VENDEDOR',TRUE);
    INSERT INTO public.products(id,name,category,connector_type,wholesale_price,cost_price)
      VALUES ('p1','S6 HD','Iluminación','H7',15000,11000),('p2','F10X','Auxiliar','H11',9000,NULL);
  `);
  await db.exec(migration);
  await db.exec(expectedRevisionMigration);
  await db.exec(customerProposalResponsesMigration);
});
after(async () => { await db?.close(); });

function items(entries) { return JSON.stringify(entries); }
async function createOrder(customerId, entries, key = randomUUID()) {
  const result = await db.query('SELECT public.create_wholesale_order($1,$2::JSONB,$3) AS id', [customerId, items(entries), key]);
  return { id: result.rows[0].id, key };
}

test('migration creates only the four private wholesale request tables with required relationships', async () => {
  const tables = await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'wholesale_order%' ORDER BY tablename`);
  assert.deepEqual(tables.rows.map(row => row.tablename), [
    'wholesale_order_events', 'wholesale_order_revision_items', 'wholesale_order_revisions', 'wholesale_orders',
  ]);
  for (const table of tables.rows.map(row => row.tablename)) {
    const rls = await db.query('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass', [`public.${table}`]);
    assert.equal(rls.rows[0].relrowsecurity, true, `${table} has RLS`);
  }
  const unrelated = await db.query(`SELECT to_regclass('public.sales') AS sales, to_regclass('public.payment_transactions') AS payments,
    to_regclass('public.inventory_movements') AS movements, to_regclass('public.inventory_reservations') AS reservations`);
  assert.deepEqual(unrelated.rows[0], {
    sales: 'sales', payments: 'payment_transactions', movements: 'inventory_movements', reservations: 'inventory_reservations',
  });
});


test('request creation snapshots current wholesale price and reference cost, and retries are idempotent', async () => {
  const request = await createOrder(customer1, [{ productId: 'p1', quantity: 10 }, { productId: 'p2', quantity: 4 }]);
  const retry = await createOrder(customer1, [{ productId: 'p2', quantity: 4 }, { productId: 'p1', quantity: 10 }], request.key);
  assert.equal(retry.id, request.id);
  const order = await db.query('SELECT order_number,status FROM public.wholesale_orders WHERE id=$1', [request.id]);
  assert.equal(order.rows[0].order_number, 'MW-000001');
  assert.equal(order.rows[0].status, 'received');
  const lines = await db.query(`SELECT product_id,quantity,unit_price,unit_cost_reference,line_total,currency
    FROM public.wholesale_order_revision_items WHERE revision_id=(SELECT current_revision_id FROM public.wholesale_orders WHERE id=$1) ORDER BY product_id`, [request.id]);
  assert.deepEqual(lines.rows, [
    { product_id: 'p1', quantity: 10, unit_price: '15000.00', unit_cost_reference: '11000.00', line_total: '150000.00', currency: 'ARS' },
    { product_id: 'p2', quantity: 4, unit_price: '9000.00', unit_cost_reference: null, line_total: '36000.00', currency: 'ARS' },
  ]);
  await db.query("UPDATE public.products SET wholesale_price=20000,cost_price=17000 WHERE id='p1'");
  const frozen = await db.query("SELECT unit_price,unit_cost_reference FROM public.wholesale_order_revision_items WHERE revision_id=(SELECT current_revision_id FROM public.wholesale_orders WHERE id=$1) AND product_id='p1'", [request.id]);
  assert.deepEqual(frozen.rows[0], { unit_price: '15000.00', unit_cost_reference: '11000.00' });
});

test('MW numbers are unique, customer is mandatory, and a reused key with different items conflicts', async () => {
  const first = await createOrder(customer1, [{ productId: 'p1', quantity: 1 }]);
  const second = await createOrder(customer2, [{ productId: 'p1', quantity: 1 }]);
  const numbers = await db.query('SELECT order_number FROM public.wholesale_orders WHERE id IN ($1,$2) ORDER BY order_number', [first.id, second.id]);
  assert.deepEqual(numbers.rows.map(row => row.order_number), ['MW-000002', 'MW-000003']);
  await assert.rejects(db.query('SELECT public.create_wholesale_order(NULL,$1::JSONB,$2)', [items([{ productId: 'p1', quantity: 1 }]), randomUUID()]), /WHOLESALE_INVALID_REQUEST/);
  await assert.rejects(db.query('SELECT public.create_wholesale_order($1,$2::JSONB,$3)', [customer1, items([{ productId: 'p1', quantity: 2 }]), first.key]), /WHOLESALE_IDEMPOTENCY_CONFLICT/);
});

test('a changed proposal keeps original snapshots and requires approval of the exact revision', async () => {
  const request = await createOrder(customer1, [{ productId: 'p1', quantity: 10 }]);
  const original = await db.query('SELECT current_revision_id FROM public.wholesale_orders WHERE id=$1', [request.id]);
  const actor = adminActor;
  await db.query('SELECT public.start_wholesale_order_review($1,$2)', [request.id, actor]);
  const proposed = await db.query(`SELECT public.propose_wholesale_order_revision($1,$2::JSONB,$3,$4,NULL,$5) AS id`, [
    request.id, items([{ productId: 'p1', quantity: 8 }]), randomUUID(), actor, 'Proveedor confirmó 8 unidades',
  ]);
  const revisionId = proposed.rows[0].id;
  const state = await db.query(`SELECT o.status,r.version_number,r.revision_type,r.status AS revision_status,r.requires_customer_approval,r.total_amount
    FROM public.wholesale_orders o JOIN public.wholesale_order_revisions r ON r.id=o.current_revision_id WHERE o.id=$1`, [request.id]);
  assert.deepEqual(state.rows[0], {
    status: 'awaiting_customer', version_number: 2, revision_type: 'proposal', revision_status: 'awaiting_customer',
    requires_customer_approval: true, total_amount: '160000.00',
  });
  const oldLine = await db.query('SELECT quantity,unit_price FROM public.wholesale_order_revision_items WHERE revision_id=$1', [original.rows[0].current_revision_id]);
  assert.deepEqual(oldLine.rows[0], { quantity: 10, unit_price: '20000.00' });
  await assert.rejects(db.query('SELECT public.confirm_wholesale_order_revision($1,$2,$3)', [request.id, revisionId, actor]), /WHOLESALE_REVISION_NOT_CONFIRMABLE/);
  await db.query('SELECT public.approve_wholesale_order_revision_portal($1,$2,$3)', [request.id, customer1, revisionId]);
  await db.query('SELECT public.approve_wholesale_order_revision_portal($1,$2,$3)', [request.id, customer1, revisionId]);
  await db.query('SELECT public.confirm_wholesale_order_revision($1,$2,$3)', [request.id, revisionId, actor]);
  const confirmed = await db.query('SELECT status,confirmed_revision_id,confirmed_at FROM public.wholesale_orders WHERE id=$1', [request.id]);
  assert.equal(confirmed.rows[0].status, 'confirmed');
  assert.equal(confirmed.rows[0].confirmed_revision_id, revisionId);
  assert.ok(confirmed.rows[0].confirmed_at);
  await assert.rejects(
    db.query(`SELECT public.propose_wholesale_order_revision_if_current($1,$2,$3::JSONB,$4,$5,$6,'')`, [
      request.id, revisionId, items([{ productId: 'p1', quantity: 9 }]), randomUUID(), actor, 'Pago total antes de la entrega',
    ]), /WHOLESALE_ORDER_INVALID_STATE/,
  );
  const stillConfirmed = await db.query('SELECT status,current_revision_id,confirmed_revision_id FROM public.wholesale_orders WHERE id=$1', [request.id]);
  assert.deepEqual(stillConfirmed.rows[0], { status: 'confirmed', current_revision_id: revisionId, confirmed_revision_id: revisionId });
  await assert.rejects(db.query('UPDATE public.wholesale_order_revision_items SET quantity=99 WHERE revision_id=$1', [revisionId]), /WHOLESALE_REVISION_ITEM_IMMUTABLE/);
  await assert.rejects(db.query('UPDATE public.wholesale_orders SET customer_id=$2 WHERE id=$1', [request.id, customer2]), /WHOLESALE_ORDER_IMMUTABLE_FIELD/);
});

test('after rejection, an identical proposal still requires customer approval; rejection and proposal retries remain safe', async () => {
  const request = await createOrder(customer1, [{ productId: 'p1', quantity: 2 }]);
  await db.query('SELECT public.start_wholesale_order_review($1,$2)', [request.id, adminActor]);
  const original = await db.query('SELECT current_revision_id FROM public.wholesale_orders WHERE id=$1', [request.id]);
  const key = randomUUID();
  const proposal = await db.query(`SELECT public.propose_wholesale_order_revision_if_current($1,$2,$3::JSONB,$4,$5,$6,$7) AS id`, [
    request.id, original.rows[0].current_revision_id, items([{ productId: 'p1', quantity: 3 }]), key, adminActor, 'Pago total antes de la entrega', 'Nota interna no pública',
  ]);
  const proposalId = proposal.rows[0].id;

  await assert.rejects(
    db.query('SELECT public.reject_wholesale_order_revision_portal($1,$2,$3)', [request.id, customer2, proposalId]),
    /WHOLESALE_ORDER_NOT_FOUND/,
  );
  await assert.rejects(
    db.query('SELECT public.reject_wholesale_order_revision_portal($1,$2,$3)', [request.id, customer1, original.rows[0].current_revision_id]),
    /WHOLESALE_REVISION_STALE/,
  );
  await db.query('SELECT public.reject_wholesale_order_revision_portal($1,$2,$3)', [request.id, customer1, proposalId]);
  await db.query('SELECT public.reject_wholesale_order_revision_portal($1,$2,$3)', [request.id, customer1, proposalId]);
  const rejected = await db.query(`SELECT o.status,r.status AS revision_status,
    (SELECT count(*)::INTEGER FROM public.wholesale_order_events e WHERE e.revision_id=r.id AND e.event_type='revision_rejected') AS rejections,
    (SELECT e.actor_id FROM public.wholesale_order_events e WHERE e.revision_id=r.id AND e.event_type='revision_rejected') AS actor_id
    FROM public.wholesale_orders o JOIN public.wholesale_order_revisions r ON r.id=o.current_revision_id WHERE o.id=$1`, [request.id]);
  assert.deepEqual(rejected.rows[0], { status: 'in_review', revision_status: 'rejected', rejections: 1, actor_id: customer1 });

  const next = await db.query(`SELECT public.propose_wholesale_order_revision_if_current($1,$2,$3::JSONB,$4,$5,$6,'') AS id`, [
    request.id, proposalId, items([{ productId: 'p1', quantity: 3 }]), randomUUID(), adminActor, 'Pago total antes de la entrega',
  ]);
  assert.ok(next.rows[0].id);
  const old = await db.query('SELECT status FROM public.wholesale_order_revisions WHERE id=$1', [proposalId]);
  assert.equal(old.rows[0].status, 'superseded');
  const resent = await db.query('SELECT status,requires_customer_approval FROM public.wholesale_order_revisions WHERE id=$1', [next.rows[0].id]);
  assert.deepEqual(resent.rows[0], { status: 'awaiting_customer', requires_customer_approval: true });
  await assert.rejects(
    db.query(`SELECT public.propose_wholesale_order_revision_if_current($1,$2,$3::JSONB,$4,$5,$6,'')`, [
      request.id, next.rows[0].id, items([{ productId: 'p1', quantity: 3 }]), randomUUID(), adminActor, 'Pago total antes de la entrega',
    ]), /WHOLESALE_PROPOSAL_UNCHANGED/,
  );
});

test('customer proposal history includes current terms but never internal event notes', async () => {
  const request = await createOrder(customer1, [{ productId: 'p1', quantity: 1 }]);
  await db.query('SELECT public.start_wholesale_order_review($1,$2)', [request.id, adminActor]);
  const current = await db.query('SELECT current_revision_id FROM public.wholesale_orders WHERE id=$1', [request.id]);
  await db.query(`SELECT public.propose_wholesale_order_revision_if_current($1,$2,$3::JSONB,$4,$5,$6,$7)`, [
    request.id, current.rows[0].current_revision_id, items([{ productId: 'p1', quantity: 2 }]), randomUUID(), adminActor, 'Pago al momento de la entrega', 'Nota secreta de administración',
  ]);
  const result = await db.query('SELECT public.list_wholesale_customer_orders($1,25,NULL,NULL) AS data', [customer1]);
  const order = result.rows[0].data[0];
  assert.equal(order.status, 'awaiting_customer');
  assert.equal(order.revision_status, 'awaiting_customer');
  assert.equal(order.requires_customer_approval, true);
  assert.equal(order.commercial_conditions, 'Pago al momento de la entrega');
  assert.doesNotMatch(JSON.stringify(order), /Nota secreta|internal_note/i);
});

test('portal approval is owner-scoped and WhatsApp approval records channel, actor, time, and note', async () => {
  const request = await createOrder(customer1, [{ productId: 'p2', quantity: 2 }]);
  const actor = adminActor;
  await db.query('SELECT public.start_wholesale_order_review($1,$2)', [request.id, actor]);
  const result = await db.query('SELECT public.propose_wholesale_order_revision($1,$2::JSONB,$3,$4,NULL,$5) AS id', [
    request.id, items([{ productId: 'p2', quantity: 1 }]), randomUUID(), actor, '',
  ]);
  const revisionId = result.rows[0].id;
  await assert.rejects(db.query('SELECT public.approve_wholesale_order_revision_portal($1,$2,$3)', [request.id, customer2, revisionId]), /WHOLESALE_ORDER_NOT_FOUND/);
  await db.query("SELECT public.record_wholesale_whatsapp_approval($1,$2,$3,'Autorización recibida por teléfono')", [request.id, revisionId, actor]);
  const event = await db.query(`SELECT revision_id,actor_type,actor_id,source,approval_channel,internal_note,created_at
    FROM public.wholesale_order_events WHERE order_id=$1 AND event_type='revision_approved'`, [request.id]);
  assert.equal(event.rows.length, 1);
  assert.equal(event.rows[0].revision_id, revisionId);
  assert.equal(event.rows[0].actor_type, 'admin');
  assert.equal(event.rows[0].actor_id, actor);
  assert.equal(event.rows[0].source, 'whatsapp');
  assert.equal(event.rows[0].approval_channel, 'whatsapp');
  assert.equal(event.rows[0].internal_note, 'Autorización recibida por teléfono');
  assert.ok(event.rows[0].created_at);
});

test('internal-only proposal note does not require customer approval', async () => {
  const request = await createOrder(customer1, [{ productId: 'p2', quantity: 2 }]);
  const actor = adminActor;
  await db.query('SELECT public.start_wholesale_order_review($1,$2)', [request.id, actor]);
  const proposed = await db.query(`SELECT public.propose_wholesale_order_revision($1,$2::JSONB,$3,$4,NULL,$5) AS id`, [
    request.id, items([{ productId: 'p2', quantity: 2 }]), randomUUID(), actor, 'Nota interna sin cambios comerciales',
  ]);
  const revision = await db.query('SELECT status,requires_customer_approval FROM public.wholesale_order_revisions WHERE id=$1', [proposed.rows[0].id]);
  assert.deepEqual(revision.rows[0], { status: 'ready_for_confirmation', requires_customer_approval: false });
});

test('an ADMIN must approve a changed total even when product and quantity stay the same', async () => {
  const request = await createOrder(customer1, [{ productId: 'p2', quantity: 2 }]);
  const actor = adminActor;
  const original = await db.query(`SELECT r.total_amount FROM public.wholesale_orders o
    JOIN public.wholesale_order_revisions r ON r.id=o.current_revision_id WHERE o.id=$1`, [request.id]);
  await db.query('SELECT public.start_wholesale_order_review($1,$2)', [request.id, actor]);
  await db.query("UPDATE public.products SET wholesale_price=12000 WHERE id='p2'");
  const proposed = await db.query(`SELECT public.propose_wholesale_order_revision($1,$2::JSONB,$3,$4,NULL,'') AS id`, [
    request.id, items([{ productId: 'p2', quantity: 2 }]), randomUUID(), actor,
  ]);
  const revision = await db.query('SELECT total_amount,requires_customer_approval FROM public.wholesale_order_revisions WHERE id=$1', [proposed.rows[0].id]);
  assert.notEqual(revision.rows[0].total_amount, original.rows[0].total_amount);
  assert.equal(revision.rows[0].requires_customer_approval, true);
});

test('administrative workflow RPCs reject VENDEDOR and accept an active ADMIN actor', async () => {
  const request = await createOrder(customer1, [{ productId: 'p2', quantity: 2 }]);
  const key = randomUUID();
  const changedItems = items([{ productId: 'p2', quantity: 1 }]);

  await assert.rejects(
    db.query('SELECT public.start_wholesale_order_review($1,$2)', [request.id, sellerActor]),
    /WHOLESALE_ADMIN_REQUIRED/,
  );
  await db.query('SELECT public.start_wholesale_order_review($1,$2)', [request.id, adminActor]);

  await assert.rejects(
    db.query('SELECT public.propose_wholesale_order_revision($1,$2::JSONB,$3,$4,NULL,$5)', [request.id, changedItems, key, sellerActor, '']),
    /WHOLESALE_ADMIN_REQUIRED/,
  );
  const proposal = await db.query('SELECT public.propose_wholesale_order_revision($1,$2::JSONB,$3,$4,NULL,$5) AS id', [
    request.id, changedItems, key, adminActor, '',
  ]);
  const revisionId = proposal.rows[0].id;

  await assert.rejects(
    db.query('SELECT public.record_wholesale_whatsapp_approval($1,$2,$3,$4)', [request.id, revisionId, sellerActor, '']),
    /WHOLESALE_ADMIN_REQUIRED/,
  );
  await db.query('SELECT public.record_wholesale_whatsapp_approval($1,$2,$3,$4)', [request.id, revisionId, adminActor, '']);

  await assert.rejects(
    db.query('SELECT public.confirm_wholesale_order_revision($1,$2,$3)', [request.id, revisionId, sellerActor]),
    /WHOLESALE_ADMIN_REQUIRED/,
  );
  await db.query('SELECT public.confirm_wholesale_order_revision($1,$2,$3)', [request.id, revisionId, adminActor]);

  await assert.rejects(
    db.query("SELECT public.close_wholesale_order($1,'cancel',$2,'')", [request.id, sellerActor]),
    /WHOLESALE_ADMIN_REQUIRED/,
  );
  await db.query("SELECT public.close_wholesale_order($1,'cancel',$2,'')", [request.id, adminActor]);
});

async function createExpectedRevisionProposal(orderId, expectedRevision, entries, key = randomUUID(), actor = adminActor, conditions = null, internalNote = '') {
  const result = await db.query(`SELECT public.propose_wholesale_order_revision_if_current($1,$2,$3::JSONB,$4,$5,$6,$7) AS id`, [
    orderId, expectedRevision, items(entries), key, actor, conditions, internalNote,
  ]);
  return { id: result.rows[0].id, key };
}

test('expected-revision proposal requires the still-current revision and writes nothing on stale input', async () => {
  const request = await createOrder(customer1, [{ productId: 'p1', quantity: 3 }]);
  await db.query('SELECT public.start_wholesale_order_review($1,$2)', [request.id, adminActor]);
  const initial = await db.query('SELECT current_revision_id FROM public.wholesale_orders WHERE id=$1', [request.id]);
  const proposal = await createExpectedRevisionProposal(request.id, initial.rows[0].current_revision_id, [{ productId: 'p1', quantity: 2 }]);
  const before = await db.query(`SELECT
    (SELECT count(*)::INTEGER FROM public.wholesale_order_revisions WHERE order_id=$1) AS revisions,
    (SELECT count(*)::INTEGER FROM public.wholesale_order_events WHERE order_id=$1) AS events`, [request.id]);
  await assert.rejects(
    createExpectedRevisionProposal(request.id, initial.rows[0].current_revision_id, [{ productId: 'p1', quantity: 1 }]),
    /WHOLESALE_REVISION_STALE/,
  );
  const after = await db.query(`SELECT o.current_revision_id,
    (SELECT count(*)::INTEGER FROM public.wholesale_order_revisions WHERE order_id=$1) AS revisions,
    (SELECT count(*)::INTEGER FROM public.wholesale_order_events WHERE order_id=$1) AS events
    FROM public.wholesale_orders o WHERE o.id=$1`, [request.id]);
  assert.equal(after.rows[0].current_revision_id, proposal.id);
  assert.equal(after.rows[0].revisions, before.rows[0].revisions);
  assert.equal(after.rows[0].events, before.rows[0].events);
});

test('competing proposals in the single-session PGlite test leave one current revision', async () => {
  const request = await createOrder(customer2, [{ productId: 'p2', quantity: 4 }]);
  await db.query('SELECT public.start_wholesale_order_review($1,$2)', [request.id, adminActor]);
  const current = await db.query('SELECT current_revision_id FROM public.wholesale_orders WHERE id=$1', [request.id]);
  const attempts = await Promise.allSettled([
    createExpectedRevisionProposal(request.id, current.rows[0].current_revision_id, [{ productId: 'p2', quantity: 3 }]),
    createExpectedRevisionProposal(request.id, current.rows[0].current_revision_id, [{ productId: 'p2', quantity: 2 }]),
  ]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(result => result.status === 'rejected' && /WHOLESALE_REVISION_STALE/.test(result.reason.message)).length, 1);
  const state = await db.query(`SELECT
    (SELECT count(*)::INTEGER FROM public.wholesale_order_revisions WHERE order_id=$1) AS revisions,
    (SELECT count(*)::INTEGER FROM public.wholesale_order_events WHERE order_id=$1 AND event_type='revision_proposed') AS proposals,
    current_revision_id
    FROM public.wholesale_orders WHERE id=$1`, [request.id]);
  assert.equal(state.rows[0].revisions, 2);
  assert.equal(state.rows[0].proposals, 1);
  assert.notEqual(state.rows[0].current_revision_id, current.rows[0].current_revision_id);
});

test('expected-revision proposal enforces ADMIN, is idempotent, and preserves revision and event trace', async () => {
  const request = await createOrder(customer1, [{ productId: 'p1', quantity: 5 }]);
  await db.query('SELECT public.start_wholesale_order_review($1,$2)', [request.id, adminActor]);
  const current = await db.query('SELECT current_revision_id FROM public.wholesale_orders WHERE id=$1', [request.id]);
  const key = randomUUID();
  const entries = [{ productId: 'p1', quantity: 4 }];
  await assert.rejects(
    createExpectedRevisionProposal(request.id, current.rows[0].current_revision_id, entries, randomUUID(), sellerActor),
    /WHOLESALE_ADMIN_REQUIRED/,
  );
  const proposal = await createExpectedRevisionProposal(request.id, current.rows[0].current_revision_id, entries, key, adminActor, 'Entrega acordada', 'Confirmar disponibilidad con proveedor');
  const retry = await createExpectedRevisionProposal(request.id, current.rows[0].current_revision_id, entries, key, adminActor, 'Entrega acordada', 'Nota distinta que el reintento no debe duplicar');
  assert.equal(retry.id, proposal.id);
  await assert.rejects(
    createExpectedRevisionProposal(request.id, current.rows[0].current_revision_id, [{ productId: 'p1', quantity: 1 }], key),
    /WHOLESALE_IDEMPOTENCY_CONFLICT/,
  );
  const result = await db.query(`SELECT o.status,o.current_revision_id,r.status AS revision_status,r.version_number,
      r.total_amount,r.commercial_conditions,r.requires_customer_approval,r.created_by,
      (SELECT count(*)::INTEGER FROM public.wholesale_order_events e WHERE e.order_id=o.id AND e.revision_id=r.id) AS event_count,
      (SELECT string_agg(DISTINCT e.internal_note, '|' ORDER BY e.internal_note) FROM public.wholesale_order_events e WHERE e.order_id=o.id AND e.revision_id=r.id) AS internal_notes
    FROM public.wholesale_orders o JOIN public.wholesale_order_revisions r ON r.id=o.current_revision_id WHERE o.id=$1`, [request.id]);
  assert.deepEqual(result.rows[0], {
    status: 'awaiting_customer', current_revision_id: proposal.id, revision_status: 'awaiting_customer',
    version_number: 2, total_amount: '80000.00', commercial_conditions: 'Entrega acordada',
    requires_customer_approval: true, created_by: adminActor, event_count: 2,
    internal_notes: 'Confirmar disponibilidad con proveedor',
  });
  const permissions = await db.query(`SELECT
    has_function_privilege('anon','public.propose_wholesale_order_revision_if_current(uuid,uuid,jsonb,uuid,uuid,text,text)','EXECUTE') AS anon_exec,
    has_function_privilege('authenticated','public.propose_wholesale_order_revision_if_current(uuid,uuid,jsonb,uuid,uuid,text,text)','EXECUTE') AS authenticated_exec,
    has_function_privilege('service_role','public.propose_wholesale_order_revision_if_current(uuid,uuid,jsonb,uuid,uuid,text,text)','EXECUTE') AS service_exec`);
  assert.deepEqual(permissions.rows[0], { anon_exec: false, authenticated_exec: false, service_exec: true });
});

test('expected-revision proposal rejects overlong internal notes without writing rows', async () => {
  const request = await createOrder(customer2, [{ productId: 'p2', quantity: 1 }]);
  await db.query('SELECT public.start_wholesale_order_review($1,$2)', [request.id, adminActor]);
  const current = await db.query('SELECT current_revision_id FROM public.wholesale_orders WHERE id=$1', [request.id]);
  const before = await db.query(`SELECT (SELECT count(*)::INTEGER FROM public.wholesale_order_revisions WHERE order_id=$1) AS revisions,
    (SELECT count(*)::INTEGER FROM public.wholesale_order_events WHERE order_id=$1) AS events`, [request.id]);
  await assert.rejects(createExpectedRevisionProposal(
    request.id, current.rows[0].current_revision_id, [{ productId: 'p2', quantity: 1 }], randomUUID(), adminActor, null, 'x'.repeat(1001),
  ), /WHOLESALE_INVALID_REQUEST/);
  const after = await db.query(`SELECT (SELECT count(*)::INTEGER FROM public.wholesale_order_revisions WHERE order_id=$1) AS revisions,
    (SELECT count(*)::INTEGER FROM public.wholesale_order_events WHERE order_id=$1) AS events`, [request.id]);
  assert.deepEqual(after.rows[0], before.rows[0]);
});

test('cancellation preserves event history and confirmation creates no sale, payment, or stock effect', async () => {
  const request = await createOrder(customer1, [{ productId: 'p2', quantity: 3 }]);
  const actor = adminActor;
  await db.query('SELECT public.start_wholesale_order_review($1,$2)', [request.id, actor]);
  const current = await db.query('SELECT current_revision_id FROM public.wholesale_orders WHERE id=$1', [request.id]);
  await db.query('SELECT public.confirm_wholesale_order_revision($1,$2,$3)', [request.id, current.rows[0].current_revision_id, actor]);
  await db.query("SELECT public.close_wholesale_order($1,'cancel',$2,'Cancelado antes de preparar')", [request.id, actor]);
  const events = await db.query('SELECT event_type FROM public.wholesale_order_events WHERE order_id=$1 ORDER BY id', [request.id]);
  assert.deepEqual(events.rows.map(row => row.event_type), ['order_created','revision_created','review_started','order_confirmed','order_cancelled']);
  const stock = await db.query("SELECT stock FROM public.products WHERE id='p2'");
  assert.equal(stock.rows[0].stock, 7);
  for (const table of ['sales','payment_transactions','inventory_movements','inventory_reservations']) {
    const rows = await db.query(`SELECT count(*)::INTEGER AS count FROM public.${table}`);
    assert.equal(rows.rows[0].count, 0, `${table} remains untouched`);
  }
});

test('wholesale tables deny direct client access and only service_role can execute workflow RPCs', async () => {
  const permissions = await db.query(`SELECT
    has_table_privilege('anon','public.wholesale_orders','SELECT') AS anon_select,
    has_table_privilege('authenticated','public.wholesale_orders','SELECT') AS authenticated_select,
    has_table_privilege('service_role','public.wholesale_orders','SELECT') AS service_select,
    has_table_privilege('service_role','public.wholesale_orders','INSERT') AS service_insert,
    has_function_privilege('anon','public.create_wholesale_order(uuid,jsonb,uuid)','EXECUTE') AS anon_exec,
    has_function_privilege('authenticated','public.create_wholesale_order(uuid,jsonb,uuid)','EXECUTE') AS authenticated_exec,
    has_function_privilege('service_role','public.create_wholesale_order(uuid,jsonb,uuid)','EXECUTE') AS service_exec,
    has_function_privilege('anon','public.reject_wholesale_order_revision_portal(uuid,uuid,uuid)','EXECUTE') AS anon_reject_exec,
    has_function_privilege('authenticated','public.reject_wholesale_order_revision_portal(uuid,uuid,uuid)','EXECUTE') AS authenticated_reject_exec,
    has_function_privilege('service_role','public.reject_wholesale_order_revision_portal(uuid,uuid,uuid)','EXECUTE') AS service_reject_exec`);
  assert.deepEqual(permissions.rows[0], {
    anon_select: false, authenticated_select: false, service_select: true, service_insert: false,
    anon_exec: false, authenticated_exec: false, service_exec: true,
    anon_reject_exec: false, authenticated_reject_exec: false, service_reject_exec: true,
  });
});

test('wholesale session helper returns customer identity only after full server-side session validation', async () => {
  const token = 'a'.repeat(64);
  const updatedAt = '2026-10-08T00:00:00.000Z';
  const { hashWholesaleSessionToken } = load('lib/wholesale-access.ts');
  const session = { token_hash: hashWholesaleSessionToken(token), customer_id: customer1,
    wholesale_code_updated_at: updatedAt, expires_at: new Date(Date.now() + 60_000).toISOString() };
  const customer = { wholesale_enabled: true, wholesale_access_active: true, archived_at: null, wholesale_code_updated_at: updatedAt };
  const db = { from: table => {
    let column = '', value = '';
    return { select() { return this; }, eq(key, next) { column = key; value = next; return this; }, maybeSingle: async () => {
      if (table === 'wholesale_access_sessions') return { data: value === hashWholesaleSessionToken(token) ? session : null, error: null };
      return { data: column === 'id' && value === session.customer_id ? customer : null, error: null };
    } };
  } };
  const server = load('lib/wholesale-server.ts', {
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => db },
    '@/lib/product-taxonomy': { normalizeCommercialClassification: value => ({ category: value, functions: [] }) },
    'next/headers': { cookies: async () => ({ get: () => ({ value: token }) }) },
  });
  assert.equal(await server.getWholesaleSessionCustomerId(), customer1);
  assert.equal(await server.isWholesaleSessionValid(), true);
  assert.equal(await server.getWholesaleSessionCustomerId('b'.repeat(64)), null);
});
