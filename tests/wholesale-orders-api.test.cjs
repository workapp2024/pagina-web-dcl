/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./load-ts.cjs');
const { addWholesaleProduct, setWholesaleQuantity } = load('lib/wholesale-order-selection.ts');
const customerId = '11111111-1111-4111-8111-111111111111';
const key = '22222222-2222-4222-8222-222222222222';
const request = body => new Request('https://dcl.test/api/wholesale/orders', {
  method: 'POST', headers: { origin: 'https://dcl.test', 'content-type': 'application/json' }, body,
});

function harness({ session = customerId, rpcError = null } = {}) {
  const calls = [];
  const { POST } = load('app/api/wholesale/orders/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/wholesale-server': { getWholesaleSessionCustomerId: async () => session },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => ({ rpc: async (...args) => { calls.push(args); return { data: '33333333-3333-4333-8333-333333333333', error: rpcError }; } }) },
    '@/lib/store/buyer-session': { isSameOriginWrite: () => true },
  });
  return { POST, calls };
}

test('wholesale order endpoint requires server session and ignores any customer_id supplied by browser', async () => {
  const unauthenticated = harness({ session: null });
  const unauthorizedResponse = await unauthenticated.POST(request(JSON.stringify({ items: [], idempotencyKey: key })));
  assert.equal(unauthorizedResponse.status, 401);
  assert.equal(unauthenticated.calls.length, 0);
  const authorized = harness();
  const withCustomerId = await authorized.POST(request(JSON.stringify({ customer_id: 'attacker', items: [{ productId: 'p1', quantity: 2 }], idempotencyKey: key })));
  assert.equal(withCustomerId.status, 400);
  assert.equal(authorized.calls.length, 0);
  const response = await authorized.POST(request(JSON.stringify({ items: [{ productId: 'p1', quantity: 2 }], idempotencyKey: key })));
  assert.equal(response.status, 200);
  assert.equal(authorized.calls[0][1].p_customer, customerId);
  assert.equal(JSON.stringify(authorized.calls[0][1].p_items), JSON.stringify([{ productId: 'p1', quantity: 2 }]));
});

test('wholesale order endpoint rejects malformed, empty, duplicate, and invalid quantity payloads before RPC', async () => {
  for (const body of [ '{', JSON.stringify({ items: [], idempotencyKey: key }),
    JSON.stringify({ items: [{ productId: 'p1', quantity: 0 }], idempotencyKey: key }),
    JSON.stringify({ items: [{ productId: 'p1', quantity: 101 }], idempotencyKey: key }),
    JSON.stringify({ items: [{ productId: 'p1', quantity: 1 }, { productId: 'p1', quantity: 2 }], idempotencyKey: key }),
    JSON.stringify({ items: [{ productId: 'p1', quantity: 1, unit_price: 1 }], idempotencyKey: key }) ]) {
    const h = harness();
    assert.equal((await h.POST(request(body))).status, 400);
    assert.equal(h.calls.length, 0);
  }
});

test('browser price fields are rejected and the RPC remains the only price authority', async () => {
  const h = harness();
  const response = await h.POST(request(JSON.stringify({ idempotencyKey: key, items: [{ productId: 'p1', quantity: 2, price: 0 }] })));
  assert.equal(response.status, 400);
  assert.equal(h.calls.length, 0);
});

test('known RPC eligibility and idempotency errors return controlled messages without PostgreSQL details', async () => {
  for (const [code, status] of [['WHOLESALE_PRODUCT_UNAVAILABLE', 422], ['WHOLESALE_IDEMPOTENCY_CONFLICT', 409]]) {
    const h = harness({ rpcError: { message: `ERROR ${code}: internal postgres details` } });
    const response = await h.POST(request(JSON.stringify({ items: [{ productId: 'p1', quantity: 2 }], idempotencyKey: key })));
    assert.equal(response.status, status);
    assert.doesNotMatch(JSON.stringify(await response.json()), /postgres details/);
  }
});

test('same operation key and payload are passed unchanged to the RPC on retries; UI prevents concurrent duplicate submits', async () => {
  const h = harness();
  const body = JSON.stringify({ idempotencyKey: key, items: [{ productId: 'p1', quantity: 2 }] });
  assert.equal((await h.POST(request(body))).status, 200);
  assert.equal((await h.POST(request(body))).status, 200);
  assert.equal(h.calls[0][1].p_idempotency_key, h.calls[1][1].p_idempotency_key);
  assert.deepEqual(h.calls[0][1].p_items, h.calls[1][1].p_items);
  const source = fs.readFileSync('components/wholesale/WholesaleCatalog.tsx', 'utf8');
  assert.match(source, /pendingRequest = useRef/);
  assert.match(source, /if \(submissionInFlight\.current \|\| !selectedItems\.length\) return/);
  assert.match(source, /disabled=\{busy\} onClick=\{\(\) => void submitOrder\(\)\}/);
  assert.match(source, /submissionInFlight\.current = true/);
});

test('ambiguous network failure followed by a no-op add action retries the created order with the same key', async () => {
  const product = { id: 'p1', name: 'LED', description: '', imageUrl: '', category: '', connectorType: null, functions: [], vehicleTypes: [], wholesalePrice: 100 };
  let selection = { p1: { product, quantity: 1 } };
  let pending = { key, items: [{ productId: product.id, quantity: 1 }] };
  const serverOrders = new Map();
  let failAfterCreate = true;
  async function send() {
    const orderId = serverOrders.get(pending.key) || `order-${serverOrders.size + 1}`;
    serverOrders.set(pending.key, orderId); // Server commits before response is lost.
    if (failAfterCreate) { failAfterCreate = false; throw new Error('network disconnected after commit'); }
    return { orderId, key: pending.key };
  }
  await assert.rejects(send(), /network disconnected/);
  const noOp = addWholesaleProduct(selection, pending, product);
  selection = noOp.selection;
  pending = noOp.pending;
  assert.equal(noOp.changed, false);
  const retried = await send();
  assert.equal(retried.key, key);
  assert.equal(retried.orderId, 'order-1');
  assert.equal(serverOrders.size, 1);
});

test('a real quantity change invalidates the old operation key, while an unchanged quantity preserves it', () => {
  const product = { id: 'p1', name: 'LED', description: '', imageUrl: '', category: '', connectorType: null, functions: [], vehicleTypes: [], wholesalePrice: 100 };
  const selection = { p1: { product, quantity: 2 } };
  const pending = { key, items: [{ productId: 'p1', quantity: 2 }] };
  const unchanged = setWholesaleQuantity(selection, pending, 'p1', 2);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.pending, pending);
  const changed = setWholesaleQuantity(selection, pending, 'p1', 3);
  assert.equal(changed.changed, true);
  assert.equal(changed.pending, null);
  assert.equal(changed.selection.p1.quantity, 3);
});
