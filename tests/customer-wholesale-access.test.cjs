/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const load = require('./load-ts.cjs');

test('wholesale codes are unique high entropy values with verifiable hashes', () => {
  const { generateWholesaleCode, hashWholesaleCode, verifyWholesaleCode } = load('lib/wholesale-access.ts');
  const first = generateWholesaleCode(), second = generateWholesaleCode();
  assert.notEqual(first, second);
  assert.ok(first.length >= 24);
  assert.match(hashWholesaleCode(first), /^[a-f0-9]{64}$/);
  assert.equal(verifyWholesaleCode(first, hashWholesaleCode(first)), true);
  assert.equal(verifyWholesaleCode(second, hashWholesaleCode(first)), false);
  assert.equal(verifyWholesaleCode(first, 'invalid'), false);
});

function harness(admin = true) {
  const calls = [];
  const customer = { id: randomUUID(), wholesale_enabled: true, wholesale_access_active: true };
  const query = {
    select(columns) { calls.push(['select', columns]); return this; }, order() { return this; }, range() { return this; },
    is() { return this; }, not() { return this; }, or() { return this; }, in() { return this; },
    then(resolve) { return Promise.resolve({ data: [], count: 0, error: null }).then(resolve); },
  };
  const db = { from: () => query, rpc: async (_name, args) => { calls.push(['rpc', args]); return { data: customer, error: null }; } };
  const route = load('app/api/admin/customers/route.ts', {
    '@/lib/admin-auth': { isAdminAuthenticated: async permission => permission === 'commercial' || admin },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => db },
  });
  return { ...route, calls };
}

test('admin client list never selects or returns code or hash, and generation stores only the hash', async () => {
  const h = harness();
  const list = await h.GET(new Request('https://test.invalid/api/admin/customers'));
  const listBody = await list.json();
  assert.doesNotMatch(h.calls.find(call => call[0] === 'select')[1], /wholesale_code_hash/);
  assert.doesNotMatch(JSON.stringify(listBody), /wholesale_code_hash|"code"/);

  const response = await h.POST(new Request('https://test.invalid/api/admin/customers', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'wholesale_activate', customerId: randomUUID() }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(body.data.code);
  assert.equal(body.data.customer.wholesale_code_hash, undefined);
  assert.equal(h.calls.find(call => call[0] === 'rpc')[1].p_code_hash.length, 64);
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('VENDEDOR can view customer status but cannot generate or revoke a code', async () => {
  const h = harness(false);
  const response = await h.POST(new Request('https://test.invalid/api/admin/customers', {
    method: 'POST', body: JSON.stringify({ action: 'wholesale_revoke', customerId: randomUUID() }),
  }));
  assert.equal(response.status, 403);
  assert.equal(h.calls.some(call => call[0] === 'rpc'), false);
});
