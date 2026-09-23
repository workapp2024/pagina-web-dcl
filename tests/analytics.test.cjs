/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./load-ts.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
const nodes = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.props?.children)];
const { analyticsDates } = load('lib/analytics-dates.ts');
const iso = seconds => new Date(seconds * 1000).toISOString();

test('Argentina dates: 7/30 calendar days include today, never future time; server TZ independent', () => {
  const now = new Date('2026-09-12T15:45:00Z');
  for (const [period, start] of [['today', '2026-09-12'], ['7d', '2026-09-06'], ['30d', '2026-08-14'], ['month', '2026-09-01']]) {
    const range = analyticsDates(period, undefined, undefined, now);
    assert.equal(iso(range.from), start + 'T03:00:00.000Z');
    assert.equal(iso(range.to), now.toISOString());
  }
  assert.equal(iso(analyticsDates('today', undefined, undefined, new Date('2026-09-12T01:30:00Z')).from), '2026-09-11T03:00:00.000Z');
});

test('custom dates include final fractional second, leap day and year boundary; reject invalid ranges', () => {
  const now = new Date('2026-09-12T15:00:00Z');
  for (const [from, to, expected] of [['2024-02-29', '2024-02-29', '2024-03-01'], ['2025-12-31', '2025-12-31', '2026-01-01']]) {
    const range = analyticsDates('custom', from, to, now);
    assert.equal(iso(range.to), expected + 'T03:00:00.000Z');
    assert.equal(range.to - range.from, 86400);
    assert.ok(range.to - 0.001 >= range.from);
  }
  for (const args of [['custom'], ['custom', '2026-02-30', '2026-03-01'], ['custom', '2026-09-10', '2026-09-09'], ['custom', '2027-01-01', '2027-01-02'], ['invalid']]) assert.throws(() => analyticsDates(...args));
});

const configured = { POSTHOG_PERSONAL_API_KEY: 'test-only', POSTHOG_PROJECT_ID: '123' };
function admin(fetch, env = configured) {
  return load('lib/posthog-admin.ts', { 'server-only': {} }, { fetch, process: { env }, AbortSignal });
}
function resultsFor(sql) {
  if (sql.startsWith('SELECT event,')) return [['page_view', 3], ['product_viewed', 2], ['product_view', 1]];
  if (sql.startsWith('SELECT uniqIf')) return [[2, 2, 3, 3, 3]];
  if (sql.startsWith('SELECT countIf')) return [[6, 9, 0]];
  return [];
}
const responseFor = results => ({ ok: true, json: async () => ({ results }) });

test('missing configuration performs no requests and never returns fabricated metrics', async () => {
  for (const env of [{}, { POSTHOG_PERSONAL_API_KEY: 'x' }, { POSTHOG_PROJECT_ID: 'x' }]) {
    const result = await admin(() => assert.fail('must not fetch'), env).getAnalyticsSummary(1, 2);
    assert.equal(result.status, 'not_configured'); assert.equal(result.data, undefined);
  }
});

test('HTTP, network, incomplete and malformed responses are errors, not zero', async () => {
  const cases = [async () => ({ ok: false, status: 403 }), async () => { throw new Error('network secret'); }, async () => ({ ok: true, json: async () => ({}) }), async () => responseFor([['event', null]]), async () => ({ ok: true, json: async () => ({ results: [], query_status: { complete: false } }) })];
  for (const fetch of cases) {
    const result = await admin(fetch).getAnalyticsSummary(1, 2);
    assert.equal(result.status, 'error'); assert.equal(result.data, undefined); assert.ok(!result.message.includes('secret'));
  }
});

test('valid empty aggregation is a successful zero; unidentified audience is unavailable', async () => {
  const result = await admin(async (_, init) => {
    const sql = JSON.parse(init.body).query.query;
    return responseFor(sql.startsWith('SELECT uniqIf') ? [[0, 0, 0, 0, 0]] : sql.startsWith('SELECT countIf') ? [[0, 0, 0]] : []);
  }).getAnalyticsSummary(1, 2);
  assert.equal(result.status, 'ok'); assert.equal(result.data.productionEvents, 0);
  assert.equal(result.data.visitors, 0);
  const partial = await admin(async (_, init) => {
    const sql = JSON.parse(init.body).query.query;
    return responseFor(sql.startsWith('SELECT uniqIf') ? [[2, 0, 3, 2, 0]] : resultsFor(sql));
  }).getAnalyticsSummary(1, 2);
  assert.equal(partial.data.visitors, null); assert.equal(partial.data.sessions, null);
});

