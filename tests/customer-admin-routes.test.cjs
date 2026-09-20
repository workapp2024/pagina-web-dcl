/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const load = require('./load-ts.cjs');

const id = randomUUID();
const request = body => new Request('https://test.invalid/api/admin/customers', { method: 'POST', body: JSON.stringify(body) });
function harness(auth = true, rpcError = null) {
  const calls = [];
  const query = {
    select(_columns, options) { if (options) calls.push(['count', options.count]); return this; },
    order() { return this; }, range(start, end) { calls.push(['range', start, end]); return this; },
    is(column, value) { calls.push(['is', column, value]); return this; },
    not(column, operator, value) { calls.push(['not', column, operator, value]); return this; },
    or(value) { calls.push(['or', value]); return this; },
    in() { return this; },
    then(resolve) { return Promise.resolve({ data: [], count: 0, error: null }).then(resolve); },
  };
  const db = { from(table) { calls.push(['from', table]); return query; }, rpc: async (name, args) => { calls.push(['rpc', name, args]); return { data: { id }, error: rpcError && { message: rpcError } }; } };
  const mocks = { '@/lib/admin-auth': { isAdminAuthenticated: async () => auth }, '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => db } };
  return { calls, ...load('app/api/admin/customers/route.ts', mocks) };
}

test('list isolates active and archived search and paginates inside each view', async () => {
  const h = harness();
  assert.equal((await h.GET(new Request('https://test.invalid/api/admin/customers?q=Ana&page=2'))).status, 200);
  assert.deepEqual(h.calls.filter(call => call[0] === 'is'), [['is', 'archived_at', null]]);
  assert.deepEqual(h.calls.filter(call => call[0] === 'range'), [['range', 20, 39]]);
  assert.match(h.calls.find(call => call[0] === 'or')[1], /Ana/);
  h.calls.length = 0;
  assert.equal((await h.GET(new Request('https://test.invalid/api/admin/customers?view=archived&q=Ana&page=1'))).status, 200);
  assert.deepEqual(h.calls.filter(call => call[0] === 'not'), [['not', 'archived_at', 'is', null]]);
  assert.deepEqual(h.calls.filter(call => call[0] === 'range'), [['range', 0, 19]]);
  assert.equal((await h.GET(new Request('https://test.invalid/api/admin/customers?view=all'))).status, 400);
});

test('admin actions validate inputs and call only the customer RPC', async () => {
  const h = harness();
  const fields = { fullName: 'Ana', phone: '123', email: 'ana@example.com', documentNumber: '', notes: '' };
  assert.equal((await h.POST(request({ action: 'create', ...fields }))).status, 200);
  assert.equal((await h.POST(request({ action: 'edit', customerId: id, ...fields }))).status, 200);
  for (const action of ['archive', 'restore', 'delete']) assert.equal((await h.POST(request({ action, customerId: id }))).status, 200);
  assert.equal(h.calls.filter(call => call[0] === 'rpc').length, 5);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.find(call => call[0] === 'rpc')[2].p_data)), { full_name: 'Ana', phone: '123', email: 'ana@example.com', document_number: null, notes: '' });
  assert.equal((await h.POST(request({ action: 'delete', customerId: 'bad' }))).status, 400);
  assert.equal((await h.POST(request({ action: 'create', fullName: '' }))).status, 400);
  assert.equal((await harness(false).POST(request({ action: 'archive', customerId: id }))).status, 401);
});

test('unsafe delete reports archive guidance', async () => {
  const h = harness(true, 'CUSTOMER_HAS_DEPENDENCIES');
  const response = await h.POST(request({ action: 'delete', customerId: id }));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Archivá/);
});
