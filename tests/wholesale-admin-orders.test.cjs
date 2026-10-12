/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');

const orderId = '8b76d006-0d47-4ba1-a463-c678c1f18d15';
const customerId = 'a1a0f5c1-1077-49c7-92ab-4ae8dd77bcc2';
const revisionId = 'd83881b5-4dd6-4ca6-9de1-043dfeb107aa';
const adminId = 'f70e6013-cd12-4ce1-a815-86d640a21b88';

function queryMock(fixtures, calls) {
  return {
    from(table) {
      const state = { table, filters: [], selection: '' };
      const builder = {
        select(selection, options) { state.selection = selection; state.options = options; return this; },
        eq(column, value) { state.filters.push(['eq', column, value]); return this; },
        ilike(column, value) { state.filters.push(['ilike', column, value]); return this; },
        gte(column, value) { state.filters.push(['gte', column, value]); return this; },
        lt(column, value) { state.filters.push(['lt', column, value]); return this; },
        in(column, value) { state.filters.push(['in', column, value]); return this; },
        limit(value) { state.limit = value; return this; },
        order(column, options) { state.orders = [...(state.orders || []), [column, options]]; return this; },
        range(from, to) { state.range = [from, to]; return this; },
        maybeSingle() { state.single = true; return Promise.resolve(fixtures(state, calls)); },
        then(resolve, reject) { calls.push(state); return Promise.resolve(fixtures(state, calls)).then(resolve, reject); },
      };
      return builder;
    },
  };
}

function loadListRoute({ role = 'ADMIN', fixtures = () => ({ data: [], error: null }), configured = true } = {}) {
  const calls = [];
  const route = load('app/api/admin/wholesale-orders/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/admin-auth': { getAdminIdentity: async () => ({ id: adminId, role }) },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => configured, createAdminServerClient: () => queryMock(fixtures, calls) },
    '@/lib/api': { apiError: (code, message, status) => Response.json({ ok: false, error: code, message }, { status }) },
  });
  return { route, calls };
}