test('product_viewed and legacy are counted once each; all commercial queries require production', async () => {
  const queries = [];
  const result = await admin(async (_, init) => {
    const query = JSON.parse(init.body).query;
    queries.push(query); assert.equal(init.cache, 'no-store');
    return responseFor(resultsFor(query.query));
  }).getAnalyticsSummary(100, 200);
  assert.equal(result.status, 'ok'); assert.equal(result.data.totals.product_viewed, 3);
  assert.equal(result.data.totals.product_view, undefined); assert.equal(result.data.legacyEvents, 9);
  const emitted = load('lib/analytics.ts', { 'posthog-js': {} }).analyticsEvents.productView;
  assert.equal(emitted, 'product_viewed');
  for (const q of queries) {
    assert.match(q.query, /timestamp >= toDateTime\(\{from\}, 'UTC'\) AND timestamp < toDateTime\(\{to\}, 'UTC'\)/);
    assert.equal(q.values.from, 100); assert.equal(q.values.to, 200);
    if (!q.query.startsWith('SELECT countIf')) assert.match(q.query, /WHERE .*AND properties\['environment'\] = 'production'/);
    assert.doesNotMatch(q.query, /UNION|DELETE|UPDATE/);
  }
  assert.match(queries.find(q => q.values.property === 'product_id').query, /'product_viewed','product_view'/);
  assert.match(queries.find(q => q.query.startsWith('SELECT countIf')).query, /empty\(ifNull\(toString\(properties\['environment'\]\), ''\)\)/);
});

test('new events always carry environment after privacy sanitization, including scoped events', () => {
  const resolve = load('lib/analytics-environment.ts').analyticsEnvironment;
  assert.equal(resolve('localhost', 'production', 'production'), 'development');
  assert.equal(resolve('192.168.100.3', 'production', 'production'), 'development');
  assert.equal(resolve('shop.example', 'production', 'production'), 'production');
  assert.equal(resolve('preview.example', 'preview', 'production'), 'preview');
  assert.equal(resolve('unknown.example', undefined, 'production'), 'preview');
  let config;
  load('instrumentation-client.ts', { 'posthog-js': { init: (_, options) => { config = options; } } }, { process: { env: { NODE_ENV: 'production', NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'public-test', NEXT_PUBLIC_POSTHOG_HOST: 'https://example.invalid', NEXT_PUBLIC_ANALYTICS_ENVIRONMENT: 'production' } }, window: { location: { hostname: 'shop.example', pathname: '/productos', search: '' } } });
  for (const event of ['product_viewed', 'add_to_cart', 'connector_search', 'product_filter_applied', 'whatsapp_click', 'page_view']) {
    const safe = config.before_send({ event, properties: { environment: 'development', source: 'product', connector: 'H7', result_count: 2, has_results: true } });
    assert.equal(safe.properties.environment, 'production');
    if (event === 'whatsapp_click') assert.equal(safe.properties.source, 'product');
  }
});

test('Vercel preview overrides manual production; unknown builds default preview', () => {
  for (const [env, expected] of [[{ NODE_ENV: 'production', VERCEL_ENV: 'preview', NEXT_PUBLIC_ANALYTICS_ENVIRONMENT: 'production' }, 'preview'], [{ NODE_ENV: 'production', VERCEL_ENV: 'production' }, 'production'], [{ NODE_ENV: 'production' }, 'preview']]) {
    assert.equal(load('next.config.ts', {}, { process: { env } }).default.env.NEXT_PUBLIC_ANALYTICS_ENVIRONMENT, expected);
  }
});

