/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const load = require('./load-ts.cjs');
const { availableResolutions } = load('lib/store/order-resolutions.ts');
const { canCancelIndependentSale } = load('lib/supabase/sales.ts');
const id = randomUUID();
const key = randomUUID();
const plain = value => JSON.parse(JSON.stringify(value));
const request = body => new Request('https://test.invalid', { method: 'POST', body: JSON.stringify(body) });

test('only state-appropriate resolutions are offered', () => {
  const order = (status, paymentStatus, saleId = null, method = 'mercadopago', operational = 'received') => ({
    status, operational_status: operational, payment_method: method,
    payment: { status: paymentStatus, provider: method === 'transfer' ? 'transfer' : 'mercadopago', sale_id: saleId, sale_status: saleId ? 'completed' : null },
  });
  assert.deepEqual(plain(availableResolutions(order('pending_payment', 'pending'))), ['CANCEL_PENDING']);
  assert.deepEqual(plain(availableResolutions(order('pending_manual_verification', 'pending', null, 'transfer'))), ['CANCEL_PENDING']);
  assert.deepEqual(plain(availableResolutions(order('completed', 'approved', id, 'transfer'))), ['REFUND_VERIFIED', 'TRANSFER_APPROVAL_ERROR']);
  assert.deepEqual(plain(availableResolutions(order('completed', 'approved', id))), ['REFUND_VERIFIED']);
  assert.deepEqual(plain(availableResolutions(order('stock_unavailable', 'approved'))), ['COMPLETE_STOCK_UNAVAILABLE', 'REFUND_STOCK_UNAVAILABLE']);
  assert.deepEqual(plain(availableResolutions(order('refund_required', 'approved', null, 'mercadopago', 'cancelled'))), ['REFUND_STOCK_UNAVAILABLE']);
  assert.deepEqual(plain(availableResolutions(order('refunded', 'refunded', null, 'mercadopago', 'cancelled'))), []);
  assert.deepEqual(plain(availableResolutions(order('completed', 'approved', id, 'mercadopago', 'delivered'))), []);
  assert.deepEqual(plain(availableResolutions(order('completed', 'approved', id, 'mercadopago', 'cancelled'))), []);
});

function api(auth = true, rpcError = null) {
  const calls = [];
  const { POST } = load('app/api/admin/orders/resolve/route.ts', {
    '@/lib/admin-auth': { isAdminAuthenticated: async () => auth },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true,
      createAdminServerClient: () => ({ rpc: async (name, args) => { calls.push({ name, args: plain(args) }); return { data: { id }, error: rpcError && { message: rpcError } }; } }) },
  });
  return { POST, calls };
}
test('resolution API authenticates and validates type, reference, note and key before RPC', async () => {
  const valid = { orderId: id, resolutionType: 'REFUND_VERIFIED', externalReference: 'refund-1', note: 'Total devuelto', idempotencyKey: key };
  const denied = api(false); assert.equal((await denied.POST(request(valid))).status, 401); assert.equal(denied.calls.length, 0);
  for (const body of [{ ...valid, resolutionType: 'UNKNOWN' }, { ...valid, externalReference: '' },
    { ...valid, note: ' ' }, { ...valid, idempotencyKey: 'bad' }, { ...valid, orderId: 'bad' }]) {
    const h = api(); assert.equal((await h.POST(request(body))).status, 400); assert.equal(h.calls.length, 0);
  }
  const transfer = api(); assert.equal((await transfer.POST(request({ ...valid, resolutionType: 'TRANSFER_APPROVAL_ERROR', externalReference: '' }))).status, 200);
  assert.equal(transfer.calls[0].args.p_external_reference, null);
});
test('resolution API forwards the exact idempotency key and translates RPC conflicts', async () => {
  const body = { orderId: id, resolutionType: 'REFUND_STOCK_UNAVAILABLE', externalReference: ' refund-1 ', note: ' Devuelto ', idempotencyKey: key, stock: 999 };
  const h = api(); assert.equal((await h.POST(request(body))).status, 200);
  assert.deepEqual(h.calls, [{ name: 'resolve_order', args: { p_order: id, p_resolution: 'REFUND_STOCK_UNAVAILABLE',
    p_external_reference: 'refund-1', p_note: 'Devuelto', p_idempotency_key: key } }]);
  const conflict = api(true, 'ORDER_RESOLUTION_INSUFFICIENT_STOCK');
  const response = await conflict.POST(request({ ...body, resolutionType: 'COMPLETE_STOCK_UNAVAILABLE' }));
  assert.equal(response.status, 409); assert.match((await response.json()).error, /stock disponible/);
});

