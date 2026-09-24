/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./load-ts.cjs');
const migration = '20260923020000_order_customer_snapshots.sql';
const previous = '20260923010000_commercial_analytics_outbox.sql';
const cssPath = '@/app/admin/pedidos/[orderNumber]/comprobante/comprobante.module.css';
const styles = new Proxy({}, { get: (_, name) => name === '__esModule' ? false : name });
const cssMocks = { [cssPath]: styles, './comprobante.module.css': styles };
const plain = value => JSON.parse(JSON.stringify(value));
let db, legacy;
const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
const sqlFunction = file => fs.readFileSync('supabase/migrations/' + file, 'utf8').replace(/\r/g, '').match(/CREATE OR REPLACE FUNCTION public\.create_public_order\([\s\S]*?END \$\$;/)[0];
async function fixture(method = 'transfer', phone = `1500${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`) {
  const product = randomUUID(), key = randomUUID(), context = { distinct_id: randomUUID(), session_id: randomUUID() };
  await db.query("INSERT INTO products(id,name,slug,price,stock) VALUES($1,'Producto histórico local',$1,100.15,10)", [product]);
  const params = [' Nombre del pedido local ', phone, method, JSON.stringify([{ productId: product, quantity: 2 }]), key, JSON.stringify(context)];
  const sql = "SELECT create_public_order($1,$2,'','pickup','','',$3,$4::jsonb,$5,$6::jsonb,'production')";
  const order = await scalar(sql, params);
  const number = await scalar('SELECT order_number FROM orders WHERE id=$1', [order]);
  return { product, key, order, number, params, sql, context };
}
async function complete(f) {
  await scalar('SELECT declare_manual_transfer($1)', [f.order]);
  return scalar("SELECT complete_manual_transfer($1,'production')", [f.order]);
}
async function reverse(f, type) {
  return scalar('SELECT resolve_order($1,$2,$3,$4,$5)', [f.order, type, type === 'REFUND_VERIFIED' ? randomUUID() : null, 'Resolución local simulada', randomUUID()]);
}

// Supabase read interface backed exclusively by the in-memory PostgreSQL fixture.
// This adapter never loads .env, opens a socket or uses any remote service.
const reads = [];
function localReadClient() {
  return { from(table) {
    assert.ok(['orders', 'sales', 'sale_items', 'payment_transactions', 'order_resolutions'].includes(table));
    let columns, field, values, offset = 0, end = 499;
    const chain = {
      select(value) { columns = value; return chain; },
      in(key, input) { field = key; values = Array.from(input); return chain; },
      order() { return chain; },
      range(from, to) { offset = from; end = to; return chain; },
      then(resolve, reject) {
        reads.push({ table, columns, field });
        return db.query(`SELECT ${columns} FROM ${table} WHERE ${field}::text = ANY($1::text[]) ORDER BY id LIMIT $2 OFFSET $3`, [values, end - offset + 1, offset])
          // PostgREST transports JSON: timestamps arrive as strings, not pg Date objects.
          .then(({ rows }) => ({ data: plain(rows), error: null })).then(resolve, reject);
      },
    };
    return chain;
  } };
}
const helper = load('lib/store/order-receipt.ts', { '@/lib/supabase/server': { createAdminServerClient: localReadClient } });
const receipt = number => helper.getOrderReceipt(number);

before(async () => {
  db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;');
  for (const file of fs.readdirSync('supabase/migrations').filter(name => /^\d{14}_/.test(name) && !name.includes('storage_setup') && name < migration).sort()) {
    await db.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
  }
  // Local-only range: never even allocate DCL-000001 in the simulated database.
  await db.exec("ALTER SEQUENCE order_commercial_number_seq RESTART WITH 900001; INSERT INTO site_settings(id,transfer_alias,transfer_holder,transfer_institution) VALUES(1,'local.test','Test','Test') ON CONFLICT(id) DO UPDATE SET transfer_alias='local.test',transfer_holder='Test',transfer_institution='Test'; INSERT INTO financial_periods(name,status) VALUES('Local test only','open')");
  legacy = await fixture();
  await db.exec(fs.readFileSync('supabase/migrations/' + migration, 'utf8'));
});
after(async () => { await db?.close(); });

test('migration preserves exact latest 3A function except the two snapshot INSERT fields', () => {
  const updated = sqlFunction(migration)
    .replace('status,customer_name_snapshot,customer_phone_snapshot)', 'status)')
    .replace("END,btrim(p_name),btrim(p_phone));", 'END);');
  assert.equal(updated, sqlFunction(previous));
  const sql = fs.readFileSync('supabase/migrations/' + migration, 'utf8');
  assert.match(sql, /customer_name_snapshot VARCHAR\(160\)/); assert.match(sql, /customer_phone_snapshot VARCHAR\(50\)/);
  assert.doesNotMatch(sql, /UPDATE (?:public\.)?orders SET customer_|CREATE SEQUENCE|DROP FUNCTION/);
});

test('new order captures submitted name and phone, not the reused customer profile', async () => {
  const phone = '1500001122';
  await db.query("INSERT INTO customers(full_name,phone,archived_at) VALUES('Nombre anterior', $1, clock_timestamp())", [phone]);
  const f = await fixture('transfer', phone);
  const { rows: [order] } = await db.query('SELECT * FROM orders WHERE id=$1', [f.order]);
  assert.equal(order.customer_name_snapshot, 'Nombre del pedido local'); assert.equal(order.customer_phone_snapshot, phone);
  assert.equal(await scalar('SELECT full_name FROM customers WHERE id=$1', [order.customer_id]), 'Nombre anterior');
  assert.equal(await scalar('SELECT archived_at FROM customers WHERE id=$1', [order.customer_id]), null);
  assert.match(order.order_number, /^DCL-9/);
});

test('idempotent retry preserves snapshots, number, rows and outbox after customer edit', async () => {
  const f = await fixture();
  const sequence = await scalar('SELECT last_value FROM order_commercial_number_seq');
  await db.query("UPDATE customers SET full_name='Ficha editada',phone='9999999999' WHERE id=(SELECT customer_id FROM orders WHERE id=$1)", [f.order]);
  const args = [...f.params]; args[5] = JSON.stringify({ distinct_id: randomUUID() });
  assert.equal(await scalar(f.sql, args), f.order);
  assert.equal(await scalar('SELECT last_value FROM order_commercial_number_seq'), sequence);
  assert.equal(await scalar('SELECT count(*)::int FROM orders WHERE idempotency_key=$1', [f.key]), 1);
  assert.equal(await scalar('SELECT customer_name_snapshot FROM orders WHERE id=$1', [f.order]), 'Nombre del pedido local');
  assert.equal(await scalar('SELECT customer_phone_snapshot FROM orders WHERE id=$1', [f.order]), f.params[1]);
  const changed = [...args]; changed[0] = 'Otro nombre';
  await assert.rejects(scalar(f.sql, changed), /IDEMPOTENCY_CONFLICT/);
  assert.equal(await scalar('SELECT count(*)::int FROM analytics_outbox WHERE order_id=$1', [f.order]), 1);
  const stored = await scalar('SELECT properties FROM analytics_outbox WHERE order_id=$1', [f.order]);
  assert.doesNotMatch(JSON.stringify(stored), /snapshot|Nombre del pedido|9999999999|customer|phone/);
  assert.equal(await scalar('SELECT distinct_id FROM analytics_outbox WHERE order_id=$1', [f.order]), f.context.distinct_id);
});

test('snapshot trigger rejects changes/nulls but permits normal order updates and identical assignments', async () => {
  const f = await fixture();
  for (const column of ['customer_name_snapshot', 'customer_phone_snapshot']) {
    await assert.rejects(db.query(`UPDATE orders SET ${column}='alterado' WHERE id=$1`, [f.order]), /ORDER_CUSTOMER_SNAPSHOT_IMMUTABLE/);
    await assert.rejects(db.query(`UPDATE orders SET ${column}=NULL WHERE id=$1`, [f.order]), /ORDER_CUSTOMER_SNAPSHOT_IMMUTABLE/);
    await db.query(`UPDATE orders SET ${column}=${column} WHERE id=$1`, [f.order]);
  }
  await db.query("UPDATE orders SET notes='Nota interna de prueba' WHERE id=$1", [f.order]);
  await complete(f);
  await db.query("UPDATE orders SET operational_status='preparing' WHERE id=$1", [f.order]);
  assert.equal((await receipt(f.number)).status, 'ok');
  assert.equal(await scalar('SELECT customer_name_snapshot FROM orders WHERE id=$1', [f.order]), 'Nombre del pedido local');
});

test('historical rows remain null without backfill and cannot silently use current customer PII', async () => {
  assert.equal(await scalar('SELECT customer_name_snapshot FROM orders WHERE id=$1', [legacy.order]), null);
  assert.equal(await scalar('SELECT customer_phone_snapshot FROM orders WHERE id=$1', [legacy.order]), null);
  await assert.rejects(db.query("UPDATE orders SET customer_name_snapshot='Backfill' WHERE id=$1", [legacy.order]), /IMMUTABLE/);
  await complete(legacy);
  assert.equal((await receipt(legacy.number)).status, 'incident');
});

test('completed sale reads historical sale_items and snapshot; current catalog/customer edits have no effect', async () => {
  const f = await fixture(); const sale = await complete(f);
  await db.query("UPDATE products SET name='Nombre vivo cambiado',price=999,active=false WHERE id=$1", [f.product]);
  await db.query("UPDATE customers SET full_name='Cliente vivo cambiado' WHERE id=(SELECT customer_id FROM orders WHERE id=$1)", [f.order]);
  reads.length = 0;
  const result = await receipt(f.number);
  assert.equal(result.status, 'ok');
  assert.deepEqual(plain(result.receipt.items), [{ name: 'Producto histórico local', quantity: 2, unitPrice: 100.15, lineTotal: 200.3 }]);
  assert.equal(result.receipt.customerName, 'Nombre del pedido local'); assert.equal(result.receipt.total, 200.3);
  assert.equal(result.receipt.status, 'valid'); assert.equal(result.receipt.paymentStatus, 'Aprobado');
  assert.equal(result.receipt.maskedPhone, `•••• ${f.params[1].slice(-4)}`);
  assert.ok(!reads.some(r => ['customers', 'products', 'cash_movements'].includes(r.table)));
  assert.ok(reads.some(r => r.table === 'sale_items'));
  assert.doesNotMatch(JSON.stringify(result), new RegExp([f.order, f.product, sale, f.context.distinct_id, f.params[1]].join('|')));
  assert.doesNotMatch(JSON.stringify(result), /customer_id|sale_id|unit_cost|email|document|address|external_payment|snapshot|notes/);
  assert.deepEqual((await db.query('SELECT event_type FROM analytics_outbox WHERE order_id=$1 ORDER BY occurred_at,id', [f.order])).rows.map(r => r.event_type), ['order_created', 'payment_approved', 'purchase_completed']);
});

test('without a historical sale, pending/approved/stock-unavailable/refund-required/refunded cannot produce receipt', async () => {
  const f = await fixture();
  for (const [order, payment] of [['pending_manual_verification', 'pending'], ['stock_unavailable', 'approved'], ['refund_required', 'approved'], ['refunded', 'refunded']]) {
    await db.query('UPDATE orders SET status=$2 WHERE id=$1', [f.order, order]);
    await db.query('UPDATE payment_transactions SET status=$2 WHERE order_id=$1', [f.order, payment]);
    assert.equal((await receipt(f.number)).status, 'unavailable');
  }
});

test('REFUND_VERIFIED keeps original receipt, reports reliable resolution date and remains accessible when archived', async () => {
  const f = await fixture(); await complete(f); await reverse(f, 'REFUND_VERIFIED');
  await scalar('SELECT set_order_archived($1,true)', [f.order]);
  const result = await receipt(f.number);
  assert.equal(result.status, 'ok'); assert.equal(result.receipt.status, 'refunded');
  assert.equal(result.receipt.paymentStatus, 'Reembolsado'); assert.ok(result.receipt.resolvedAt);
  assert.equal(result.receipt.total, 200.3); assert.equal(result.receipt.items.length, 1);
  assert.equal((await helper.getOrderReceiptAvailability([f.number]))[f.number], true);
});

test('REFUND_STOCK_UNAVAILABLE with a recorded resolution and no sale stays unavailable', async () => {
  const f = await fixture('card');
  await db.query("UPDATE orders SET status='stock_unavailable' WHERE id=$1", [f.order]);
  await db.query("UPDATE payment_transactions SET status='approved' WHERE order_id=$1", [f.order]);
  await scalar('SELECT resolve_order($1,$2,$3,$4,$5)', [f.order, 'REFUND_STOCK_UNAVAILABLE', 'local-reference', 'Local test', randomUUID()]);
  assert.equal((await receipt(f.number)).status, 'unavailable');
});

test('TRANSFER_APPROVAL_ERROR keeps historical sale and is ANULADO, not REEMBOLSADO', async () => {
  const f = await fixture(); await complete(f); await reverse(f, 'TRANSFER_APPROVAL_ERROR');
  const result = await receipt(f.number);
  assert.equal(result.status, 'ok'); assert.equal(result.receipt.status, 'cancelled');
  assert.equal(result.receipt.paymentStatus, 'Cancelado'); assert.ok(result.receipt.resolvedAt);
  assert.equal(result.receipt.total, 200.3);
});

function validRecords() {
  const order = { id: randomUUID(), order_number: 'DCL-900999', customer_id: randomUUID(), status: 'completed', operational_status: 'received', payment_method: 'card', currency: 'ARS', subtotal: '200.30', total: '200.30', customer_name_snapshot: 'Nombre histórico', customer_phone_snapshot: '+54 9 000 111-2233' };
  const sale = { id: randomUUID(), customer_id: order.customer_id, status: 'completed', payment_method: 'mercadopago', subtotal: '200.30', total: '200.30', created_at: '2026-09-23T21:36:00Z', cancelled_at: null };
  const payment = { id: randomUUID(), order_id: order.id, sale_id: sale.id, status: 'approved', provider: 'mercadopago', amount: '200.30', currency: 'ARS' };
  const items = [{ id: randomUUID(), sale_id: sale.id, product_name: 'LED histórico', quantity: 2, unit_price: '100.15', line_total: '200.30' }];
  return { order, sale, payments: [payment], salePayments: [{ ...payment }], items, resolutions: [] };
}
test('stock completion resolution requires Mercado Pago, as resolve_order does', () => {
  const records = validRecords();
  records.resolutions = [{ order_id: records.order.id, payment_transaction_id: records.payments[0].id,
    sale_id: records.sale.id, resolution_type: 'COMPLETE_STOCK_UNAVAILABLE', created_at: '2026-09-23T21:37:00Z' }];
  assert.equal(helper.validateOrderReceipt(records).status, 'ok');
  records.order.payment_method = records.sale.payment_method = 'transfer';
  records.payments[0].provider = records.salePayments[0].provider = 'transfer';
  assert.equal(helper.validateOrderReceipt(records).status, 'incident');
});

test('contradictory relationships, amounts, currencies, missing items or snapshot fail closed', () => {
  const changes = [
    x => x.payments.push({ ...x.payments[0], id: randomUUID() }), x => { x.payments[0].order_id = randomUUID(); },
    x => { x.sale.customer_id = randomUUID(); }, x => { x.sale.id = randomUUID(); }, x => { x.sale = undefined; },
    x => x.salePayments.push({ ...x.payments[0], order_id: randomUUID() }), x => { x.salePayments[0].status = 'refunded'; },
    x => { x.salePayments[0].sale_id = randomUUID(); }, x => { x.salePayments[0].amount = 1; },
    x => { x.salePayments[0].currency = 'USD'; }, x => { x.salePayments[0].provider = 'transfer'; },
    x => { x.items = []; }, x => { x.items[0].sale_id = randomUUID(); }, x => x.items.push({ ...x.items[0] }),
    x => { x.items[0].unit_price = 999; }, x => { x.items[0].quantity = 1; }, x => { x.items[0].line_total = '200.301'; },
    x => { x.order.total = 100; }, x => { x.sale.subtotal = 100; }, x => { x.payments[0].amount = 100; },
    x => { x.payments[0].currency = 'USD'; }, x => { x.sale.payment_method = 'cash'; }, x => { x.order.order_number = 'bad'; },
    x => { x.order.customer_name_snapshot = null; }, x => { x.sale.status = 'cancelled'; },
    x => { x.order.status = 'refunded'; }, x => { x.order.operational_status = 'cancelled'; },
  ];
  for (const change of changes) { const records = validRecords(); change(records); assert.equal(helper.validateOrderReceipt(records).status, 'incident', String(change)); }
});

test('reversed receipt requires matching resolution; nullable phone is omitted, never fetched from customers', () => {
  const x = validRecords(); x.order.status = 'refunded'; x.order.operational_status = 'cancelled';
  x.payments[0].status = x.salePayments[0].status = 'refunded'; x.sale.status = 'cancelled'; x.sale.cancelled_at = '2026-09-24T12:00:00Z';
  assert.equal(helper.validateOrderReceipt(x).status, 'incident');
  const r = { order_id: x.order.id, payment_transaction_id: x.payments[0].id, sale_id: x.sale.id, resolution_type: 'REFUND_VERIFIED', created_at: x.sale.cancelled_at };
  x.resolutions = [r]; assert.equal(helper.validateOrderReceipt(x).receipt.status, 'refunded');
  for (const field of ['order_id', 'sale_id', 'payment_transaction_id']) {
    x.resolutions = [{ ...r, [field]: randomUUID() }]; assert.equal(helper.validateOrderReceipt(x).status, 'incident');
  }
  x.resolutions = [{ ...r, resolution_type: 'REFUND_STOCK_UNAVAILABLE' }]; assert.equal(helper.validateOrderReceipt(x).status, 'incident');
  const valid = validRecords(); valid.order.customer_phone_snapshot = null;
  assert.equal(helper.validateOrderReceipt(valid).receipt.maskedPhone, undefined);
  assert.equal(helper.validateOrderReceipt(valid).receipt.paymentMethod, 'Tarjeta (Mercado Pago)');
});

test('malformed/missing order and read errors never expose arbitrary error payloads or create a receipt', async () => {
  reads.length = 0;
  assert.equal((await receipt('bad')).status, 'not_found'); assert.equal(reads.length, 0);
  assert.equal((await receipt('DCL-999999')).status, 'not_found');
  const broken = load('lib/store/order-receipt.ts', { '@/lib/supabase/server': { createAdminServerClient() { throw new Error('secret@example.test'); } } });
  const result = await broken.getOrderReceipt('DCL-900001');
  assert.equal(result.status, 'incident'); assert.doesNotMatch(JSON.stringify(result), /secret|@/);
});

test('availability batches server validation; Orders API emits only its boolean without receipt PII', async () => {
  const f = await fixture(); await complete(f); const pending = await fixture();
  const availability = await helper.getOrderReceiptAvailability([f.number, pending.number]);
  assert.deepEqual(plain(availability), { [f.number]: true, [pending.number]: false });
  const base = localReadClient();
  const client = { ...base, rpc: async () => ({ data: { data: [{ id: f.order, order_number: f.number }], pagination: { total: 1 } }, error: null }),
    from(table) {
      // Existing list enrichment uses an unpaginated query; receipt helper uses its own client.
      const chain = { select: () => chain, in: () => chain, order: () => chain, then: resolve => Promise.resolve({ data: [], error: null }).then(resolve) };
      assert.ok(['payment_transactions', 'order_resolutions'].includes(table)); return chain;
    },
  };
  const { GET } = load('app/api/admin/orders/route.ts', {
    '@/lib/admin-auth': { isAdminAuthenticated: async () => true },
    '@/lib/store/order-receipt': helper,
    '@/lib/supabase/server': { createAdminServerClient: () => client, isServiceRoleConfigured: () => true },
  });
  const result = await (await GET(new Request('https://test.invalid?period=all'))).json();
  assert.equal(result.data[0].receipt_available, true);
  assert.doesNotMatch(JSON.stringify(result), /snapshot|maskedPhone|Nombre del pedido|unitPrice/);
});

const imageMock = { __esModule: true, default: ({ unoptimized, loading, ...props }) => { assert.equal(unoptimized, true); return React.createElement('img', { ...props, loading }); } };
const presentation = load('components/admin/OrderReceipt.tsx', { ...cssMocks, 'next/image': imageMock });
test('receipt HTML renders all three states, historical amounts and only approved customer fields', () => {
  const dto = helper.validateOrderReceipt(validRecords()).receipt;
  for (const [status, label] of [['valid', 'VIGENTE'], ['refunded', 'REEMBOLSADO'], ['cancelled', 'ANULADO']]) {
    const html = renderToStaticMarkup(React.createElement(presentation.OrderReceipt, { receipt: { ...dto, status, ...(status !== 'valid' ? { resolvedAt: '2026-09-24T12:00:00Z' } : {}) } }));
    for (const text of [label, 'COMPROBANTE DE COMPRA', 'Comprobante comercial — No es factura fiscal', 'DCL-900999', 'LED histórico', '200,30', '•••• 2233', '+54 9 261 779-1393', '18:36']) assert.ok(html.includes(text), text);
    assert.doesNotMatch(html, /000 111|customer_id|sale_id|payment_transaction|external_payment|email|documento|CUIT|Finanzas|sidebar|Imprimir/);
    assert.match(html, /logo-dcl.png.png/);
  }
});

test('page authenticates before reading; no browser-supplied totals and no print button on incident', async () => {
  let calls = 0;
  const makePage = (auth, result) => load('app/admin/pedidos/[orderNumber]/comprobante/page.tsx', {
    ...cssMocks, 'next/navigation': { redirect() { throw new Error('redirect'); } },
    '@/lib/admin-auth': { isAdminAuthenticated: async () => auth },
    '@/lib/store/order-receipt': { getOrderReceipt: async number => { calls++; assert.equal(number, 'DCL-900999'); return result; } },
    '@/components/admin/OrderReceipt': presentation,
    '@/components/admin/ReceiptPrintButton': { ReceiptPrintButton: () => React.createElement('button', null, 'Imprimir / Guardar PDF') },
  }).default;
  const props = { params: Promise.resolve({ orderNumber: 'DCL-900999' }), searchParams: Promise.resolve({ total: '1', status: 'valid' }) };
  await assert.rejects(makePage(false, {})(props), /redirect/); assert.equal(calls, 0);
  const incidentHtml = renderToStaticMarkup(await makePage(true, { status: 'incident', message: 'Revisar datos' })(props));
  assert.match(incidentHtml, /pendiente de revisión/); assert.doesNotMatch(incidentHtml, /Imprimir|receipt-title/);
  const html = renderToStaticMarkup(await makePage(true, helper.validateOrderReceipt(validRecords()))(props));
  assert.match(html, /Imprimir \/ Guardar PDF/); assert.match(html, /200,30/);
});

test('print button calls only window.print; receipt shell excludes desktop and mobile navigation', () => {
  let prints = 0;
  const { ReceiptPrintButton } = load('components/admin/ReceiptPrintButton.tsx', cssMocks, { window: { print() { prints++; } } });
  ReceiptPrintButton().props.onClick(); assert.equal(prints, 1);
  const shell = path => load('components/admin/AdminShell.tsx', {
    'next/navigation': { usePathname: () => path },
    '@/components/admin/AdminSidebar': { AdminSidebar: () => React.createElement('nav', null, 'NAVIGATION') },
  }).AdminShell;
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(shell('/admin/pedidos/DCL-900999/comprobante'), null, 'RECEIPT')), /NAVIGATION/);
  assert.match(renderToStaticMarkup(React.createElement(shell('/admin/pedidos'), null, 'ORDERS')), /NAVIGATION/);
  const css = fs.readFileSync('app/admin/pedidos/[orderNumber]/comprobante/comprobante.module.css', 'utf8');
  assert.match(css, /@page\s*\{ size: A4; margin: 14mm;/); assert.match(css, /@media print/);
  assert.match(css, /\.controls, \.printButton, \.printHelp, \.incident \{ display: none !important;/);
  assert.match(css, /break-inside: avoid/); assert.match(css, /display: table-header-group/);
  assert.match(fs.readFileSync('app/admin/layout.tsx', 'utf8'), /print:hidden/);
});

const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
test('Orders modal link is gated by server availability and remains offered on archived receipts', async () => {
  for (const available of [true, false, undefined]) {
    const selected = { id: randomUUID(), order_number: 'DCL-900999', receipt_available: available, status: 'refunded', operational_status: 'cancelled', archived_at: '2026-09-24T12:00:00Z', created_at: '2026-09-23T21:36:00Z', total: 200.3, payment_method: 'transfer', fulfillment_method: 'pickup', customer: {}, items: [], internalNotes: [], operationalHistory: [], resolutions: [], payment: { sale_id: randomUUID(), sale_status: 'cancelled', status: 'refunded' } };
    const states = [], refs = []; let cursor = 0, refCursor = 0;
    const react = { useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; }, useRef(initial) { const i = refCursor++; return refs[i] ||= { current: initial }; }, useEffect() {}, useCallback: fn => fn };
    const { OrdersManager } = load('components/admin/OrdersManager.tsx', { react }, { URLSearchParams,
      fetch: async () => Response.json({ data: [selected], pagination: { total: 1 } }),
    });
    const render = () => { cursor = 0; refCursor = 0; return OrdersManager(); };
    let tree = render(); const refresh = nodes(tree).find(n => n.type === 'button' && n.props.children === 'Actualizar pedidos');
    refresh.props.onClick(); await new Promise(resolve => setImmediate(resolve));
    tree = render(); const row = nodes(tree).find(n => n.type === 'button' && n.key === selected.id); row.props.onClick();
    tree = render(); const links = nodes(tree).filter(n => n.type === 'a' && n.props.children === 'Ver comprobante');
    assert.equal(links.length, available === true ? 1 : 0);
    if (links.length) assert.equal(links[0].props.href, '/admin/pedidos/DCL-900999/comprobante');
  }
});