test('commercial enrichment is event-scoped, bounded, and strips PII', () => {
  const sanitize = load('lib/store/analytics-privacy.ts').sanitizeStoreEvent;
  const pii = { phone: '123', email: 'a@b.com', name: 'A', customer_name: 'B', document: '1', address: 'X', message: 'secret', whatsapp_message: 'secret' };
  assert.deepEqual(plain(sanitize('product_viewed', { product_id: 'h7', product_slug: 'h7', category: 'Accesorios', unknown: 'x', ...pii })), { $geoip_disable: true, $process_person_profile: false, $ip: null, product_id: 'h7', product_slug: 'h7', category: 'Accesorios' });
  assert.deepEqual(plain(sanitize('add_to_cart', { product_id: 'h7', category: 'Accesorios', quantity: 1, ...pii })), { $geoip_disable: true, $process_person_profile: false, $ip: null, product_id: 'h7', category: 'Accesorios', quantity: 1 });
  const vehicle = plain(sanitize('vehicle_search_completed', { vehicle_type: 'Auto', brand: 'Fiat', model: 'Cronos', year: 2020, position: 'low', year_provided: true, result_count: 4, has_results: false, ...pii }));
  assert.deepEqual(vehicle, { $geoip_disable: true, $process_person_profile: false, $ip: null, vehicle_type: 'Auto', brand: 'Fiat', model: 'Cronos', year: 2020, position: 'low', has_results: true, result_count: 4, year_provided: true });
  assert.equal(sanitize('vehicle_search_no_results', { vehicle_type: 'Auto' }).has_results, false);
  assert.equal(sanitize('connector_search', { connector: 'H7', has_results: true, result_count: 3 }).result_count, 3);
  assert.deepEqual(plain(sanitize('whatsapp_click', { source: 'product', product_id: 'h7', promotion_id: 'no', ...pii })), { $geoip_disable: true, $process_person_profile: false, $ip: null, source: 'product', product_id: 'h7' });
  assert.deepEqual(plain(sanitize('whatsapp_click', { source: 'vehicle_search', vehicle_type: 'Auto', brand: 'Fiat', model: 'Cronos', year: 2020, position: 'fog', has_results: false, product_id: 'no', ...pii })), { $geoip_disable: true, $process_person_profile: false, $ip: null, source: 'vehicle_search', vehicle_type: 'Auto', brand: 'Fiat', model: 'Cronos', year: 2020, position: 'fog', has_results: false });
  const checkout = plain(sanitize('checkout_started', { item_count: 3, cart_total: 100, product_ids: ['h7', 'h4'], product_quantities: [2, 1], ...pii }));
  assert.deepEqual(checkout, { $geoip_disable: true, $process_person_profile: false, $ip: null, item_count: 3, cart_total: 100, product_ids: ['h7', 'h4'] });
  for (const product_ids of [['h7', 'h7'], ['ok', 'bad id'], Array.from({ length: 31 }, (_, index) => `p${index}`), { arbitrary: true }]) assert.equal(sanitize('checkout_started', { product_ids }).product_ids, undefined);
  assert.doesNotMatch(JSON.stringify([vehicle, checkout]), /phone|email|customer_name|document|address|message|secret/);
});

test('all enriched events reject PII, unknown fields and incorrect property types', () => {
  const sanitize = load('lib/store/analytics-privacy.ts').sanitizeStoreEvent;
  const forbidden = { phone: '123', email: 'x@y.test', name: 'X', customer_name: 'X', document: '123', address: 'X', message: 'X', whatsapp_message: 'X', unknown: {}, product_name: 'X' };
  for (const event of ['product_viewed', 'add_to_cart', 'vehicle_search_completed', 'vehicle_search_no_results', 'vehicle_search_error', 'connector_search', 'whatsapp_click', 'checkout_started']) {
    const safe = sanitize(event, { ...forbidden, source: 'vehicle_search', category: {}, year: '2020', position: 'unknown', result_count: 1.5, product_id: {}, product_ids: [1], quantity: 2 });
    for (const key of [...Object.keys(forbidden), 'category', 'year', 'position', 'result_count', 'product_id', 'product_ids', 'quantity']) assert.equal(safe[key], undefined, `${event}: ${key}`);
  }
  for (const value of [-1, 1.5, '2', null, Infinity, NaN, {}]) assert.equal(sanitize('connector_search', { result_count: value }).result_count, undefined);
  for (const ids of [null, 'h7', [null], [[]], new Array(2)]) assert.equal(sanitize('checkout_started', { product_ids: ids }).product_ids, undefined);
  assert.equal(sanitize('vehicle_search_error', { has_results: false, result_count: 0 }).has_results, undefined);
});

