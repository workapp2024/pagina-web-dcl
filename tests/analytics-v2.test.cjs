/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./load-ts.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
const from = Date.parse('2026-09-01T03:00:00Z') / 1000, to = from + 86400;
const created_at = new Date((from + 10) * 1000).toISOString();
const sale = (id, overrides = {}) => ({ id, status: 'completed', total: '100.15', created_at, ...overrides });
const item = (id, sale_id, overrides = {}) => ({ id, sale_id, product_id: 'led', product_name: 'Nombre histórico', quantity: 2, created_at, ...overrides });
const { aggregateStoreSales } = load('lib/analytics-sales.ts');

test('public purchases, revenue and units share deduplicated valid sales, ignoring archive and approved payments without sale', () => {
  const sales = [sale('public', { archived_at: created_at }), sale('public'), sale('second', { total: '50.20' }), sale('manual'), sale('cancelled', { status: 'cancelled' }), sale('missing-order'), sale('outside', { created_at: new Date(to * 1000).toISOString() })];
  const payments = ['public', 'public', 'second', 'cancelled', 'outside'].map(sale_id => ({ sale_id, order_id: 'order' }));
  payments.push({ sale_id: null, order_id: 'order', status: 'approved' }, { sale_id: 'missing-order', order_id: 'absent' });
  const a = item('a', 'public'), b = item('b', 'second', { quantity: 3, product_name: 'Último nombre histórico', created_at: new Date((from + 20) * 1000).toISOString() });
  const result = aggregateStoreSales(sales, payments, [{ id: 'order', archived_at: created_at }], [a, a, b, item('c', 'manual'), item('d', 'cancelled')], from, to);
  assert.deepEqual(plain(result), { status: 'ok', purchases: 2, amount: 150.35, products: [{ key: 'led', label: 'Último nombre histórico', count: 5 }] });
  assert.deepEqual(plain(aggregateStoreSales([], payments, [{ id: 'order' }], [], from, to)), { status: 'ok', purchases: 0, amount: 0, products: [] });
});

test('bad amounts fail instead of silently becoming revenue; null product identity never conflates unrelated items', () => {
  const payments = [{ sale_id: 'public', order_id: 'order' }], orders = [{ id: 'order' }];
  for (const total of ['NaN', -1, '1.001']) assert.throws(() => aggregateStoreSales([sale('public', { total })], payments, orders, [], from, to));
  const result = aggregateStoreSales([sale('public')], payments, orders, [item('a', 'public', { product_id: null }), item('b', 'public', { product_id: null })], from, to);
  assert.equal(result.products.length, 2);
});

