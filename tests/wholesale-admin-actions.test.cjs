/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');

const orderId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const proposedRevisionId = '33333333-3333-4333-8333-333333333333';
const actorId = '44444444-4444-4444-8444-444444444444';
const idempotencyKey = '55555555-5555-4555-8555-555555555555';

function makeRoute({ identity = { id: actorId, role: 'ADMIN', legacy: false }, configured = true, rpcResult = { data: proposedRevisionId, error: null }, nodeEnv = 'development' } = {}) {
  const state = { identityCalls: 0, createCalls: 0, rpcCalls: [] };
  const origin = load('lib/wholesale-session-origin.ts', {
    '@/lib/store/buyer-session': { isSameOriginWrite: request => request.headers.get('origin') === new URL(request.url).origin && request.headers.get('sec-fetch-site') !== 'cross-site' },
  }, { process: { env: { NODE_ENV: nodeEnv } } });
  const route = load('app/api/admin/wholesale-orders/[id]/route.ts', {
    '@/lib/admin-auth': { getAdminIdentity: async () => { state.identityCalls++; return identity; } },
    '@/lib/supabase/server': {
      isServiceRoleConfigured: () => configured,
      createAdminServerClient: () => {
        state.createCalls++;
        return { rpc: async (...args) => { state.rpcCalls.push(args); return rpcResult; } };
      },
    },
    '@/lib/api': {
      apiError: (code, message, status) => Response.json({ ok: false, code, message, error: message }, { status }),
      boundedString: (value, maxLength, options = {}) => {
        const result = typeof value === 'string' ? (options.trim === false ? value : value.trim()) : '';
        if ((options.required && !result) || result.length > maxLength) return null;
        return result;
      },
      isUuid: value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
      readJsonObject: async request => {
        try { const value = await request.json(); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
        catch { return null; }
      },
    },
    '@/lib/wholesale-session-origin': { isWholesaleSessionWriteAllowed: origin.isWholesaleSessionWriteAllowed },
  });
  return { route, state };
}

const payload = overrides => ({
  action: 'propose', expectedRevisionId: revisionId, idempotencyKey,
  items: [{ productId: 'lamp-1', quantity: 2 }],
  commercialConditions: 'Entrega coordinada', internalNote: 'Verificar stock con proveedor',
  ...overrides,
});

function request(body, { url = `http://localhost:3000/api/admin/wholesale-orders/${orderId}`, origin = 'http://localhost:3000', host = new URL(url).host, fetchSite, contentType = 'application/json' } = {}) {
  const headers = { origin, host, 'content-type': contentType };
  if (fetchSite) headers['sec-fetch-site'] = fetchSite;
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

const context = id => ({ params: Promise.resolve({ id }) });

test('all privileged actions reject VENDEDOR and legacy-owner before service client creation', async () => {
  const identities = [
    { id: actorId, role: 'VENDEDOR', legacy: false },
    { id: 'legacy-owner', role: 'ADMIN', legacy: true },
  ];
  const actions = [
    { action: 'start_review' },
    { action: 'confirm', revisionId },
    { action: 'reject' },
    payload(),
  ];
  for (const identity of identities) {
    for (const body of actions) {
      const { route, state } = makeRoute({ identity });
      const response = await route.POST(request(body), context(orderId));
      assert.equal(response.status, 403);
      assert.equal(state.createCalls, 0);
      assert.equal(state.rpcCalls.length, 0);
    }
  }
});

test('proposal action validates request UUIDs and items before creating the service client', async () => {
  const cases = [
    { id: 'bad-order', body: payload() },
    { id: orderId, body: payload({ expectedRevisionId: 'bad-revision' }) },
    { id: orderId, body: payload({ idempotencyKey: 'bad-key' }) },
    { id: orderId, body: payload({ items: [{ productId: 'lamp-1', quantity: 101 }] }) },
  ];
  for (const entry of cases) {
    const { route, state } = makeRoute();
    const response = await route.POST(request(entry.body), context(entry.id));
    assert.equal(response.status, 400);
    assert.equal(state.createCalls, 0);
    assert.equal(state.rpcCalls.length, 0);
  }
});

test('proposal action invokes only the expected-revision RPC and keeps internal notes out of its response', async () => {
  const { route, state } = makeRoute();
  const response = await route.POST(request(payload()), context(orderId));
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(state.rpcCalls)), [[
    'propose_wholesale_order_revision_if_current',
    {
      p_order: orderId, p_expected_revision: revisionId, p_items: [{ productId: 'lamp-1', quantity: 2 }],
      p_idempotency_key: idempotencyKey, p_actor: actorId,
      p_commercial_conditions: 'Entrega coordinada', p_internal_note: 'Verificar stock con proveedor',
    },
  ]]);
  const body = await response.json();
  assert.deepEqual(body, { ok: true, data: { status: 'proposed', revisionId: proposedRevisionId } });
  assert.doesNotMatch(JSON.stringify(body), /Verificar stock|internal_note/);
});

test('delivery action uses the deployed SQL argument name p_key', async () => {
  const { route, state } = makeRoute();
  const response = await route.POST(request({ action: 'deliver', revisionId, idempotencyKey, items: [{ productId: 'lamp-1', quantity: 2 }] }), context(orderId));
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(state.rpcCalls)), [['record_wholesale_delivery', {
    p_order: orderId, p_revision: revisionId, p_items: [{ productId: 'lamp-1', quantity: 2 }], p_key: idempotencyKey, p_actor: actorId,
  }]]);
});