test('wholesale admin list requires ADMIN and rejects VENDEDOR before querying', async () => {
  const { route, calls } = loadListRoute({ role: 'VENDEDOR' });
  const response = await route.GET(new Request('https://dcl.test/api/admin/wholesale-orders'));
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test('wholesale list applies status, date, customer filters and bounded pagination', async () => {
  const { route, calls } = loadListRoute({ fixtures: state => {
    if (state.table === 'customers' && state.selection === 'id') return { data: [{ id: customerId }], error: null };
    if (state.table === 'wholesale_orders') return { data: [{ id: orderId, order_number: 'MW-000001', customer_id: customerId, current_revision_id: revisionId, status: 'received', created_at: '2026-10-09T12:00:00Z', confirmed_at: null }], count: 26, error: null };
    if (state.table === 'customers') return { data: [{ id: customerId, full_name: 'Cliente Prueba' }], error: null };
    if (state.table === 'wholesale_order_revisions') return { data: [{ id: revisionId, total_amount: '1200.00', currency: 'ARS' }], error: null };
    return { data: [], error: null };
  } });
  const response = await route.GET(new Request('https://dcl.test/api/admin/wholesale-orders?page=2&status=received&from=2026-10-01&to=2026-10-10&customer=Cliente'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.pagination.total, 26);
  assert.deepEqual(body.pagination, { page: 2, pageSize: 25, total: 26, totalPages: 2 });
  assert.equal(body.data[0].customerName, 'Cliente Prueba');
  assert.equal(body.data[0].total, 1200);
  assert.deepEqual(calls.find(call => call.table === 'wholesale_orders').range, [25, 49]);
  assert.ok(calls.find(call => call.table === 'wholesale_orders').filters.some(filter => filter[1] === 'status' && filter[2] === 'received'));
  assert.ok(calls.find(call => call.table === 'wholesale_orders').filters.some(filter => filter[1] === 'customer_id'));
});

test('customer search collects matches beyond the first 500 customers', async () => {
  const { route, calls } = loadListRoute({ fixtures: state => {
    if (state.table === 'customers' && state.selection === 'id') {
      const offset = state.range?.[0] ?? 0;
      return { data: Array.from({ length: offset === 0 ? 500 : 1 }, (_, index) => ({ id: `customer-${offset + index}` })), error: null };
    }
    if (state.table === 'wholesale_orders') return { data: [], count: 0, error: null };
    return { data: [], error: null };
  } });
  const response = await route.GET(new Request('https://dcl.test/api/admin/wholesale-orders?customer=Cliente'));
  assert.equal(response.status, 200);
  assert.equal(calls.filter(call => call.table === 'customers' && call.selection === 'id').length, 2);
  const orderFilter = calls.find(call => call.table === 'wholesale_orders').filters.find(filter => filter[1] === 'customer_id');
  assert.equal(orderFilter[2].length, 501);
});

test('wholesale list rejects malformed filters and returns an empty result for unmatched customer', async () => {
  const malformed = loadListRoute();
  assert.equal((await malformed.route.GET(new Request('https://dcl.test/api/admin/wholesale-orders?status=paid'))).status, 400);
  const unmatched = loadListRoute({ fixtures: () => ({ data: [], error: null }) });
  const response = await unmatched.route.GET(new Request('https://dcl.test/api/admin/wholesale-orders?customer=nadie'));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, []);
});

test('wholesale list converts Supabase read failures into a controlled load error', async () => {
  const { route } = loadListRoute({ fixtures: () => ({ data: null, error: { message: 'private database detail' } }) });
  const response = await route.GET(new Request('https://dcl.test/api/admin/wholesale-orders'));
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /private database detail/);
});

test('wholesale detail uses current revision, shows empty timeline and excludes internal cost fields', async () => {
  const calls = [];
  let revisionTotal = '2500.00';
  const route = load('app/api/admin/wholesale-orders/[id]/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/admin-auth': { getAdminIdentity: async () => ({ id: adminId, role: 'ADMIN' }) },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => queryMock(state => {
      if (state.table === 'wholesale_orders') return { data: { id: orderId, order_number: 'MW-000001', customer_id: customerId, status: 'received', current_revision_id: revisionId, created_at: '2026-10-09T12:00:00Z', updated_at: '2026-10-09T12:00:00Z', confirmed_at: null, closed_at: null }, error: null };
      if (state.table === 'customers') return { data: { full_name: 'Cliente Prueba' }, error: null };
      if (state.table === 'wholesale_order_revisions' && state.filters.some(filter => filter[1] === 'revision_type' && filter[2] === 'original')) return { data: { id: '99999999-9999-4999-8999-999999999999', version_number: 1, revision_type: 'original', status: 'superseded', requires_customer_approval: false, commercial_conditions: 'Condición original', total_amount: '2500.00', currency: 'ARS', created_at: '2026-10-09T11:00:00Z' }, error: null };
      if (state.table === 'wholesale_order_revisions') return { data: { id: revisionId, version_number: 2, revision_type: 'proposal', status: 'ready_for_confirmation', requires_customer_approval: true, commercial_conditions: 'Entrega a coordinar', total_amount: revisionTotal, currency: 'ARS', created_at: '2026-10-09T12:00:00Z' }, error: null };
      if (state.table === 'wholesale_order_events') return { data: [], error: null };
      if (state.table === 'wholesale_order_revision_items') return { data: [{ product_id: 'p1', product_name_snapshot: 'Producto', category_snapshot: 'Luces', connector_type_snapshot: 'H7', quantity: 2, unit_price: '1250.00', line_total: '2500.00', currency: 'ARS' }], error: null };
      return { data: [], error: null };
    }, calls) },
    '@/lib/api': { apiError: (code, message, status) => Response.json({ ok: false, error: code, message }, { status }), isUuid: value => /^[0-9a-f-]{36}$/i.test(value) },
  });
  const response = await route.GET(new Request('https://dcl.test/api/admin/wholesale-orders/' + orderId), { params: Promise.resolve({ id: orderId }) });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.revision.version_number, 2);
  assert.equal(body.data.revision.items[0].quantity, 2);
  assert.equal(body.data.originalRevision.version_number, 1);
  assert.equal(body.data.originalRevision.items[0].name, 'Producto');
  assert.equal(body.data.originalRevision.commercial_conditions, 'Condición original');
  assert.deepEqual(body.data.events, []);
  assert.doesNotMatch(JSON.stringify(body), /unit_cost_reference|cost_price|wholesale_code|phone|email/);
  assert.doesNotMatch(calls.find(call => call.table === 'wholesale_order_revision_items').selection, /unit_cost_reference/);
  revisionTotal = '2501.00';
  const inconsistent = await route.GET(new Request('https://dcl.test/api/admin/wholesale-orders/' + orderId), { params: Promise.resolve({ id: orderId }) });
  assert.equal(inconsistent.status, 500);
  assert.doesNotMatch(await inconsistent.text(), /2501|unit_cost_reference/);
});