function mockDb(records, options = {}) {
  const calls = [];
  return { calls, from: table => {
    const filters = []; let columns;
    const q = {
      select: (value, config) => { columns = value; assert.equal(config.count, 'exact'); return q; },
      eq: (key, value) => { filters.push(row => row[key] === value); return q; },
      gte: (key, value) => { filters.push(row => row[key] >= value); return q; },
      lt: (key, value) => { filters.push(row => row[key] < value); return q; },
      in: (key, values) => { filters.push(row => values.includes(row[key])); return q; },
      order: () => q,
      range: async (start, end) => {
        calls.push({ table, columns, start, end });
        const rows = (records[table] || []).filter(row => filters.every(filter => filter(row)));
        return { data: rows.slice(start, Math.min(end + 1, start + (options.pageSize || 500))), count: rows.length, error: options.fail === table ? { message: 'secret@example.com' } : null };
      },
    }; return q;
  } };
}
test('read-only loader paginates even with server caps and never publishes partial sales', async () => {
  const records = { sales: Array.from({ length: 505 }, (_, i) => sale(`s${i}`)), payment_transactions: Array.from({ length: 505 }, (_, i) => ({ sale_id: `s${i}`, order_id: 'order' })), orders: [{ id: 'order' }], sale_items: [] };
  const db = mockDb(records, { pageSize: 2 });
  const api = load('lib/analytics-sales.ts', { '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => db } });
  const result = await api.getStoreSales(from, to);
  assert.equal(result.status, 'ok'); assert.equal(result.purchases, 505); assert.equal(result.amount, 50575.75);
  assert.ok(db.calls.filter(call => call.table === 'sales').length > 250);
  assert.ok(db.calls.every(call => !/customer|notes|phone|email|archived_at/.test(call.columns)));
  const failed = load('lib/analytics-sales.ts', { '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => mockDb(records, { fail: 'payment_transactions' }) } });
  assert.deepEqual(plain(await failed.getStoreSales(from, to)), { status: 'unavailable' });
});

function activityApi(overrides = {}, bodyExtra = {}) {
  const queries = [];
  const api = load('lib/posthog-admin.ts', {}, { AbortSignal, process: { env: { POSTHOG_PERSONAL_API_KEY: 'test', POSTHOG_PROJECT_ID: '123' } }, fetch: async (_, init) => {
    const q = JSON.parse(init.body).query; queries.push(q);
    let results = q.query.includes("event = 'page_view'") ? [[2, 5, 5]] : q.query.includes("event = 'add_to_cart'") ? [[2, 8, 6]] : q.query.startsWith('SELECT count()') ? [[3]] : [['product', 4], ['other', 2], ['private@example.com', 1]];
    if (overrides[q.query.includes("event = 'page_view'") ? 'pages' : 'cart']) results = overrides[q.query.includes("event = 'page_view'") ? 'pages' : 'cart'];
    return { ok: true, json: async () => ({ results, ...bodyExtra }) };
  } }); return { api, queries };
}
test('activity uses exact production identifiers and unique cart sessions, documenting missing session coverage and safe WhatsApp sources', async () => {
  const { api, queries } = activityApi();
  const result = await api.getStoreActivity(from, to);
  assert.equal(result.status, 'ok'); assert.equal(result.data.visitors, 2); assert.equal(result.data.cartSessions, 2);
  assert.equal(result.data.cartEvents, 8); assert.equal(result.data.cartWithoutSession, 2); assert.equal(result.data.whatsappClicks, 7);
  assert.doesNotMatch(JSON.stringify(result), /private@example/);
  assert.ok(queries.every(q => q.values.from === from && q.values.to === to));
  assert.match(queries[0].query, /uniqExactIf\(distinct_id/); assert.match(queries[1].query, /uniqExactIf.*\$session_id/);
  assert.ok(queries.filter(q => !q.query.startsWith('SELECT count()')).every(q => q.query.includes("properties['environment'] = 'production'")));
  assert.equal((await activityApi({ pages: [[2,5,4]] }).api.getStoreActivity(from, to)).data.visitors, null);
  assert.equal((await activityApi({ pages: [[0,0,0]] }).api.getStoreActivity(from, to)).data.visitors, null);
  assert.equal((await activityApi({}, { hasMore: true }).api.getStoreActivity(from, to)).status, 'unavailable');
  assert.equal((await load('lib/posthog-admin.ts').getStoreActivity(from, to)).status, 'unavailable');
});

test('zero-result ranking queries failures before the limit and never leaks unknown free text', async () => {
  const queries = [];
  const api = load('lib/posthog-admin.ts', {}, { AbortSignal, process: { env: { POSTHOG_PERSONAL_API_KEY: 'test', POSTHOG_PROJECT_ID: '123' } }, fetch: async (_, init) => {
    const q = JSON.parse(init.body).query; queries.push(q);
    return { ok: true, json: async () => ({ results: q.query.includes('connector_search') ? [['H7', 4]] : [['email@example.com', null, 2], ['Fiat', 'Cronos', 3]] }) };
  } });
  const result = await api.getStoreSearches('no_results', from, to);
  assert.equal(result.status, 'ok'); assert.deepEqual(plain(result.rows.map(row => row.count)), [4,3,2]);
  assert.doesNotMatch(JSON.stringify(result), /email@example/);
  assert.match(queries[0].query, /event = 'vehicle_search_no_results'.*LIMIT 5/);
  assert.match(queries[1].query, /has_results.*false.*LIMIT 5/);
});

function pageHarness(authenticated, activity = { status: 'unavailable' }, sales = { status: 'ok', purchases: 9, amount: 1200.25, products: [] }) {
  const calls = [];
  const counted = (name, value) => async (...args) => { calls.push([name, ...args]); return value; };
  const empty = { status: 'ok', rows: [] };
  const Page = load('app/admin/analitica/page.tsx', {
    'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    'next/navigation': { redirect: () => { throw new Error('redirect'); } },
    '@/lib/admin-auth': { isAdminAuthenticated: async () => authenticated },
    '@/lib/posthog-admin': { getStoreActivity: counted('activity', activity), getStoreSearches: counted('searches', empty) },
    '@/lib/analytics-sales': { getStoreSales: counted('sales', sales) },
    '@/lib/analytics-products': { getStoreProductRanking: counted('products', empty) },
    '@/lib/posthog-funnel': { getCommercialFunnel: counted('funnel', { status: 'start_not_configured', startAt: null }) },
    '@/components/admin/AnalyticsFunnel': load('components/admin/AnalyticsFunnel.tsx'),
    '@/components/admin/AnalyticsRankings': load('components/admin/AnalyticsRankings.tsx'),
  }, { URLSearchParams }).default;
  return { Page, calls };
}
test('page authenticates before reads; sources remain independent; compact mobile UI has four KPIs and closed details', async () => {
  const params = { searchParams: Promise.resolve({ period: 'custom', from: '2026-09-01', to: '2026-09-01' }) };
  const denied = pageHarness(false); await assert.rejects(denied.Page(params), /redirect/); assert.equal(denied.calls.length, 0);
  const { Page, calls } = pageHarness(true);
  const html = renderToStaticMarkup(await Page(params));
  assert.equal(calls.length, 8);
  for (const call of calls) assert.deepEqual(call.slice(-2), [from,to]);
  assert.match(html, /9<\/p>/); assert.match(html, /1\.200,25/);
  assert.match(html, /Visitantes medidos/); assert.match(html, /Sesiones con carrito/);
  assert.equal((html.match(/<article /g) || []).length, 4);
  assert.match(html, /grid-cols-2 gap-2 xl:grid-cols-4/); assert.match(html, /min-h-11/);
  assert.match(html, /Detalles de medición/); assert.doesNotMatch(html, /<details[^>]*open|<table|overflow-x|personas reales/);
  assert.match(html, /COMMERCIAL_ANALYTICS_START_AT/);
  assert.equal((html.match(/id="commercial-funnel-title"/g) || []).length, 1);
  assert.ok(html.indexOf('Indicadores de la tienda') < html.indexOf('id="commercial-funnel-title"'));
  const inverse = pageHarness(true, { status: 'ok', data: { visitors: 17, cartSessions: 6, whatsappClicks: 4, whatsappSources: [], pageViews: 20, pagesWithoutIdentity: 0, cartEvents: 12, cartWithoutSession: 2, legacyEvents: 0 } }, { status: 'unavailable' });
  const inverseHtml = renderToStaticMarkup(await inverse.Page(params));
  assert.match(inverseHtml, /17<\/p>/); assert.match(inverseHtml, /6<\/p>/);
  assert.match(inverseHtml, /Lectura de ventas no disponible/);
  const invalid = pageHarness(true); await invalid.Page({ searchParams: Promise.resolve({ period: 'invalid' }) }); assert.equal(invalid.calls.length, 0);
});

test('checkout help still opens when tracking fails, and never sends order context', () => {
  const { CheckoutResult } = load('components/store/CheckoutResult.tsx', {
    react: { useState: value => [value, () => {}], useRef: value => ({ current: value }), useEffect: () => {} },
    '@/components/store/MercadoPagoBrick': { MercadoPagoBrick: () => null },
    '@/lib/analytics': { analyticsEvents: { whatsappClick: 'whatsapp_click' }, capture: (event, properties) => {
      assert.equal(event, 'whatsapp_click'); assert.deepEqual(plain(properties), { source: 'other' }); throw new Error('SDK unavailable');
    } },
  });
  const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const help = nodes(CheckoutResult({ orderNumber: 'DCL-123456', publicKey: '' })).find(node => node.type === 'a' && node.props.children === 'Necesito ayuda con mi pedido');
  assert.match(help.props.href, /^https:\/\/wa.me\//); assert.doesNotThrow(() => help.props.onClick());
});

test('WhatsApp instrumentation preserves destinations and passes only safe product/source properties', () => {
  const product = fs.readFileSync('app/productos/[slug]/page.tsx', 'utf8'), checkout = fs.readFileSync('components/store/CheckoutResult.tsx', 'utf8');
  assert.match(product, /CommercialWhatsAppLink source="product" analyticsContext=\{\{ product_id: product.id \}\}/);
  assert.equal((checkout.match(/capture\(analyticsEvents.whatsappClick, \{ source: "other" \}\)/g) || []).length, 1);
  assert.equal((checkout.match(/onClick=\{trackWhatsAppClick\}/g) || []).length, 2);
  assert.match(checkout, /trackWhatsAppClick\(\);\s+window.location.assign\(transferChat\)/);
  const { sanitizeStoreEvent } = load('lib/store/analytics-privacy.ts');
  for (const source of ['other', 'product']) {
    const safe = sanitizeStoreEvent('whatsapp_click', { source, product_id: 'led', orderNumber: 'DCL-123456', email: 'private@example.com', phone: '123', message: 'private', $current_url: 'https://wa.me?text=private' });
    assert.doesNotMatch(JSON.stringify(safe), /private|DCL|orderNumber|email|phone|message|current_url/);
    assert.equal(safe.source, source);
  }
  for (const file of ['lib/analytics-sales.ts', 'lib/analytics-products.ts', 'app/admin/analitica/page.tsx']) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /scheduleAnalyticsFlush|\.rpc\(|\.insert\(|\.update\(|\.delete\(/);
});