test('stale revision and idempotency conflict map to distinct safe HTTP 409 responses', async () => {
  for (const [databaseMessage, code, unsafeDetail] of [
    ['WHOLESALE_REVISION_STALE: expected internal UUID detail', 'WHOLESALE_REVISION_STALE', 'expected internal UUID detail'],
    ['WHOLESALE_IDEMPOTENCY_CONFLICT: private request fingerprint', 'WHOLESALE_IDEMPOTENCY_CONFLICT', 'private request fingerprint'],
  ]) {
    const { route } = makeRoute({ rpcResult: { data: null, error: { message: databaseMessage } } });
    const response = await route.POST(request(payload()), context(orderId));
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.error, code);
    assert.doesNotMatch(JSON.stringify(body), new RegExp(unsafeDetail));
  }
});

test('an unchanged proposal cannot silently advance past customer approval', async () => {
  const { route } = makeRoute({ rpcResult: { data: null, error: { message: 'WHOLESALE_PROPOSAL_UNCHANGED: private detail' } } });
  const response = await route.POST(request(payload()), context(orderId));
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, 'BAD_REQUEST');
  assert.match(body.message, /Actualizá el detalle/);
  assert.doesNotMatch(JSON.stringify(body), /private detail/);
});

test('invalid origin and malformed body never reach the privileged RPC', async () => {
  const crossSite = makeRoute();
  assert.equal((await crossSite.route.POST(request(payload(), { origin: 'https://attacker.test' }), context(orderId))).status, 403);
  assert.equal(crossSite.state.createCalls, 0);
  const invalidJsonType = makeRoute();
  assert.equal((await invalidJsonType.route.POST(request(payload(), { contentType: 'text/plain' }), context(orderId))).status, 400);
  assert.equal(invalidJsonType.state.createCalls, 0);
});

test('admin actions accept same-host localhost and LAN only in development, and keep strict production origin checks', async () => {
  const cases = [
    { name: 'localhost development', env: 'development', options: { url: `http://localhost:3000/api/admin/wholesale-orders/${orderId}`, host: 'localhost:3000', origin: 'http://localhost:3000' }, status: 200 },
    { name: 'LAN development', env: 'development', options: { url: `http://localhost:3000/api/admin/wholesale-orders/${orderId}`, host: '192.168.100.3:3000', origin: 'http://192.168.100.3:3000' }, status: 200 },
    { name: 'same-origin production', env: 'production', options: { url: `https://dcl.example/api/admin/wholesale-orders/${orderId}`, host: 'dcl.example', origin: 'https://dcl.example' }, status: 200 },
    { name: 'LAN rejected in production', env: 'production', options: { url: `http://localhost:3000/api/admin/wholesale-orders/${orderId}`, host: '192.168.100.3:3000', origin: 'http://192.168.100.3:3000' }, status: 403 },
    { name: 'cross-site rejected in development', env: 'development', options: { url: `http://localhost:3000/api/admin/wholesale-orders/${orderId}`, host: '192.168.100.3:3000', origin: 'http://192.168.100.3:3000', fetchSite: 'cross-site' }, status: 403 },
  ];
  for (const entry of cases) {
    const { route, state } = makeRoute({ nodeEnv: entry.env, rpcResult: { data: 'in_review', error: null } });
    const response = await route.POST(request({ action: 'start_review' }, entry.options), context(orderId));
    assert.equal(response.status, entry.status, entry.name);
    assert.equal(state.rpcCalls.length, entry.status === 200 ? 1 : 0, entry.name);
  }
});

test('unexpected RPC errors return a generic response without database details', async () => {
  const { route } = makeRoute({ rpcResult: { data: null, error: { message: 'permission denied with sensitive schema detail' } } });
  const response = await route.POST(request(payload()), context(orderId));
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /sensitive schema detail/);
});

test('review, confirmation, and rejection call only their existing RPCs with the authenticated ADMIN actor', async () => {
  const actions = [
    [{ action: 'start_review' }, 'start_wholesale_order_review', { p_order: orderId, p_actor: actorId }, 'in_review'],
    [{ action: 'confirm', revisionId }, 'confirm_wholesale_order_revision', { p_order: orderId, p_revision: revisionId, p_actor: actorId }, 'confirmed'],
    [{ action: 'reject', internalNote: 'No hay disponibilidad' }, 'close_wholesale_order', { p_order: orderId, p_action: 'reject', p_actor: actorId, p_internal_note: 'No hay disponibilidad' }, 'rejected'],
  ];
  for (const [body, rpcName, args, status] of actions) {
    const rpcValue = status === 'confirmed' ? orderId : status;
    const { route, state } = makeRoute({ rpcResult: { data: rpcValue, error: null } });
    const response = await route.POST(request(body), context(orderId));
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(JSON.stringify(state.rpcCalls)), [[rpcName, args]]);
    assert.deepEqual(await response.json(), { ok: true, data: { status } });
  }
});

test('invalid action fields and overlong internal notes are rejected before service access', async () => {
  for (const body of [
    { action: 'start_review', unexpected: true },
    { action: 'confirm', revisionId: 'not-a-uuid' },
    { action: 'reject', internalNote: 'x'.repeat(1001) },
    { action: 'delete' },
  ]) {
    const { route, state } = makeRoute();
    const response = await route.POST(request(body), context(orderId));
    assert.equal(response.status, 400);
    assert.equal(state.createCalls, 0);
    assert.equal(state.rpcCalls.length, 0);
  }
});

test('invalid workflow transitions return a safe conflict and keep RPC detail private', async () => {
  const { route } = makeRoute({ rpcResult: { data: null, error: { message: 'WHOLESALE_REVISION_NOT_CONFIRMABLE: internal row details' } } });
  const response = await route.POST(request({ action: 'confirm', revisionId }), context(orderId));
  assert.equal(response.status, 409);
  assert.doesNotMatch(await response.text(), /internal row details/);
});
