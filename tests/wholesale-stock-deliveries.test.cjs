/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

const migrations = [
  '20261008020000_wholesale_orders_base.sql',
  '20261011010000_wholesale_revision_expected.sql',
  '20261012010000_wholesale_customer_proposal_responses.sql',
  '20261013010000_wholesale_stock_deliveries.sql',
  '20261014010000_wholesale_delivery_corrections_payments.sql',
  '20261015010000_wholesale_sale_recognition.sql',
  '20261016010000_wholesale_accounting_journal.sql',
  '20261017010000_wholesale_financial_account_postings.sql',
  '20261018010000_financial_accounts_and_payment_presentation.sql',
].map(file => fs.readFileSync(`supabase/migrations/${file}`, 'utf8'));
let db;
let customer;
let admin;
let seller;

before(async () => {
  db = new PGlite(); customer = randomUUID(); admin = randomUUID(); seller = randomUUID();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE FUNCTION public.sha256(p_input BYTEA) RETURNS BYTEA LANGUAGE SQL IMMUTABLE AS $$ SELECT decode(md5(p_input)||md5(p_input||decode('00','hex')),'hex') $$;
    CREATE TABLE public.site_settings(id INTEGER PRIMARY KEY DEFAULT 1);
    CREATE TABLE public.customers(id UUID PRIMARY KEY,wholesale_enabled BOOLEAN DEFAULT TRUE,wholesale_access_active BOOLEAN DEFAULT TRUE,archived_at TIMESTAMPTZ);
    CREATE TABLE public.admin_profiles(id UUID PRIMARY KEY,role TEXT,active BOOLEAN DEFAULT TRUE);
    CREATE TABLE public.products(id VARCHAR(64) PRIMARY KEY,name VARCHAR(255),category TEXT,connector_type TEXT,wholesale_price NUMERIC(12,2),cost_price NUMERIC(12,2),stock INTEGER DEFAULT 7,active BOOLEAN DEFAULT TRUE,show_in_catalog BOOLEAN DEFAULT TRUE);
    CREATE TABLE public.sales(id UUID PRIMARY KEY); CREATE TABLE public.payment_transactions(id UUID PRIMARY KEY); CREATE TABLE public.inventory_movements(id UUID PRIMARY KEY); CREATE TABLE public.inventory_reservations(id UUID PRIMARY KEY);
    CREATE TABLE public.financial_accounts(id VARCHAR(40) PRIMARY KEY,name TEXT,account_type TEXT,active BOOLEAN DEFAULT TRUE,sort_order INTEGER DEFAULT 0);
    CREATE TABLE public.financial_periods(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),name TEXT,starts_at TIMESTAMPTZ NOT NULL,ends_at TIMESTAMPTZ,status TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT now(),closed_at TIMESTAMPTZ);
    CREATE UNIQUE INDEX financial_periods_one_open ON public.financial_periods(status) WHERE status='open';
    CREATE TABLE public.financial_activation(singleton BOOLEAN PRIMARY KEY,activated_at TIMESTAMPTZ NOT NULL,initial_period_id UUID,activation_key UUID);
    CREATE TABLE public.financial_operation_requests(idempotency_key UUID PRIMARY KEY,operation_type VARCHAR(32),result_id UUID,created_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE public.cash_movements(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),movement_type VARCHAR(24),amount NUMERIC(12,2),occurred_at TIMESTAMPTZ DEFAULT now(),description TEXT DEFAULT '',sale_id UUID REFERENCES public.sales(id),created_at TIMESTAMPTZ DEFAULT now(),account_id VARCHAR(40) REFERENCES public.financial_accounts(id),period_id UUID REFERENCES public.financial_periods(id),transfer_id UUID,idempotency_key UUID);
    INSERT INTO public.financial_accounts(id,name,account_type) VALUES('cash','Efectivo','cash'),('mercadopago','Mercado Pago','wallet'),('bank','Banco','bank');
    INSERT INTO public.customers(id) VALUES('${customer}');
    INSERT INTO public.admin_profiles(id,role) VALUES('${admin}','ADMIN'),('${seller}','VENDEDOR');
    INSERT INTO public.products(id,name,wholesale_price) VALUES('p1','LÃƒÂ¡mpara',100),('p2','Faro',200),('p3','CorrecciÃƒÂ³n',100),('p4','DevoluciÃƒÂ³n',100),('p5','Pagos',100),('p6','Snapshot mayorista',123.45);`);
  for (const migration of migrations) await db.exec(migration);
});
after(async () => { await db?.close(); });

async function createOrder(entries) {
  const result = await db.query('SELECT public.create_wholesale_order($1,$2::jsonb,$3) id',[customer,JSON.stringify(entries),randomUUID()]);
  const id=result.rows[0].id;
  await db.query('SELECT public.start_wholesale_order_review($1,$2)',[id,admin]);
  const revision=await db.query('SELECT current_revision_id FROM public.wholesale_orders WHERE id=$1',[id]);
  return { id, revisionId: revision.rows[0].current_revision_id };
}
async function confirm(order) { await db.query('SELECT public.confirm_wholesale_order_revision($1,$2,$3)',[order.id,order.revisionId,admin]); }
async function movement(product,type,quantity,key=randomUUID()) {
  return db.query('SELECT public.record_wholesale_stock_movement($1,$2,$3,$4,$5,$6)',[product,type,quantity,'Ajuste de prueba',key,admin]);
}
async function deliver(order,entries,key=randomUUID()) {
  return db.query('SELECT public.record_wholesale_delivery($1,$2,$3::jsonb,$4,$5) id',[order.id,order.revisionId,JSON.stringify(entries),key,admin]);
}

test('wholesale stock is independent, confirmation reserves its snapshot and repeated partial delivery completes once', async () => {
  const order=await createOrder([{productId:'p1',quantity:4}]);
  await assert.rejects(confirm(order),/WHOLESALE_INSUFFICIENT_STOCK/);
  await movement('p1','receipt',6);
  await confirm(order); await confirm(order);
  const key=randomUUID();
  const first=await deliver(order,[{productId:'p1',quantity:2}],key);
  const retry=await deliver(order,[{productId:'p1',quantity:2}],key);
  assert.equal(first.rows[0].id,retry.rows[0].id);
  await assert.rejects(deliver(order,[{productId:'p1',quantity:1}],key),/WHOLESALE_IDEMPOTENCY_CONFLICT/);
  await assert.rejects(deliver(order,[{productId:'p1',quantity:3}]),/WHOLESALE_DELIVERY_QUANTITY_INVALID/);
  await deliver(order,[{productId:'p1',quantity:2}]);
  const balance=await db.query("SELECT sum(on_hand_delta)::int on_hand,sum(reserved_delta)::int reserved FROM public.wholesale_inventory_movements WHERE product_id='p1'");
  assert.deepEqual(balance.rows[0],{on_hand:2,reserved:0});
  const marker=await db.query("SELECT count(*)::int count FROM public.wholesale_order_events WHERE order_id=$1 AND event_type='order_fully_delivered'",[order.id]);
  assert.equal(marker.rows[0].count,1);
  const retail=await db.query("SELECT stock FROM public.products WHERE id='p1'"); assert.equal(retail.rows[0].stock,7);
});


test('cancellation releases remaining hold, immutable history and ADMIN boundary are enforced', async () => {
  await assert.rejects(db.query('SELECT public.record_wholesale_stock_movement($1,$2,$3,$4,$5,$6)', ['p2','receipt',5,'Ajuste',randomUUID(),seller]),/WHOLESALE_ADMIN_REQUIRED/);
  await movement('p2','receipt',8);
  const order=await createOrder([{productId:'p2',quantity:5}]); await confirm(order);
  await deliver(order,[{productId:'p2',quantity:2}]);
  await db.query("SELECT public.close_wholesale_order($1,'cancel',$2,'')",[order.id,admin]);
  await db.query("SELECT public.close_wholesale_order($1,'cancel',$2,'')",[order.id,admin]);
  const balance=await db.query("SELECT sum(on_hand_delta)::int on_hand,sum(reserved_delta)::int reserved FROM public.wholesale_inventory_movements WHERE product_id='p2'");
  assert.deepEqual(balance.rows[0],{on_hand:6,reserved:0});
  await assert.rejects(db.query("UPDATE public.wholesale_inventory_movements SET reason='tamper' WHERE product_id='p2'"),/WHOLESALE_HISTORY_IMMUTABLE/);
  const permissions=await db.query(`SELECT has_function_privilege('anon','public.record_wholesale_delivery(uuid,uuid,jsonb,uuid,uuid)','EXECUTE') anon_exec,
    has_function_privilege('authenticated','public.record_wholesale_delivery(uuid,uuid,jsonb,uuid,uuid)','EXECUTE') auth_exec,
    has_function_privilege('service_role','public.record_wholesale_delivery(uuid,uuid,jsonb,uuid,uuid)','EXECUTE') service_exec`);
  assert.deepEqual(permissions.rows[0],{anon_exec:false,auth_exec:false,service_exec:true});
});

test('an erroneous delivery correction is append-only, restores the reservation, and reverses completion until redelivery', async () => {
  await movement('p3','receipt',10);
  const order=await createOrder([{productId:'p3',quantity:5}]); await confirm(order);
  const delivered=await deliver(order,[{productId:'p3',quantity:5}]);
  const deliveryId=delivered.rows[0].id;
  const correctionKey=randomUUID();
  const correction=await db.query('SELECT public.record_wholesale_delivery_correction($1,$2,$3::jsonb,$4,$5,$6) id',[
    order.id,deliveryId,JSON.stringify([{productId:'p3',quantity:2}]),'Se registraron dos unidades por error',correctionKey,admin,
  ]);
  const retry=await db.query('SELECT public.record_wholesale_delivery_correction($1,$2,$3::jsonb,$4,$5,$6) id',[
    order.id,deliveryId,JSON.stringify([{productId:'p3',quantity:2}]),'Se registraron dos unidades por error',correctionKey,admin,
  ]);
  assert.equal(correction.rows[0].id,retry.rows[0].id);
  await assert.rejects(db.query('SELECT public.record_wholesale_delivery_correction($1,$2,$3::jsonb,$4,$5,$6)',[
    order.id,deliveryId,JSON.stringify([{productId:'p3',quantity:4}]),'Excede lo entregado',randomUUID(),admin,
  ]),/WHOLESALE_CORRECTION_QUANTITY_INVALID/);
  const history=await db.query("SELECT event_type FROM public.wholesale_order_events WHERE order_id=$1 AND event_type IN ('order_fully_delivered','order_delivery_completion_reversed') ORDER BY id",[order.id]);
  assert.deepEqual(history.rows.map(row=>row.event_type),['order_fully_delivered','order_delivery_completion_reversed']);
  const balance=await db.query("SELECT sum(on_hand_delta)::int on_hand,sum(reserved_delta)::int reserved FROM public.wholesale_inventory_movements WHERE product_id='p3'");
  assert.deepEqual(balance.rows[0],{on_hand:7,reserved:2});
  await deliver(order,[{productId:'p3',quantity:2}]);
  const completion=await db.query("SELECT count(*)::int count FROM public.wholesale_order_events WHERE order_id=$1 AND event_type='order_fully_delivered'",[order.id]);
  assert.equal(completion.rows[0].count,2);
  const corrected=await db.query('SELECT count(*)::int count FROM public.wholesale_delivery_corrections WHERE delivery_id=$1',[deliveryId]);
  assert.equal(corrected.rows[0].count,1);
});

test('physical returns are distinct from delivery corrections and are limited to returned delivered units', async () => {
  await movement('p4','receipt',6);
  const order=await createOrder([{productId:'p4',quantity:3}]); await confirm(order);
  const delivery=await deliver(order,[{productId:'p4',quantity:3}]);
  const key=randomUUID();
  const returned=await db.query('SELECT public.record_wholesale_physical_return($1,$2,$3::jsonb,$4,$5,$6) id',[
    order.id,delivery.rows[0].id,JSON.stringify([{productId:'p4',quantity:1}]),'MercaderÃƒÂ­a recibida en depÃƒÂ³sito',key,admin,
  ]);
  await db.query('SELECT public.record_wholesale_physical_return($1,$2,$3::jsonb,$4,$5,$6)',[
    order.id,delivery.rows[0].id,JSON.stringify([{productId:'p4',quantity:1}]),'MercaderÃƒÂ­a recibida en depÃƒÂ³sito',key,admin,
  ]);
  assert.ok(returned.rows[0].id);
  await assert.rejects(db.query('SELECT public.record_wholesale_physical_return($1,$2,$3::jsonb,$4,$5,$6)',[
    order.id,delivery.rows[0].id,JSON.stringify([{productId:'p4',quantity:3}]),'Cantidad excesiva',randomUUID(),admin,
  ]),/WHOLESALE_RETURN_QUANTITY_INVALID/);
  const movementTypes=await db.query("SELECT movement_type FROM public.wholesale_inventory_movements WHERE delivery_id=$1 ORDER BY created_at",[delivery.rows[0].id]);
  assert.deepEqual(movementTypes.rows.map(row=>row.movement_type),['delivery','physical_return']);
  const completion=await db.query("SELECT count(*)::int count FROM public.wholesale_order_events WHERE order_id=$1 AND event_type='order_fully_delivered'",[order.id]);
  assert.equal(completion.rows[0].count,1);
});

test('partial wholesale payments, linked refunds, reconciliation, ADMIN permissions, and amount guards are append-only', async () => {
  await movement('p5','receipt',10);
  const order=await createOrder([{productId:'p5',quantity:4}]); await confirm(order);
  const now='2026-10-11T12:00:00.000Z';
  const charge1args=[order.id,order.revisionId,200,'ARS','bank_transfer','TRF-1',now,randomUUID(),admin];
  const charge1=await db.query('SELECT public.record_wholesale_payment($1,$2,$3,$4,$5,$6,$7,$8,$9) id',charge1args);
  const charge1Retry=await db.query('SELECT public.record_wholesale_payment($1,$2,$3,$4,$5,$6,$7,$8,$9) id',charge1args);
  assert.equal(charge1.rows[0].id,charge1Retry.rows[0].id);
  const charge2args=[order.id,order.revisionId,200,'ARS','cash',null,now,randomUUID(),admin];
  await db.query('SELECT public.record_wholesale_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)',charge2args);
  await assert.rejects(db.query('SELECT public.record_wholesale_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)',[
    order.id,order.revisionId,1,'ARS','cash',null,now,randomUUID(),admin,
  ]),/WHOLESALE_PAYMENT_EXCEEDS_TOTAL/);
  await assert.rejects(db.query('SELECT public.record_wholesale_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)',[
    order.id,order.revisionId,1,'ARS','cash',null,now,randomUUID(),seller,
  ]),/WHOLESALE_ADMIN_REQUIRED/);
  await assert.rejects(db.query('SELECT public.record_wholesale_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)',[
    order.id,order.revisionId,0,'ARS','cash',null,now,randomUUID(),admin,
  ]),/WHOLESALE_INVALID_PAYMENT/);
  const payment=await db.query('SELECT id FROM public.wholesale_payment_entries WHERE entry_type=\'payment\' ORDER BY created_at LIMIT 1');
  const refundKey=randomUUID();
  const refundArgs=[payment.rows[0].id,50,'bank_transfer','RF-1',now,refundKey,admin];
  const refund=await db.query('SELECT public.refund_wholesale_payment($1,$2,$3,$4,$5,$6,$7) id',refundArgs);
  const refundRetry=await db.query('SELECT public.refund_wholesale_payment($1,$2,$3,$4,$5,$6,$7) id',refundArgs);
  assert.equal(refund.rows[0].id,refundRetry.rows[0].id);
  await assert.rejects(db.query('SELECT public.refund_wholesale_payment($1,$2,$3,$4,$5,$6,$7)',[
    payment.rows[0].id,151,'cash',null,now,randomUUID(),admin,
  ]),/WHOLESALE_REFUND_EXCEEDS_PAYMENT/);
  const reconcileKey=randomUUID();
  const reconciliation=await db.query("SELECT public.record_wholesale_payment_reconciliation($1,'reconciled',$2,$3,$4) id",[charge1.rows[0].id,'Conciliado con extracto',reconcileKey,admin]);
  const reconcileRetry=await db.query("SELECT public.record_wholesale_payment_reconciliation($1,'reconciled',$2,$3,$4) id",[charge1.rows[0].id,'Conciliado con extracto',reconcileKey,admin]);
  assert.equal(reconciliation.rows[0].id,reconcileRetry.rows[0].id);
  const entries=await db.query('SELECT entry_type,amount,refund_of FROM public.wholesale_payment_entries WHERE order_id=$1 ORDER BY created_at',[order.id]);
  assert.equal(entries.rows.length,3);
  assert.deepEqual(entries.rows.map(row=>row.entry_type),['payment','payment','refund']);
  assert.equal(entries.rows[2].refund_of,payment.rows[0].id);
  const retail=await db.query('SELECT (SELECT count(*)::int FROM public.sales) sales,(SELECT count(*)::int FROM public.payment_transactions) payments');
  assert.deepEqual(retail.rows[0],{sales:0,payments:0});
});

test('wholesale revenue is recognized only on full delivery using confirmed historical item snapshots', async () => {
  await movement('p6','receipt',4);
  const order=await createOrder([{productId:'p6',quantity:2}]); await confirm(order);
  await db.query("UPDATE public.products SET wholesale_price=999.99,name='Nombre actual' WHERE id='p6'");
  await deliver(order,[{productId:'p6',quantity:1}]);
  let recognized=await db.query('SELECT count(*)::int count FROM public.wholesale_sale_recognitions WHERE order_id=$1',[order.id]);
  assert.equal(recognized.rows[0].count,0);
  const finalKey=randomUUID();
  const final=await deliver(order,[{productId:'p6',quantity:1}],finalKey);
  const retry=await deliver(order,[{productId:'p6',quantity:1}],finalKey);
  assert.equal(final.rows[0].id,retry.rows[0].id);
  const result=await db.query(`SELECT r.amount::text amount,r.currency,i.product_name_snapshot,i.quantity,i.unit_price::text unit_price,i.line_total::text line_total
    FROM public.wholesale_sale_recognitions r JOIN public.wholesale_sale_recognition_items i ON i.recognition_id=r.id WHERE r.order_id=$1`,[order.id]);
  assert.deepEqual(result.rows,[{amount:'246.90',currency:'ARS',product_name_snapshot:'Snapshot mayorista',quantity:2,unit_price:'123.45',line_total:'246.90'}]);
  const deliveryLinks=await db.query('SELECT count(*)::int count,sum(quantity)::int quantity FROM public.wholesale_sale_recognition_deliveries WHERE recognition_id=(SELECT id FROM public.wholesale_sale_recognitions WHERE order_id=$1)',[order.id]);
  assert.deepEqual(deliveryLinks.rows[0],{count:2,quantity:2});
  assert.equal((await db.query("SELECT count(*)::int count FROM public.wholesale_order_events WHERE order_id=$1 AND event_type='order_fully_delivered'",[order.id])).rows[0].count,1);
  const retail=await db.query('SELECT (SELECT count(*)::int FROM public.sales) sales,(SELECT count(*)::int FROM public.payment_transactions) payments');
  assert.deepEqual(retail.rows[0],{sales:0,payments:0});
});

test('delivery correction reverses one recognition and redelivery creates a new one', async () => {
  await movement('p6','receipt',2);
  const order=await createOrder([{productId:'p6',quantity:1}]); await confirm(order);
  const delivery=await deliver(order,[{productId:'p6',quantity:1}]);
  const deliveryId=delivery.rows[0].id;
  let rows=await db.query('SELECT id,completion_event_id FROM public.wholesale_sale_recognitions WHERE order_id=$1',[order.id]);
  assert.equal(rows.rows.length,1);
  const recognitionId=rows.rows[0].id;
  const correctionArgs=[order.id,deliveryId,JSON.stringify([{productId:'p6',quantity:1}]),'CorrecciÃ³n de prueba',randomUUID(),admin];
  const correction=await db.query('SELECT public.record_wholesale_delivery_correction($1,$2,$3::jsonb,$4,$5,$6) id',correctionArgs);
  const correctionRetry=await db.query('SELECT public.record_wholesale_delivery_correction($1,$2,$3::jsonb,$4,$5,$6) id',correctionArgs);
  assert.equal(correction.rows[0].id,correctionRetry.rows[0].id);
  let reversal=await db.query('SELECT recognition_id,amount::text amount,reversal_event_id FROM public.wholesale_sale_reversals WHERE order_id=$1',[order.id]);
  assert.equal(reversal.rows.length,1); assert.equal(reversal.rows[0].recognition_id,recognitionId); assert.equal(reversal.rows[0].amount,'999.99');
  assert.equal((await db.query("SELECT count(*)::int count FROM public.wholesale_accounting_journals WHERE order_id=$1 AND source_type='sale_reversal'",[order.id])).rows[0].count,1);
  await deliver(order,[{productId:'p6',quantity:1}]);
  rows=await db.query('SELECT id,completion_event_id FROM public.wholesale_sale_recognitions WHERE order_id=$1 ORDER BY completion_event_id',[order.id]);
  assert.equal(rows.rows.length,2); assert.notEqual(rows.rows[0].completion_event_id,rows.rows[1].completion_event_id);
  assert.equal((await db.query("SELECT count(*)::int count FROM public.wholesale_accounting_journals WHERE order_id=$1 AND source_type='sale_recognition'",[order.id])).rows[0].count,2);
  assert.equal((await db.query('SELECT count(*)::int count FROM public.wholesale_sale_reversals WHERE order_id=$1',[order.id])).rows[0].count,1);
});

test('recognition failure rolls back delivery, inventory movement and completion event atomically', async () => {
  await movement('p6','receipt',1);
  const order=await createOrder([{productId:'p6',quantity:1}]); await confirm(order);
  await db.exec("CREATE FUNCTION public.fail_wholesale_recognition_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected recognition failure'; END $$; CREATE TRIGGER fail_wholesale_recognition_insert BEFORE INSERT ON public.wholesale_sale_recognitions FOR EACH ROW EXECUTE FUNCTION public.fail_wholesale_recognition_insert()");
  await assert.rejects(deliver(order,[{productId:'p6',quantity:1}]),/injected recognition failure/);
  await db.exec('DROP TRIGGER fail_wholesale_recognition_insert ON public.wholesale_sale_recognitions; DROP FUNCTION public.fail_wholesale_recognition_insert()');
  assert.equal((await db.query('SELECT count(*)::int count FROM public.wholesale_deliveries WHERE order_id=$1',[order.id])).rows[0].count,0);
  assert.equal((await db.query("SELECT count(*)::int count FROM public.wholesale_order_events WHERE order_id=$1 AND event_type='order_fully_delivered'",[order.id])).rows[0].count,0);
  assert.equal((await db.query("SELECT count(*)::int count FROM public.wholesale_inventory_movements WHERE order_id=$1 AND movement_type='delivery'",[order.id])).rows[0].count,0);
  await deliver(order,[{productId:'p6',quantity:1}]);
  assert.equal((await db.query('SELECT count(*)::int count FROM public.wholesale_sale_recognitions WHERE order_id=$1',[order.id])).rows[0].count,1);
});

test('only ADMIN can cause a delivery that enters the recognition flow', async () => {
  await movement('p6','receipt',1);
  const order=await createOrder([{productId:'p6',quantity:1}]); await confirm(order);
  await assert.rejects(db.query('SELECT public.record_wholesale_delivery($1,$2,$3::jsonb,$4,$5)',[
    order.id,order.revisionId,JSON.stringify([{productId:'p6',quantity:1}]),randomUUID(),seller,
  ]),/WHOLESALE_ADMIN_REQUIRED/);
  assert.equal((await db.query('SELECT count(*)::int count FROM public.wholesale_sale_recognitions WHERE order_id=$1',[order.id])).rows[0].count,0);
});
test('wholesale recognition is service-read-only and separate from retail financial postings', async () => {
  const privileges=await db.query(`SELECT
    has_table_privilege('anon','public.wholesale_sale_recognitions','SELECT') anon_read,
    has_table_privilege('authenticated','public.wholesale_sale_recognitions','INSERT') customer_insert,
    has_table_privilege('service_role','public.wholesale_sale_recognitions','SELECT') service_read,
    has_table_privilege('service_role','public.wholesale_sale_recognitions','INSERT') service_insert`);
  assert.deepEqual(privileges.rows[0],{anon_read:false,customer_insert:false,service_read:true,service_insert:false});
});

test('wholesale accounting journal balances recognition, payments, refunds and reversals without retail postings', async () => {
  const now='2026-10-11T12:00:00.000Z';
  const order=await createOrder([{productId:'p6',quantity:2}]);
  await movement('p6','receipt',2); await confirm(order);
  const earlyPay=await db.query("SELECT public.record_wholesale_payment($1,$2,25,'ARS','cash',NULL,$3,$4,$5) id",[order.id,order.revisionId,now,randomUUID(),admin]);
  let journals=await db.query('SELECT source_type,status,amount::text amount FROM public.wholesale_accounting_journals WHERE order_id=$1 ORDER BY created_at',[order.id]);
  assert.deepEqual(journals.rows.map(row=>row.source_type),['payment']);
  assert.equal(journals.rows[0].status,'awaiting_account_mapping');
  const delivery=await deliver(order,[{productId:'p6',quantity:2}]);
  journals=await db.query(`SELECT j.source_type,j.status,j.amount::text amount,
    sum(l.debit)::text debit,sum(l.credit)::text credit
    FROM public.wholesale_accounting_journals j JOIN public.wholesale_accounting_journal_lines l ON l.journal_id=j.id
    WHERE j.order_id=$1 GROUP BY j.id ORDER BY j.source_type`,[order.id]);
  assert.equal(journals.rows.length,2);
  for(const journal of journals.rows){ assert.equal(journal.debit,journal.credit); assert.equal(journal.status,'awaiting_account_mapping'); }
  const payment=await db.query("SELECT public.record_wholesale_payment($1,$2,25,'ARS','cash',NULL,$3,$4,$5) id",[order.id,order.revisionId,now,randomUUID(),admin]);
  const refund=await db.query("SELECT public.refund_wholesale_payment($1,5,'cash',NULL,$2,$3,$4) id",[payment.rows[0].id,now,randomUUID(),admin]);
  await db.query("SELECT public.set_wholesale_accounting_mapping('accounts_receivable','ARS',NULL,'TEST-AR',$1)",[admin]);
  await db.query("SELECT public.set_wholesale_accounting_mapping('sales_revenue','ARS',NULL,'TEST-REV',$1)",[admin]);
  await db.query("SELECT public.set_wholesale_accounting_mapping('customer_advances','ARS',NULL,'TEST-ADV',$1)",[admin]);
  await db.query("SELECT public.set_wholesale_accounting_mapping('cash_clearing','ARS','cash','TEST-CASH',$1)",[admin]);
  const status=await db.query('SELECT source_type,status FROM public.wholesale_accounting_journals WHERE order_id=$1 ORDER BY source_type,created_at',[order.id]);
  assert.ok(status.rows.every(row=>row.status==='ready'));
  const imbalance=await db.query(`SELECT count(*)::int count FROM (
    SELECT journal_id FROM public.wholesale_accounting_journal_lines GROUP BY journal_id
    HAVING sum(debit)<>sum(credit)
  ) q`);
  assert.equal(imbalance.rows[0].count,0);
  await assert.rejects(db.query("SELECT public.set_wholesale_accounting_mapping('sales_revenue','ARS',NULL,'BAD',$1)",[seller]),/WHOLESALE_ADMIN_REQUIRED/);
  const retail=await db.query('SELECT (SELECT count(*)::int FROM public.sales) sales,(SELECT count(*)::int FROM public.payment_transactions) payments');
  assert.deepEqual(retail.rows[0],{sales:0,payments:0});
  assert.ok(delivery.rows[0].id); assert.ok(earlyPay.rows[0].id); assert.ok(refund.rows[0].id);
});

test('wholesale payments and refunds post once to mapped DCL accounts and period closing carries their balances', async () => {
  const period=randomUUID();
  await movement('p5','receipt',20);
  const order=await createOrder([{productId:'p5',quantity:10}]); await confirm(order);
  const beforeActivation=await db.query('SELECT public.record_wholesale_payment($1,$2,15,\'ARS\',$3,NULL,$4,$5,$6) id',[order.id,order.revisionId,'cash',new Date(Date.now()-8000).toISOString(),randomUUID(),admin]);
  assert.equal((await db.query('SELECT status FROM public.wholesale_financial_postings WHERE payment_entry_id=$1',[beforeActivation.rows[0].id])).rows[0].status,'pending_period');
  const created=await db.query('SELECT created_at FROM public.wholesale_payment_entries WHERE id=$1',[beforeActivation.rows[0].id]);
  const activationTime=new Date(Date.parse(created.rows[0].created_at)+2000).toISOString();
  await db.query("INSERT INTO public.financial_periods(id,name,starts_at,status) VALUES($1,'PerÃ­odo actual',$2,'open')",[period,activationTime]);
  await db.query("INSERT INTO public.financial_activation(singleton,activated_at,initial_period_id,activation_key) VALUES(true,$1,$2,$3)",[activationTime,period,randomUUID()]);
  await db.exec("UPDATE public.financial_activation SET activated_at=clock_timestamp(); UPDATE public.financial_periods SET starts_at=clock_timestamp()-interval '1 second' WHERE id='"+period+"'");
  assert.equal((await db.query('SELECT status FROM public.wholesale_financial_postings WHERE payment_entry_id=$1',[beforeActivation.rows[0].id])).rows[0].status,'included_in_opening_balance');
  await db.query("INSERT INTO public.cash_movements(movement_type,amount,description,account_id,period_id) VALUES('opening_balance',15,'Saldo inicial','cash',$1),('opening_balance',0,'Saldo inicial','mercadopago',$1),('opening_balance',0,'Saldo inicial','bank',$1)",[period]);
  const paidAt=new Date(Date.now()-3000).toISOString(), paymentKey=randomUUID();
  const payment=await db.query('SELECT public.record_wholesale_payment($1,$2,100,\'ARS\',$3,NULL,$4,$5,$6) id',[order.id,order.revisionId,'cash',paidAt,paymentKey,admin]);
  const retry=await db.query('SELECT public.record_wholesale_payment($1,$2,100,\'ARS\',$3,NULL,$4,$5,$6) id',[order.id,order.revisionId,'cash',paidAt,paymentKey,admin]);
  assert.equal(payment.rows[0].id,retry.rows[0].id);
  assert.equal((await db.query('SELECT public.post_wholesale_financial_entry($1) status',[payment.rows[0].id])).rows[0].status,'posted');
  const initial=await db.query("SELECT sum(amount)::numeric balance FROM public.cash_movements WHERE period_id=$1 AND account_id='cash'",[period]);
  assert.equal(Number(initial.rows[0].balance),115);
  const refundAt=new Date(Date.now()-2000).toISOString();
  const refund=await db.query('SELECT public.refund_wholesale_payment($1,20,$2,NULL,$3,$4,$5) id',[payment.rows[0].id,'mercadopago',refundAt,randomUUID(),admin]);
  const balances=await db.query("SELECT account_id,sum(amount)::numeric balance FROM public.cash_movements WHERE period_id=$1 GROUP BY account_id ORDER BY account_id",[period]);
  assert.deepEqual(balances.rows.map(row=>[row.account_id,Number(row.balance)]),[['bank',0],['cash',115],['mercadopago',-20]]);
  const bridge=await db.query('SELECT movement_type,amount,sale_id,wholesale_payment_entry_id FROM public.cash_movements WHERE wholesale_payment_entry_id IN ($1,$2) ORDER BY movement_type',[payment.rows[0].id,refund.rows[0].id]);
  assert.equal(bridge.rows.length,2); assert.equal(bridge.rows.every(row=>row.sale_id===null),true);
  await assert.rejects(db.query('UPDATE public.cash_movements SET amount=0 WHERE wholesale_payment_entry_id=$1',[payment.rows[0].id]),/WHOLESALE_FINANCIAL_MOVEMENT_IMMUTABLE/);
  await assert.rejects(db.query('DELETE FROM public.cash_movements WHERE wholesale_payment_entry_id=$1',[payment.rows[0].id]),/WHOLESALE_FINANCIAL_MOVEMENT_IMMUTABLE/);
  assert.equal(Number((await db.query('SELECT count(*)::int count FROM public.sales')).rows[0].count),0);
  await assert.rejects(db.query('SELECT public.record_wholesale_payment($1,$2,1,\'ARS\',$3,NULL,$4,$5,$6)',[order.id,order.revisionId,'cash',paidAt,paymentKey,seller]),/WHOLESALE_ADMIN_REQUIRED|WHOLESALE_IDEMPOTENCY_CONFLICT/);
  await assert.rejects(db.query("SELECT public.set_wholesale_financial_account_mapping('bank_transfer','bank',$1)",[seller]),/WHOLESALE_ADMIN_REQUIRED/);

  const bankKey=randomUUID(), bankAt=new Date(Date.now()-1000).toISOString();
  const bankPayment=await db.query('SELECT public.record_wholesale_payment($1,$2,40,\'ARS\',$3,NULL,$4,$5,$6) id',[order.id,order.revisionId,'bank_transfer',bankAt,bankKey,admin]);
  const pending=await db.query('SELECT status FROM public.wholesale_financial_postings WHERE payment_entry_id=$1',[bankPayment.rows[0].id]);
  assert.equal(pending.rows[0].status,'pending_mapping');
  await assert.rejects(db.query("SELECT public.close_financial_period('Siguiente',false,$1)",[randomUUID()]),/WHOLESALE_FINANCIAL_POSTINGS_PENDING/);
  await db.query("SELECT public.set_wholesale_financial_account_mapping('bank_transfer','bank',$1)",[admin]);
  const mapped=await db.query('SELECT status,account_id,period_id FROM public.wholesale_financial_postings WHERE payment_entry_id=$1',[bankPayment.rows[0].id]);
  assert.deepEqual(mapped.rows[0],{status:'posted',account_id:'bank',period_id:period});
  assert.equal((await db.query('SELECT public.retry_wholesale_financial_postings($1) count',[admin])).rows[0].count,0);
  const closed=await db.query("SELECT public.close_financial_period('Siguiente',false,$1) id",[randomUUID()]);
  const carried=await db.query("SELECT account_id,amount FROM public.cash_movements WHERE period_id=$1 AND movement_type='opening_balance' ORDER BY account_id",[closed.rows[0].id]);
  assert.deepEqual(carried.rows.map(row=>[row.account_id,Number(row.amount)]),[['bank',40],['cash',115],['mercadopago',-20]]);
  await db.query("SELECT public.set_wholesale_financial_account_mapping('cash','bank',$1)",[admin]);
  const unchanged=await db.query("SELECT account_id,amount FROM public.cash_movements WHERE wholesale_payment_entry_id=$1",[payment.rows[0].id]);
  assert.equal(unchanged.rows[0].account_id,'cash');
  await db.query("INSERT INTO public.wholesale_payment_entries(order_id,revision_id,entry_type,amount,currency,payment_method,occurred_at,idempotency_key,actor_id) VALUES($1,$2,'payment',1,'USD','other',clock_timestamp(),$3,$4)",[order.id,order.revisionId,randomUUID(),admin]);
  const unsupported=await db.query("SELECT payment_entry_id,status FROM public.wholesale_financial_postings WHERE status='unsupported_currency' ORDER BY payment_entry_id DESC LIMIT 1");
  assert.equal(unsupported.rows[0].status,'unsupported_currency');
  await assert.rejects(db.query("SELECT public.close_financial_period('No cerrar por moneda',false,$1)",[randomUUID()]),/WHOLESALE_FINANCIAL_POSTINGS_PENDING/);
});

test('financial accounts are ADMIN-managed, idempotent, historical-safe, and open with explicit ARS balance', async () => {
  const current=await db.query("SELECT id FROM public.financial_periods WHERE status='open'");
  const period=current.rows[0].id;
  assert.ok(period);
  const request=randomUUID();
  const created=await db.query("SELECT (public.manage_financial_account('create','bank_two','Banco Dos','bank',30,$1,$2,1234.50)).id id",[admin,request]);
  const retried=await db.query("SELECT (public.manage_financial_account('create','bank_two','Banco Dos','bank',30,$1,$2,1234.50)).id id",[admin,request]);
  assert.equal(created.rows[0].id,'bank_two'); assert.equal(retried.rows[0].id,'bank_two');
  await assert.rejects(db.query("SELECT public.manage_financial_account('create','bank_other','Banco Diferente','bank',30,$1,$2,1234.50)",[admin,request]),/FINANCIAL_ACCOUNT_IDEMPOTENCY_CONFLICT/);
  assert.equal(Number((await db.query("SELECT amount FROM public.cash_movements WHERE account_id='bank_two' AND movement_type='opening_balance'")).rows[0].amount),1234.5);
  assert.equal(Number((await db.query("SELECT count(*)::int count FROM public.financial_account_events WHERE account_id='bank_two'")).rows[0].count),1);
  await assert.rejects(db.query("SELECT public.manage_financial_account('create','bank_three','Banco Dos','bank',40,$1,$2,0)",[admin,randomUUID()]),/FINANCIAL_ACCOUNT_DUPLICATE_NAME/);
  await assert.rejects(db.query("SELECT public.manage_financial_account('create','bank_three','Banco Tres','bank',40,$1,$2,0)",[seller,randomUUID()]),/FINANCIAL_ADMIN_REQUIRED/);
  await assert.rejects(db.query("SELECT public.manage_financial_account('create','bank_three','Banco Tres','bank',40,$1,$2,-1)",[admin,randomUUID()]),/FINANCIAL_ACCOUNT_INVALID_REQUEST/);
  await assert.rejects(db.query("SELECT public.manage_financial_account('update','cash','Caja','bank',10,$1,$2,0)",[admin,randomUUID()]),/FINANCIAL_CORE_ACCOUNT_IMMUTABLE/);
  await assert.rejects(db.query("SELECT public.manage_financial_account('update','bank_two','Banco Modificado','wallet',35,$1,$2,0)",[admin,randomUUID()]),/FINANCIAL_ACCOUNT_HISTORY_IMMUTABLE/);
  await assert.rejects(db.query("SELECT public.manage_financial_account('deactivate','bank_two',NULL,NULL,NULL,$1,$2,NULL)",[admin,randomUUID()]),/FINANCIAL_ACCOUNT_NONZERO_BALANCE/);
  await db.query("INSERT INTO public.cash_movements(movement_type,amount,description,account_id,period_id,idempotency_key) VALUES('adjustment',-1234.50,'Prueba saldo cero','bank_two',$1,$2)",[period,randomUUID()]);
  const deactivationKey=randomUUID();
  await db.query("SELECT public.manage_financial_account('deactivate','bank_two',NULL,NULL,NULL,$1,$2,NULL)",[admin,deactivationKey]);
  await db.query("SELECT public.manage_financial_account('deactivate','bank_two',NULL,NULL,NULL,$1,$2,NULL)",[admin,deactivationKey]);
  assert.equal((await db.query("SELECT active FROM public.financial_accounts WHERE id='bank_two'")).rows[0].active,false);
  assert.equal(Number((await db.query("SELECT count(*)::int count FROM public.financial_account_events WHERE account_id='bank_two' AND event_type='deactivated'")).rows[0].count),1);
});
