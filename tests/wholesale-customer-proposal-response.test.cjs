/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');

const orderId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const customerId = '33333333-3333-4333-8333-333333333333';

function harness({ session = customerId, allowed = true, result = { data: true, error: null }, configured = true } = {}) {
  const calls = [];
  const route = load('app/api/wholesale/orders/[id]/proposal-response/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/wholesale-server': { getWholesaleSessionCustomerId: async () => session },
    '@/lib/supabase/server': {
      isServiceRoleConfigured: () => configured,
      createAdminServerClient: () => ({ rpc: async (...args) => { calls.push(args); return result; } }),
    },
    '@/lib/wholesale-session-origin': { isWholesaleSessionWriteAllowed: () => allowed },
  });
  return { POST: route.POST, calls };
}

function request(body, { contentType = 'application/json' } = {}) {
  return new Request(`https://dcl.test/api/wholesale/orders/${orderId}/proposal-response`, {
    method: 'POST', headers: { origin: 'https://dcl.test', host: 'dcl.test', 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ id: orderId }) };

test('accept and reject use the authenticated session customer and exact current revision', async () => {
  for (const [decision, rpcName] of [
    ['accept', 'approve_wholesale_order_revision_portal'],
    ['reject', 'reject_wholesale_order_revision_portal'],
  ]) {
    const h = harness();
    const response = await h.POST(request({ decision, revisionId }), context);
    assert.equal(response.status, 200);
    assert.equal(JSON.stringify(h.calls[0]), JSON.stringify([rpcName, { p_order: orderId, p_customer: customerId, p_revision: revisionId }]));
  }
});

test('unauthenticated, cross-origin, customer override, and invalid UUID requests fail before RPC', async () => {
  for (const [options, body, status] of [
    [{ session: null }, { decision: 'accept', revisionId }, 401],
    [{ allowed: false }, { decision: 'accept', revisionId }, 403],
    [{}, { decision: 'accept', revisionId, customerId: 'attacker' }, 400],
    [{}, { decision: 'accept', revisionId: 'bad' }, 400],
    [{}, { decision: 'approve', revisionId }, 400],
  ]) {
    const h = harness(options);
    assert.equal((await h.POST(request(body), context)).status, status);
    assert.equal(h.calls.length, 0);
  }
});

test('stale and foreign-proposal RPC errors are mapped safely without exposing database details', async () => {
  for (const [message, status, code] of [
    ['WHOLESALE_REVISION_STALE: private sql detail', 409, 'REVISION_STALE'],
    ['WHOLESALE_ORDER_NOT_FOUND: private sql detail', 404, 'NOT_FOUND'],
    ['WHOLESALE_REVISION_NOT_RESPONDABLE: private sql detail', 409, 'REVISION_NOT_RESPONDABLE'],
    ['unrecognized private database detail', 503, 'OPERATION_UNAVAILABLE'],
  ]) {
    const h = harness({ result: { data: null, error: { message } } });
    const response = await h.POST(request({ decision: 'reject', revisionId }), context);
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.code, code);
    assert.doesNotMatch(JSON.stringify(body), /private sql detail|database detail/i);
  }
});

test('empty RPC result and missing service configuration never claim a response was recorded', async () => {
  const empty = harness({ result: { data: null, error: null } });
  assert.equal((await empty.POST(request({ decision: 'accept', revisionId }), context)).status, 503);
  const unavailable = harness({ configured: false });
  assert.equal((await unavailable.POST(request({ decision: 'accept', revisionId }), context)).status, 503);
  assert.equal(unavailable.calls.length, 0);
});
