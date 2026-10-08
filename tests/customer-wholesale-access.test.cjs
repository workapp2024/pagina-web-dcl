/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const load = require('./load-ts.cjs');

test('manual wholesale codes trim and normalize to uppercase while preserving the existing SHA-256 verifier', () => {
  const { normalizeWholesaleCode, isValidManualWholesaleCode, hashWholesaleCode, verifyWholesaleCode } = load('lib/wholesale-access.ts');
  assert.equal(normalizeWholesaleCode('  dcl2026  '), 'DCL2026');
  for (const code of ['DCL2026', 'MAY001', 'DCLJUAN26', 'AB12']) assert.equal(isValidManualWholesaleCode(code), true);
  for (const code of ['ABC', 'A'.repeat(33), 'MAY-001', 'MAY 001', 'ÁBC123']) assert.equal(isValidManualWholesaleCode(normalizeWholesaleCode(code)), false);
  assert.match(hashWholesaleCode('DCL2026'), /^[a-f0-9]{64}$/);
  assert.equal(verifyWholesaleCode('DCL2026', hashWholesaleCode('DCL2026')), true);
  assert.equal(verifyWholesaleCode('dcl2026', hashWholesaleCode('DCL2026')), false);
  assert.equal(verifyWholesaleCode('ExistingCaseSensitive24ABC', hashWholesaleCode('ExistingCaseSensitive24ABC')), true);
  assert.equal(verifyWholesaleCode('DCL2026', 'invalid'), false);
});

function harness(admin = true, rpcError = null) {
  const calls = [];
  const customer = { id: randomUUID(), wholesale_enabled: true, wholesale_access_active: true };
  const query = {
    select(columns) { calls.push(['select', columns]); return this; }, order() { return this; }, range() { return this; },
    is() { return this; }, not() { return this; }, or() { return this; }, in() { return this; },
    then(resolve) { return Promise.resolve({ data: [], count: 0, error: null }).then(resolve); },
  };
  const db = { from: () => query, rpc: async (_name, args) => { calls.push(['rpc', args]); return { data: rpcError ? null : customer, error: rpcError }; } };
  const route = load('app/api/admin/customers/route.ts', {
    '@/lib/admin-auth': { isAdminAuthenticated: async permission => permission === 'commercial' || admin },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => db },
  });
  return { ...route, calls };
}

test('admin client list never selects or returns code or hash, and manual activation stores only the normalized hash', async () => {
  const { hashWholesaleCode } = load('lib/wholesale-access.ts');
  const h = harness();
  const list = await h.GET(new Request('https://test.invalid/api/admin/customers'));
  const listBody = await list.json();
  assert.doesNotMatch(h.calls.find(call => call[0] === 'select')[1], /wholesale_code_hash/);
  assert.doesNotMatch(JSON.stringify(listBody), /wholesale_code_hash|"code"/);

  const response = await h.POST(new Request('https://test.invalid/api/admin/customers', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'wholesale_activate', customerId: randomUUID(), code: '  dcl2026  ' }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.code, undefined);
  assert.equal(body.data.customer.wholesale_code_hash, undefined);
  assert.equal(h.calls.find(call => call[0] === 'rpc')[1].p_code_hash, hashWholesaleCode('DCL2026'));
  assert.equal(JSON.stringify(body).includes('DCL2026'), false);
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('manual activation rejects invalid formats before calling the RPC', async () => {
  for (const code of ['ABC', 'A'.repeat(33), 'MAY-001', 'MAY 001', 'ÁBC123']) {
    const h = harness();
    const response = await h.POST(new Request('https://test.invalid/api/admin/customers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'wholesale_activate', customerId: randomUUID(), code }),
    }));
    assert.equal(response.status, 400, `rejected ${code}`);
    assert.equal(h.calls.some(call => call[0] === 'rpc'), false);
  }
});

test('duplicate active or historical codes return 409 without returning a hash', async () => {
  const h = harness(true, { code: '23505', message: 'WHOLESALE_CODE_ALREADY_USED' });
  const response = await h.POST(new Request('https://test.invalid/api/admin/customers', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'wholesale_activate', customerId: randomUUID(), code: 'MAY001' }),
  }));
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error, 'Ese código mayorista ya fue utilizado.');
  assert.doesNotMatch(JSON.stringify(body), /[a-f0-9]{64}/);
});

test('customer detail update preserves the enriched arrays and totals after wholesale activation', () => {
  const React = require('react');
  const { mergeWholesaleCustomer } = load('components/admin/CustomersManager.tsx', {
    react: React,
    '@/components/admin/AdminIdentityProvider': { useIsOwner: () => true },
  });
  const current = { id: 'customer-1', vehicles: [{ id: 'v1' }], sales: [{ id: 's1' }], warranties: [{ id: 'w1' }], total: 1500, wholesale_enabled: false, wholesale_access_active: false };
  const rpcCustomer = { id: 'customer-1', wholesale_enabled: true, wholesale_access_active: true, wholesale_access_activated_at: '2026-10-08T00:00:00Z', wholesale_code_updated_at: '2026-10-08T00:00:00Z' };
  const selected = mergeWholesaleCustomer(current, rpcCustomer);
  assert.deepEqual(selected.vehicles, current.vehicles);
  assert.deepEqual(selected.sales, current.sales);
  assert.deepEqual(selected.warranties, current.warranties);
  assert.equal(selected.total, 1500);
  assert.equal(selected.vehicles.map(vehicle => vehicle.id).join(','), 'v1');
  assert.equal(selected.wholesale_access_active, true);
});

test('VENDEDOR can view customer status but cannot generate or revoke a code', async () => {
  const h = harness(false);
  const response = await h.POST(new Request('https://test.invalid/api/admin/customers', {
    method: 'POST', body: JSON.stringify({ action: 'wholesale_revoke', customerId: randomUUID() }),
  }));
  assert.equal(response.status, 403);
  assert.equal(h.calls.some(call => call[0] === 'rpc'), false);
});