test('H7 catalog result creates identifiable connector event, with no free text or PII', () => {
  const { parseProductFilters } = load('lib/product-filters.ts');
  const EventOnMount = () => null;
  const { ProductCatalog } = load('components/public/ProductCatalog.tsx', { '@/components/ui/ProductCard': { ProductCard: () => null }, '@/components/analytics/EventOnMount': { EventOnMount }, '@/components/public/ConnectorField': { ConnectorField: () => null }, 'posthog-js': {} });
  const product = { id: 'h7', name: 'H7', active: true, showInCatalog: true, category: 'General', connectorType: 'H7', vehicleTypes: [], functions: [] };
  for (const [params, products, count] of [[{ conector: 'H7' }, [product], 1], [{ conector: 'H7' }, [], 0], [{ q: 'h7' }, [product], 1]]) {
    const tree = ProductCatalog({ filters: parseProductFilters(params), products });
    const event = nodes(tree).find(n => n.type === EventOnMount);
    assert.equal(event.props.event, 'connector_search');
    assert.deepEqual(plain(event.props.properties), { connector: 'H7', has_results: count > 0, result_count: count });
  }
  assert.ok(!nodes(ProductCatalog({ filters: parseProductFilters({ q: 'persona@example.com' }), products: [] })).some(n => n.type === EventOnMount));
  const safe = load('lib/store/analytics-privacy.ts').sanitizeStoreEvent('connector_search', { connector: 'H7', result_count: 0, has_results: false, phone: '12345', email: 'secret', $current_url: 'secret' });
  assert.equal(safe.connector, 'H7'); assert.equal(safe.has_results, false);
  for (const key of ['phone', 'email', '$current_url']) assert.equal(safe[key], undefined);
});

async function vehicleRun(rows, reject = false, lookupFailure = false, found = [], names = ['Marca', 'Modelo']) {
  const events = []; let cursor = 0;
  const seed = ['Auto', [{ id: 'brand', name: 'Marca' }], names[0], [{ id: 'model', name: 'Modelo' }], names[1], '2016', 'low'];
  const { VehicleFinder } = load('components/public/VehicleFinder.tsx', {
    react: { useState: initial => [cursor < seed.length ? seed[cursor++] : (cursor++, initial), () => {}], useRef: initial => ({ current: initial }), useEffect: fn => { if (lookupFailure) fn(); } },
    '@/components/providers/SiteContentProvider': { useSiteContent: () => ({ content: { products: [] } }) },
    '@/components/ui/ManagedImage': {}, '@/components/ui/WhatsAppButton': {}, '@/components/store/ProductPurchaseActions': {},
    '@/lib/analytics': { analyticsEvents: { vehicleSearchStarted: 'vehicle_search_started', vehicleSearchNoResults: 'vehicle_search_no_results', vehicleSearchError: 'vehicle_search_error', vehicleSearchCompleted: 'vehicle_search_completed', fitmentResultViewed: 'fitment_result_viewed' }, capture: (...args) => events.push(args) },
    '@/lib/supabase/vehicle-compatibility': { VEHICLE_TYPES: ['Auto'], getPublicVehicleBrands: async () => null, getPublicVehicleModels: async () => [], searchPublicVehicleCompatibilities: async () => { if (reject) throw new Error('private backend details'); return rows; } },
    '@/lib/vehicle-product-search': { vehicleReferenceLinks: () => ({}), vehiclePositions: [], vehicleProductMatches: () => found },
  });
  const tree = VehicleFinder();
  await new Promise(resolve => setImmediate(resolve));
  nodes(tree).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  return events;
}

test('valid empty vehicle response differs from null and rejected technical errors', async () => {
  const empty = plain(await vehicleRun([]));
  assert.equal(empty[0][0], 'vehicle_search_started');
  assert.deepEqual(empty[1], ['vehicle_search_no_results', { vehicle_type: 'Auto', brand: 'Marca', model: 'Modelo', year_provided: true, year: 2016, position: 'low', result_count: 0, has_results: false }]);
  for (const args of [[null], [[], true], [[], false, true]]) assert.deepEqual(plain(await vehicleRun(...args)).map(event => event[0]), ['vehicle_search_started', 'vehicle_search_error']);
});

test('vehicle emitter keeps selected year and position for results and omits unmatched free text', async () => {
  const completed = plain(await vehicleRun([], false, false, [{}]));
  assert.deepEqual(completed[1], ['vehicle_search_completed', { vehicle_type: 'Auto', brand: 'Marca', model: 'Modelo', year_provided: true, year: 2016, position: 'low', result_count: 1, has_results: true }]);
  const unmatched = plain(await vehicleRun([], false, false, [], ['Nombre privado', 'Texto privado']));
  assert.equal(unmatched[1][1].brand, undefined);
  assert.equal(unmatched[1][1].model, undefined);
  assert.doesNotMatch(JSON.stringify(unmatched), /privado/);
});

