/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');
const { renderToStaticMarkup } = require('react-dom/server');

const env = { POSTHOG_PERSONAL_API_KEY: 'test-only', POSTHOG_PROJECT_ID: '123' };
const kinds = ['visitors', 'sessions', 'pages', 'products', 'cart', 'vehicles', 'connectors', 'checkout', 'whatsapp'];
const response = results => ({ ok: true, json: async () => ({ results }) });

function detail(fetch, configured = env) {
  return load('lib/posthog-admin.ts', { 'server-only': {} }, { fetch, process: { env: configured }, AbortSignal });
}

test('every detail is production-only, date-bound, and independently loaded', async () => {
  const queries = [];
  const api = detail(async (_, init) => {
    const q = JSON.parse(init.body).query;
    queries.push(q);
    assert.equal(init.cache, 'no-store');
    return response(q.query.includes('avgIf(') ? [[0, 0, null, 0, null]] : []);
  });
  for (const kind of kinds) {
    const before = queries.length;
    const result = await api.getAnalyticsDetail(kind, 100, 200);
    assert.equal(result.status, 'ok', kind);
    assert.deepEqual(Array.from(result.data.rows), []);
    assert.ok(queries.length > before);
  }
  for (const q of queries) {
    assert.match(q.query, /timestamp >= toDateTime\(\{from\}, 'UTC'\) AND timestamp < toDateTime\(\{to\}, 'UTC'\)/);
    assert.match(q.query, /properties\['environment'\] = 'production'/);
    assert.equal(q.values.from, 100); assert.equal(q.values.to, 200);
    assert.doesNotMatch(q.query, /UNION|DELETE|UPDATE|INSERT/);
  }
  assert.match(queries.find(q => q.query.includes('vehicle_search_completed')).query, /vehicle_type.*brand.*model/);
  assert.match(queries.find(q => q.query.includes('connector_search')).query, /has_results/);
  assert.match(queries.find(q => q.query.includes('checkout_started')).query, /item_count|GROUP BY/);
  assert.match(queries.find(q => q.query.includes('whatsapp_click')).query, /promotion_id/);
});

test('pages and products preserve counts, incomplete identifiers remain unavailable', async () => {
  const api = detail(async (_, init) => {
    const sql = JSON.parse(init.body).query.query;
    if (sql.includes("event = 'page_view'")) return response([['/productos/h7', 5, 5, 3, 4, 2]]);
    return response([['h7', 7, 6, 4]]);
  });
  const pages = await api.getAnalyticsDetail('pages', 100, 200);
  assert.equal(pages.status, 'ok');
  assert.equal(pages.data.rows[0].label, '/productos/h7');
  assert.deepEqual(Array.from(pages.data.rows[0].values), [5, 3, null]);
  for (const kind of ['products', 'cart']) {
    const result = await api.getAnalyticsDetail(kind, 100, 200);
    assert.equal(result.status, 'ok');
    assert.equal(result.data.rows[0].productId, 'h7');
    assert.equal(result.data.rows[0].values[1], null);
  }
});

test('vehicle, connector, checkout, and WhatsApp details use only captured properties', async () => {
  const api = detail(async (_, init) => {
    const sql = JSON.parse(init.body).query.query;
    if (sql.includes('vehicle_search_completed')) return response([['Auto', 'Fiat', 'Cronos', '2020', 'low', 5, 4, 1]]);
    if (sql.includes('connector_search')) return response([['H7', 12, 10, 2, 12, 24]]);
    if (sql.includes('avgIf(')) return response([[2, 2, 1.5, 2, 15000]]);
    if (sql.includes('arrayJoin')) return response([['h7', 2]]);
    if (sql.includes('checkout_started')) return response([['2026-09-20', 2]]);
    return response([['promotion', 'promo_1', '', '', '', '', '', '', null, 3]]);
  });
  const vehicle = await api.getAnalyticsDetail('vehicles', 100, 200);
  assert.match(vehicle.data.rows[0].label, /Fiat.*Cronos.*2020.*low/);
  assert.deepEqual(Array.from(vehicle.data.rows[0].values), [5, 4, 1]);
  const connector = await api.getAnalyticsDetail('connectors', 100, 200);
  assert.deepEqual(Array.from(connector.data.rows[0].values), [12, 10, 2, 2]);
  const checkout = await api.getAnalyticsDetail('checkout', 100, 200);
  assert.equal(checkout.data.stats[1][1], 1.5);
  assert.equal(checkout.data.stats[2][1], 15000);
  assert.equal(checkout.data.secondary.rows[0].productId, 'h7');
  const whatsapp = await api.getAnalyticsDetail('whatsapp', 100, 200);
  assert.match(whatsapp.data.rows[0].label, /promoción promo_1/);
  assert.doesNotMatch(JSON.stringify([vehicle, connector, checkout, whatsapp]), /phone|email|message|document/);
});