test('wholesale detail denies VENDEDOR and reports unavailable orders without leaking data', async () => {
  const calls = [];
  const denied = load('app/api/admin/wholesale-orders/[id]/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/admin-auth': { getAdminIdentity: async () => ({ id: adminId, role: 'VENDEDOR' }) },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => queryMock(() => { throw new Error('must not query'); }, calls) },
    '@/lib/api': { apiError: (code, message, status) => Response.json({ ok: false, error: code, message }, { status }), isUuid: value => /^[0-9a-f-]{36}$/i.test(value) },
  });
  assert.equal((await denied.GET(new Request('https://dcl.test'), { params: Promise.resolve({ id: orderId }) })).status, 401);
  const missing = load('app/api/admin/wholesale-orders/[id]/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/admin-auth': { getAdminIdentity: async () => ({ id: adminId, role: 'ADMIN' }) },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => queryMock(() => ({ data: null, error: null }), calls) },
    '@/lib/api': { apiError: (code, message, status) => Response.json({ ok: false, error: code, message }, { status }), isUuid: value => /^[0-9a-f-]{36}$/i.test(value) },
  });
  assert.equal((await missing.GET(new Request('https://dcl.test'), { params: Promise.resolve({ id: orderId }) })).status, 404);
});

test('direct admin page URL redirects VENDEDOR and permits ADMIN; navigation rule also excludes seller', async () => {
  const catalogReads = [];
  for (const role of ['ADMIN', 'VENDEDOR']) {
    const page = load('app/admin/pedidos-mayoristas/page.tsx', {
      '@/lib/admin-auth': { getAdminIdentity: async () => ({ id: adminId, role }) },
      '@/components/admin/WholesaleOrdersManager': { WholesaleOrdersManager: props => ({ props }) },
      '@/lib/supabase/server': {
        isServiceRoleConfigured: () => true,
        createAdminServerClient: () => ({ from(table) {
          const read = { table, selection: '', filters: [] };
          catalogReads.push(read);
          const query = {
            select(selection) { read.selection = selection; return query; },
            eq(...args) { read.filters.push(['eq', ...args]); return query; },
            gt(...args) { read.filters.push(['gt', ...args]); return query; },
            order() { return Promise.resolve({ data: [{ id: 's6-hd', name: 'S6 HD', category: 'Ópticas', connector_type: 'H7', wholesale_price: 12000 }], error: null }); },
          };
          return query;
        } }),
      },
      'next/navigation': { redirect: to => { throw new Error(`REDIRECT:${to}`); } },
    });
    if (role === 'ADMIN') {
      const rendered = await page.default();
      assert.deepEqual(JSON.parse(JSON.stringify(rendered.props.products)), [{ id: 's6-hd', name: 'S6 HD', category: 'Ópticas', connectorType: 'H7', wholesalePrice: 12000 }]);
      assert.equal(rendered.props.catalogError, '');
    }
    else await assert.rejects(page.default(), /REDIRECT:\/admin/);
  }
  assert.equal(catalogReads.length, 1);
  assert.equal(catalogReads[0].selection, 'id,name,category,connector_type,wholesale_price');
  assert.ok(catalogReads[0].filters.some(([kind, column, value]) => kind === 'eq' && column === 'active' && value === true));
  assert.ok(catalogReads[0].filters.some(([kind, column, value]) => kind === 'eq' && column === 'show_in_catalog' && value === true));
  assert.ok(catalogReads[0].filters.some(([kind, column, value]) => kind === 'gt' && column === 'wholesale_price' && value === 0));
  const permissions = load('lib/admin-permissions.ts');
  assert.equal(permissions.canVisitAdminPage('ADMIN', '/admin/pedidos-mayoristas'), true);
  assert.equal(permissions.canVisitAdminPage('VENDEDOR', '/admin/pedidos-mayoristas'), false);
});
