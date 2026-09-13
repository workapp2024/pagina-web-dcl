/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const load = require('./load-ts.cjs');
const operations = load('lib/store/order-operations.ts');
const id = randomUUID();
const plain = value => JSON.parse(JSON.stringify(value));
const request = body => new Request('https://test.invalid', { method: 'POST', body: JSON.stringify(body) });
function harness(auth = true, error = null) {
  const calls = [];
  const db = { rpc: async (name, args) => { calls.push({ name, args: plain(args) }); return { data: 'preparing', error }; } };
  const mocks = {
    '@/lib/admin-auth': { isAdminAuthenticated: async () => auth },
    '@/lib/supabase/server': { createAdminServerClient: () => db, isServiceRoleConfigured: () => true },
  };
  return { calls, mocks, ...load('app/api/admin/orders/operational-status/route.ts', mocks) };
}

test('operational route rejects unauthenticated and invalid changes before any RPC', async () => {
  const valid = { orderId: id, expectedStatus: 'received', status: 'preparing' };
  const denied = harness(false);
  assert.equal((await denied.POST(request(valid))).status, 401); assert.equal(denied.calls.length, 0);
  for (const body of [{ ...valid, orderId: 'x' }, { ...valid, status: 'approved' }, { ...valid, expectedStatus: 'completed' }, { ...valid, note: 'x'.repeat(1001) }]) {
    const h = harness(); assert.equal((await h.POST(request(body))).status, 400); assert.equal(h.calls.length, 0);
  }
});

test('operational route only invokes operational RPC and never forwards forged actor or financial data', async () => {
  const h = harness();
  assert.equal((await h.POST(request({ orderId: id, expectedStatus: 'received', status: 'preparing', note: ' Listo para preparar ', actor: 'someone', paymentStatus: 'approved', stock: 0 }))).status, 200);
  assert.deepEqual(h.calls, [{ name: 'set_order_operational_status', args: { p_order: id, p_expected: 'received', p_status: 'preparing', p_note: 'Listo para preparar' } }]);
});

test('financial rejection and stale state return actionable conflict responses', async () => {
  for (const message of ['OPERATIONAL_FINANCIAL_REVERSAL_REQUIRED','OPERATIONAL_CLOSE_PAYMENT_FIRST','OPERATIONAL_PAYMENT_REQUIRED','OPERATIONAL_STALE_STATE','OPERATIONAL_INVALID_TRANSITION']) {
    const h = harness(true, { message });
    const response = await h.POST(request({ orderId: id, expectedStatus: 'received', status: 'cancelled' }));
    assert.equal(response.status, 409); assert.equal((await response.json()).ok, false);
  }
});

test('admin list forwards commercial search and operational filter to the new RPC', async () => {
  const calls = [];
  const { GET } = load('app/api/admin/orders/route.ts', {
    '@/lib/admin-auth': { isAdminAuthenticated: async () => true },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => ({ rpc: async (name, args) => { calls.push({ name, args: plain(args) }); return { data: { data: [], pagination: { total: 0 } }, error: null }; } }) },
  });
  assert.equal((await GET(new Request('https://test.invalid?q=DCL-000123&status=all&period=all&operational=ready'))).status, 200);
  assert.deepEqual(calls[0], { name: 'list_admin_operational_orders', args: { p_q: 'DCL-000123', p_status: 'all', p_since: null, p_page: 1, p_limit: 50, p_operational: 'ready' } });
  assert.equal((await GET(new Request('https://test.invalid?operational=paid'))).status, 400);
  assert.equal(calls.length, 1);
});