test('order list enriches only visible orders with external payment details and resolution history', async () => {
  const calls = [];
  const db = {
    rpc: async () => ({ data: { data: [{ id, payment: { status: 'refunded', sale_status: 'cancelled' } }], pagination: { total: 1 } }, error: null }),
    from: table => {
      calls.push(table);
      const data = table === 'payment_transactions' ? [{ order_id: id, status: 'refunded', provider: 'mercadopago', sale_id: 'sale', external_payment_id: 'mp-1' }]
        : [{ id: key, order_id: id, resolution_type: 'REFUND_VERIFIED', external_reference: 'refund-1', note: 'Devuelto', source: 'admin', actor: 'admin', created_at: '2026-09-20T10:00:00Z' }];
      const chain = { then: resolve => Promise.resolve({ data, error: null }).then(resolve) };
      for (const method of ['select', 'in', 'order']) chain[method] = () => chain;
      return chain;
    },
  };
  const { GET } = load('app/api/admin/orders/route.ts', {
    '@/lib/admin-auth': { isAdminAuthenticated: async () => true },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => db },
  });
  const response = await GET(new Request('https://test.invalid?period=all'));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ['payment_transactions', 'order_resolutions']);
  const row = (await response.json()).data[0];
  assert.equal(row.payment.external_payment_id, 'mp-1');
  assert.equal(row.payment.sale_status, 'cancelled');
  assert.equal(row.resolutions[0].external_reference, 'refund-1');
  assert.equal(row.resolutions[0].note, 'Devuelto');
});

test('linked sales cannot offer independent cancellation; independent sales still can', () => {
  assert.equal(canCancelIndependentSale({ status: 'completed', orderId: id }), false);
  assert.equal(canCancelIndependentSale({ status: 'completed', orderId: null }), true);
  assert.equal(canCancelIndependentSale({ status: 'cancelled', orderId: null }), false);
});

const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
const settle = () => new Promise(resolve => setImmediate(resolve));
test('resolution modal explains external refund and retries with the same key after an RPC conflict', async () => {
  const states = [], refs = [], calls = []; let cursor = 0, refCursor = 0;
  const fixture = { id, order_number: 'DCL-000001', status: 'refund_required', operational_status: 'cancelled',
    total: 200, created_at: '2026-09-20T10:00:00Z', payment_method: 'mercadopago', fulfillment_method: 'pickup',
    notes: '', archived_at: null, archive_block_reason: 'ORDER_REQUIRES_ATTENTION',
    customer: { full_name: 'Cliente test', phone: null, email: null }, items: [], internalNotes: [], operationalHistory: [],
    payment: { status: 'approved', provider: 'mercadopago', sale_id: null }, resolutions: [] };
  const react = { useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef(initial) { const i = refCursor++; return refs[i] ||= { current: initial }; }, useEffect() {}, useCallback: fn => fn };
  const { OrdersManager } = load('components/admin/OrdersManager.tsx', { react }, { URLSearchParams,
    crypto: { randomUUID: () => key }, window: { confirm: () => true },
    fetch: async (url, init) => {
      if (!init) return Response.json({ data: [fixture], pagination: { total: 1 } });
      calls.push({ url, body: JSON.parse(init.body) });
      return calls.length === 1 ? Response.json({ ok: false, error: 'El stock disponible actualmente no alcanza.' }, { status: 409 }) : Response.json({ ok: true });
    },
  });
  const render = () => { cursor = 0; refCursor = 0; return OrdersManager(); };
  const button = label => nodes(render()).find(n => n.type === 'button' && text(n) === label);
  button('Actualizar pedidos').props.onClick(); await settle();
  nodes(render()).find(n => n.type === 'button' && text(n).includes('Cliente test')).props.onClick();
  assert.equal(button('Completar con stock disponible'), undefined);
  button('Registrar reembolso y cerrar incidencia').props.onClick();
  assert.match(text(render()), /no devuelve dinero automáticamente/);
  assert.equal(button('Confirmar acción').props.disabled, true);
  nodes(render()).find(n => n.type === 'input' && n.props.maxLength === 160).props.onChange({ target: { value: 'refund-1' } });
  nodes(render()).filter(n => n.type === 'textarea').at(-1).props.onChange({ target: { value: 'Devuelto' } });
  button('Confirmar acción').props.onClick(); await settle();
  assert.match(text(render()), /stock disponible actualmente no alcanza/);
  button('Reintentar el mismo intento').props.onClick(); await settle();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/api/admin/orders/resolve');
  assert.deepEqual(calls[0].body, calls[1].body);
  assert.equal(calls[0].body.idempotencyKey, key);
});