test('commercial WhatsApp link preserves href, presentation and source', () => {
  const events = [];
  const { CommercialWhatsAppLink } = load('components/analytics/CommercialWhatsAppLink.tsx', { '@/lib/analytics': { analyticsEvents: { whatsappClick: 'whatsapp_click' }, capture: (...args) => events.push(args) } });
  const element = CommercialWhatsAppLink({ source: 'product', href: 'https://wa.me/123', className: 'original', children: 'CONSULTAR' });
  element.props.onClick();
  assert.equal(element.props.href, 'https://wa.me/123'); assert.equal(element.props.className, 'original');
  assert.deepEqual(plain(events), [['whatsapp_click', { source: 'product' }]]);
  const { WhatsAppButton } = load('components/ui/WhatsAppButton.tsx', { '@/components/analytics/CommercialWhatsAppLink': { CommercialWhatsAppLink } });
  assert.equal(WhatsAppButton({}).props.source, 'general');
  assert.equal(WhatsAppButton({ source: 'vehicle_search' }).props.source, 'vehicle_search');
  const { ProductCard } = load('components/ui/ProductCard.tsx', { '@/components/ui/ManagedImage': { ManagedImage: () => null }, '@/components/store/AddToCartButton': { AddToCartButton: () => null }, '@/components/analytics/CommercialWhatsAppLink': { CommercialWhatsAppLink } });
  const productLink = nodes(ProductCard({ id: 'x', name: 'H7', price: 1, category: 'General' })).find(n => n.type === CommercialWhatsAppLink);
  assert.equal(productLink.props.source, 'product'); assert.deepEqual(plain(productLink.props.analyticsContext), { product_id: 'x' });
});

test('checkout_started emits unique product IDs without customer data', () => {
  const events = [];
  const { PublicAnalytics } = load('components/analytics/PublicAnalytics.tsx', {
    react: { useEffect: fn => fn() },
    'next/navigation': { usePathname: () => '/checkout', useSearchParams: () => new URLSearchParams() },
    'posthog-js': { __loaded: false },
    '@/lib/analytics': { analyticsEvents: { pageView: 'page_view', checkoutStarted: 'checkout_started' }, capture: (...args) => events.push(args) },
  }, { localStorage: { getItem: () => JSON.stringify([{ id: 'h7', quantity: 2, price: 10 }, { id: 'h7', quantity: 1, price: 10 }, { id: 'h4', quantity: 1, price: 20 }]) } });
  PublicAnalytics();
  assert.deepEqual(plain(events[1]), ['checkout_started', { item_count: 4, cart_total: 50, product_ids: ['h7', 'h4'] }]);
});

test('Admin renders distinct unavailable/error/zero states and no misleading funnel', async () => {
  const analyticsComponent = { '@/components/admin/AnalyticsDetails': { AnalyticsDetails: ({ metrics }) => require('react').createElement('div', null, metrics.map(metric => `${metric.kind}: ${metric.value ?? 'No disponible'}`).join(' ')) } };
  for (const [result, expected] of [[{ status: 'not_configured' }, 'Analytics no configurado'], [{ status: 'error', message: 'PostHog respondió HTTP 403.' }, 'Error consultando PostHog'], [{ status: 'ok', data: { totals: {}, productionEvents: 0, legacyEvents: 9 } }, 'Métricas no disponibles']]) {
    const Page = load('app/admin/analitica/page.tsx', { ...analyticsComponent, '@/lib/admin-auth': { isAdminAuthenticated: async () => true }, '@/lib/posthog-admin': { getAnalyticsSummary: async () => result } }).default;
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    assert.ok(html.includes(expected)); assert.ok(!html.includes('Productos vistos')); assert.ok(!html.includes('Funnel'));
  }
  const data = { totals: { page_view: 1 }, visitors: 1, sessions: null, productionEvents: 1, legacyEvents: 0, connectorNoResults: 0, pages: [], products: [], brands: [], models: [] };
  const Page = load('app/admin/analitica/page.tsx', { ...analyticsComponent, '@/lib/admin-auth': { isAdminAuthenticated: async () => true }, '@/lib/posthog-admin': { getAnalyticsSummary: async () => ({ status: 'ok', data }) } }).default;
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  for (const kind of ['visitors', 'sessions', 'pages', 'products', 'cart', 'vehicles', 'connectors', 'checkout', 'whatsapp', 'No disponible']) assert.ok(html.includes(kind));
  assert.match(html, /products: 0/);
});