test('public status exposes commercial reference and separate states without changing payment result', async () => {
  for (const [technical, financial, result] of [['completed','approved','approved'],['stock_unavailable','approved','review'],['pending_manual_verification','pending','pending'],['rejected','rejected','rejected']]) {
    const db = { from(table) {
      const value = table === 'orders' ? { status: technical, payment_method: 'transfer', total: 200, currency: 'ARS', order_number: 'DCL-000123', operational_status: 'received' } : { status: financial };
      const chain = { then: resolve => Promise.resolve({ data: value }).then(resolve) };
      for (const method of ['select','eq','single','order','limit','maybeSingle']) chain[method] = () => chain;
      return chain;
    } };
    const { GET } = load('app/api/store/orders/[id]/status/route.ts', { '@/lib/rate-limit': { rateLimit: () => null }, '@/lib/supabase/server': { createAdminServerClient: () => db } });
    const response = await GET(new Request('https://test.invalid'), { params: Promise.resolve({ id }) });
    const body = await response.json();
    assert.equal(body.reference, 'DCL-000123'); assert.equal(body.result, result);
    assert.equal(body.operationalStatus, 'received'); assert.equal(body.paymentStatus, financial);
  }
});

test('UI eligibility distinguishes completed from delivered and does not allow paid cancellation', () => {
  const row = { status: 'completed', operational_status: 'received', payment: { status: 'approved', sale_id: 'sale', sale_status: 'completed' } };
  assert.equal(operations.operationalActions(row).next, 'preparing');
  assert.equal(operations.operationalActions(row).canCancel, false);
  assert.equal(operations.operationalActions({ ...row, payment: { ...row.payment, sale_status: 'cancelled' } }).next, undefined);
  assert.equal(operations.operationalActions({ ...row, operational_status: 'delivered' }).next, undefined);
  assert.equal(operations.operationalActions({ status: 'cancelled', operational_status: 'received', payment: { status: 'cancelled', sale_id: null } }).canCancel, true);
});

const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
const settle = () => new Promise(resolve => setImmediate(resolve));

test('Admin renders separate order/payment, submits the expected transition and displays history', async () => {
  const states = [], refs = [], calls = []; let cursor = 0, refCursor = 0;
  const fixture = {
    id, order_number: 'DCL-000123', status: 'completed', operational_status: 'received', total: 200,
    created_at: '2026-09-13T10:00:00Z', payment_method: 'card', fulfillment_method: 'pickup', notes: '',
    customer: { full_name: 'Cliente de prueba', phone: '555', email: 'test@example.invalid' },
    payment: { status: 'approved', sale_id: 'sale', sale_status: 'completed' },
    items: [{ product_name: 'Producto test', quantity: 2, line_total: 200 }], internalNotes: [],
    operationalHistory: [{ id: 1, previous_status: null, new_status: 'received', created_at: '2026-09-13T10:00:00Z', actor: 'server', source: 'order_creation', note: '' }],
  };
  const react = {
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef(initial) { const i = refCursor++; return refs[i] ||= { current: initial }; },
    useEffect() {}, useCallback: fn => fn,
  };
  const { OrdersManager } = load('components/admin/OrdersManager.tsx', { react }, {
    URLSearchParams, window: { confirm: () => true }, fetch: async (url, init) => {
      if (init) { calls.push({ url, body: JSON.parse(init.body) }); return Response.json({ ok: true }); }
      return Response.json({ data: [fixture], pagination: { total: 1 } });
    },
  });
  const render = () => { cursor = 0; refCursor = 0; return OrdersManager(); };
  const button = label => nodes(render()).find(n => n.type === 'button' && text(n) === label);
  button('Actualizar pedidos').props.onClick(); await settle();
  assert.match(text(render()), /DCL-000123/); assert.match(text(render()), /Pedido: Recibido/); assert.match(text(render()), /Pago: Aprobado/);
  nodes(render()).find(n => n.type === 'button' && text(n).includes('Cliente de prueba')).props.onClick();
  assert.match(text(render()), /Historial operativo/);
  assert.equal(button('Registrar cancelación operativa'), undefined);
  button('Marcar: En preparación').props.onClick(); await settle();
  assert.deepEqual(calls, [{ url: '/api/admin/orders/operational-status', body: { action: 'operational', orderId: id, expectedStatus: 'received', status: 'preparing', note: '' } }]);
});