test('historical and enriched dimensions coexist without fabricated zeroes', async () => {
  const api = detail(async (_, init) => {
    const sql = JSON.parse(init.body).query.query;
    if (sql.includes('vehicle_search_completed')) return response([['Auto', 'Fiat', 'Cronos', null, null, 2, 1, 1], ['Auto', 'Fiat', 'Cronos', '2020', 'low', 1, 1, 0]]);
    if (sql.includes('connector_search')) return response([['H7', 3, 2, 1, 1, 4]]);
    return response([['vehicle_search', null, null, 'Auto', 'Fiat', 'Cronos', '2020', 'low', 'false', 2], ['vehicle_search', null, null, null, null, null, null, null, null, 1], ['product', null, 'h7', null, null, null, null, null, null, 1]]);
  });
  const vehicles = await api.getAnalyticsDetail('vehicles', 1, 2);
  assert.equal(vehicles.status, 'ok');
  assert.match(vehicles.data.rows[0].label, /Dato no disponible/);
  assert.match(vehicles.data.rows[1].label, /2020.*low/);
  const connectors = await api.getAnalyticsDetail('connectors', 1, 2);
  assert.equal(connectors.data.rows[0].values[3], null);
  const whatsapp = await api.getAnalyticsDetail('whatsapp', 1, 2);
  assert.match(whatsapp.data.rows[0].label, /2020.*low.*Sin resultados/);
  assert.match(whatsapp.data.rows[1].label, /Resultado no disponible/);
  assert.equal(whatsapp.data.rows[2].productId, 'h7');
});

test('not configured, errors, and malformed sensitive dimensions never become zero or leak data', async () => {
  assert.equal((await detail(() => assert.fail('network'), {}).getAnalyticsDetail('pages', 1, 2)).status, 'not_configured');
  const failed = await detail(async () => { throw new Error('secret personal@example.com'); }).getAnalyticsDetail('pages', 1, 2);
  assert.equal(failed.status, 'error'); assert.doesNotMatch(failed.message, /secret|@/);
  const unsafe = await detail(async () => response([['/checkout?email=personal@example.com', 1, 1, 1, 1, 1]])).getAnalyticsDetail('pages', 1, 2);
  assert.equal(unsafe.status, 'error'); assert.doesNotMatch(JSON.stringify(unsafe), /personal@example/);
});

test('KPI controls are buttons with a single expandable detail target', () => {
  const { AnalyticsDetails } = load('components/admin/AnalyticsDetails.tsx', { '@/lib/posthog-admin': {} });
  const html = renderToStaticMarkup(require('react').createElement(AnalyticsDetails, {
    metrics: kinds.map(kind => ({ kind, value: 1 })), period: '7d', replayUrl: 'https://example.invalid/replay',
  }));
  assert.equal((html.match(/aria-controls="analytics-detail"/g) || []).length, 9);
  assert.equal((html.match(/type="button"/g) || []).length, 9);
  assert.ok(!html.includes('analytics-detail" aria-label'));
  assert.doesNotMatch(html, /POSTHOG_PERSONAL_API_KEY|phone|email|customer/);
});

test('detail route authenticates, rejects arbitrary kinds and dates, resolves inactive products, preserves unknown IDs', async () => {
  let calls = 0;
  const route = (authenticated, result = { status: 'ok', data: { title: 'Productos', columns: ['Producto'], rows: [
    { label: 'Producto no disponible', productId: 'inactive', values: [2] },
    { label: 'Producto no disponible', productId: 'removed', values: [1] },
  ] } }) => load('app/api/admin/analytics/detail/route.ts', {
    '@/lib/admin-auth': { isAdminAuthenticated: async () => authenticated },
    '@/lib/posthog-admin': { detailKinds: kinds, getAnalyticsDetail: async (...args) => { calls++; assert.equal(args[0], 'products'); return result; } },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => ({ from: () => ({ select: () => ({ in: async (_, ids) => {
      assert.deepEqual(Array.from(ids), ['inactive', 'removed']); return { data: [{ id: 'inactive', name: 'Producto inactivo' }], error: null };
    } }) }) }) },
  }).GET;
  assert.equal((await route(false)(new Request('https://test/api/admin/analytics/detail?kind=products'))).status, 401);
  assert.equal((await route(true)(new Request('https://test/api/admin/analytics/detail?kind=arbitrary'))).status, 400);
  assert.equal((await route(true)(new Request('https://test/api/admin/analytics/detail?kind=products&period=custom&from=bad&to=bad'))).status, 400);
  assert.equal(calls, 0);
  const payload = await (await route(true)(new Request('https://test/api/admin/analytics/detail?kind=products&period=today'))).json();
  assert.equal(payload.data.rows[0].label, 'Producto inactivo');
  assert.equal(payload.data.rows[1].label, 'Producto no disponible');
  assert.doesNotMatch(JSON.stringify(payload), /phone|email|customer/);
});
