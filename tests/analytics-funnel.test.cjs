/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { renderToStaticMarkup } = require('react-dom/server');
const React = require('react');
const fs = require('node:fs');
const load = require('./load-ts.cjs');
const { commercialFunnelQuery, parseFunnelRows, funnelPercent } = load('lib/analytics-funnel.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const day = 86400;
const start = Date.parse('2026-09-23T21:36:00Z') / 1000;
const events = ['product_viewed', 'add_to_cart', 'checkout_started', 'order_created', 'payment_approved', 'purchase_completed'];
const event = (index, timestamp = start + index, overrides = {}) => ({
  event: events[index], timestamp, distinct_id: 'browser-a',
  properties: { environment: 'production', ...(index < 4 ? { $session_id: 'session-a' } : { checkout_session_id: 'session-a' }), ...(index >= 3 ? { order_id: 'order-a' } : {}), ...overrides },
});
const sequence = () => events.map((_, i) => event(i));

// Execute the production relational query, not a JS reimplementation. Only adapt
// HogQL property syntax/parameters and provide equivalent scalar date functions.
// This tests joins/grouping on SQLite, not PostHog's parser or ClickHouse planner.
function query(records, from = start, to = start + 10 * day) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE events(event TEXT, timestamp REAL, distinct_id TEXT, properties TEXT)');
    const insert = db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)');
    for (const row of records) insert.run(row.event, row.timestamp, row.distinct_id, JSON.stringify(row.properties));
    db.function('property', (json, key) => JSON.parse(json)[key] ?? null);
    db.function('toString', value => value === null ? null : String(value));
    db.function('notEmpty', value => Number(value !== null && value !== ''));
    db.function('toDateTime64', (value, precision, zone) => { assert.equal(precision, 3); assert.equal(zone, 'UTC'); return value; });
    db.function('addDays', (value, days) => value + days * day);
    const sql = commercialFunnelQuery.replace(/properties\['([^']+)'\]/g, "property(properties, '$1')").replace(/\{from\}/g, '$from').replace(/\{to\}/g, '$to');
    return db.prepare(sql).all({ from, to }).map(row => [row.step, row.journeys_reached, row.orders_reached]);
  } finally { db.close(); }
}
const counts = rows => plain(parseFunnelRows(rows).steps.map(step => step.count));

test('complete ordered sequence, intervening events and delayed payment outside the browser session', () => {
  const rows = sequence();
  rows[4] = event(4, start + 2 * day, { $session_id: 'new-session' });
  rows[5] = event(5, start + 3 * day, { $session_id: 'third-session' });
  rows.push({ ...event(0, start + 0.5), event: 'page_view' });
  const result = parseFunnelRows(query(rows));
  assert.deepEqual(plain(result.steps.map(s => s.count)), [1, 1, 1, 1, 1, 1]);
  assert.equal(result.conversion, 100);
  assert.equal(result.steps[0].conversion, null);
});

test('every out-of-order step stops progression; equal timestamps are allowed', () => {
  for (let index = 1; index < 6; index++) {
    const rows = sequence(); rows[index].timestamp = rows[index - 1].timestamp - 0.001;
    assert.deepEqual(counts(query(rows)), events.map((_, i) => Number(i < index)), events[index]);
  }
  assert.deepEqual(counts(query(sequence().map(row => ({ ...row, timestamp: start })))), [1, 1, 1, 1, 1, 1]);
});

test('navigation repeats can supply a valid later step without inflating counts', () => {
  const rows = sequence(); rows[1].timestamp = start - 1;
  rows.push(event(1, start + 1), ...Array.from({ length: 5 }, () => event(0)));
  assert.deepEqual(counts(query(rows)), [1, 1, 1, 1, 1, 1]);
});

test('two orders in one session remain separate; rates never mix orders and journeys', () => {
  const rows = sequence();
  rows.push(event(3, start + 6, { order_id: 'order-b' }), event(4, start + 7, { order_id: 'order-b' }));
  const data = parseFunnelRows(query(rows));
  assert.deepEqual(plain(data.steps.map(s => s.count)), [1, 1, 1, 2, 2, 1]);
  assert.deepEqual(plain(data.steps.map(s => s.journeys)), [1, 1, 1, 1, 1, 1]);
  assert.equal(data.steps[3].conversion, 100);
  assert.equal(data.steps[3].comparisonUnit, 'recorridos');
  assert.equal(data.steps[5].conversion, 50); assert.equal(data.steps[5].drop, 1);
  assert.equal(data.steps[5].comparisonUnit, 'pedidos');
  assert.equal(data.conversion, 100); // This one session has at least one completed order.
  // Payment for A must not unlock purchase B, even when B was created.
  const crossed = sequence().slice(0, 5);
  crossed.push(event(3, start + 3, { order_id: 'order-b' }), event(5, start + 5, { order_id: 'order-b' }));
  assert.deepEqual(counts(query(crossed)), [1, 1, 1, 2, 1, 0]);
});

test('payment or purchase with a different/missing order or distinct identity never advances', () => {
  for (const index of [3, 4, 5]) {
    for (const missing of [undefined, '', null]) {
      const rows = sequence(); rows[index].properties.order_id = missing;
      assert.deepEqual(counts(query(rows)), events.map((_, i) => Number(i < index)));
    }
  }
  for (const index of [4, 5]) {
    const rows = sequence(); rows[index].properties.order_id = 'unrelated-order';
    assert.deepEqual(counts(query(rows)), events.map((_, i) => Number(i < index)));
    rows[index].properties.order_id = 'order-a'; rows[index].distinct_id = 'other-browser';
    assert.deepEqual(counts(query(rows)), events.map((_, i) => Number(i < index)));
  }
});

test('duplicate events and repeated webhook ingestion count each order at most once', () => {
  const rows = sequence();
  assert.deepEqual(counts(query([...rows, ...rows, ...rows])), [1, 1, 1, 1, 1, 1]);
  // Conflicting identity on a duplicated fact is excluded conservatively.
  rows.push({ ...event(4), distinct_id: 'conflicting-browser' });
  assert.deepEqual(counts(query(rows)), [1, 1, 1, 1, 0, 0]);
});

test('incomplete journeys and skipped product view never fabricate later steps', () => {
  assert.deepEqual(counts(query(sequence().slice(0, 3))), [1, 1, 1, 0, 0, 0]);
  assert.deepEqual(counts(query(sequence().slice(1))), [0, 0, 0, 0, 0, 0]);
});

test('missing sessions and resumed sessions are excluded through order creation', () => {
  for (let index = 0; index < 4; index++) {
    for (const session of [undefined, '', 'other-session']) {
      const rows = sequence(); rows[index].properties.$session_id = session;
      const expected = events.map((_, i) => Number(i < index));
      if (index === 0 && session === 'other-session') expected[0] = 1;
      assert.deepEqual(counts(query(rows)), expected);
    }
  }
  const second = sequence().map(row => ({ ...row, properties: { ...row.properties, $session_id: 'session-b', order_id: row.properties.order_id ? 'order-b' : undefined } }));
  assert.deepEqual(counts(query([...sequence(), ...second])), [2, 2, 2, 2, 2, 2]);
});

test('seven days is inclusive from first view; repeats do not reset clock; period end is exclusive', () => {
  const rows = sequence(); rows[5].timestamp = start + 7 * day;
  assert.deepEqual(counts(query(rows)), [1, 1, 1, 1, 1, 1]);
  rows.push(event(0, start + day)); rows[5].timestamp += 0.001;
  assert.deepEqual(counts(query(rows)), [1, 1, 1, 1, 1, 0]);
  assert.deepEqual(counts(query(sequence(), start, start + 5)), [1, 1, 1, 1, 1, 0]);
});

test('production only: preview, development and unclassified events cannot advance', () => {
  for (const environment of ['preview', 'development', undefined]) {
    for (let index = 0; index < 6; index++) {
      const rows = sequence(); rows[index].properties.environment = environment;
      assert.deepEqual(counts(query(rows)), events.map((_, i) => Number(i < index)));
    }
  }
});

test('zero denominator renders dash; rates and drops are computed from correlated journeys', () => {
  const empty = parseFunnelRows(query([]));
  assert.equal(empty.conversion, null); assert.equal(funnelPercent(empty.conversion), '—');
  assert.ok(empty.steps.every(step => step.conversion === null && step.dropPercent === null));
  const extra = { ...event(0), distinct_id: 'other-browser' };
  const data = parseFunnelRows(query([...sequence(), extra]));
  assert.equal(data.steps[1].conversion, 50); assert.equal(data.steps[1].drop, 1); assert.equal(data.steps[1].dropPercent, 50);
  assert.equal(data.conversion, 50);
  assert.throws(() => parseFunnelRows([[1, 0, 0]]));
  const malformed = query([]); malformed[1][1] = 1;
  assert.throws(() => parseFunnelRows(malformed));
});

const env = { COMMERCIAL_ANALYTICS_START_AT: '2026-09-23T21:36:00Z', POSTHOG_PERSONAL_API_KEY: 'test-only-secret', POSTHOG_PROJECT_ID: '123' };
const api = (fetch, configured = env) => load('lib/posthog-funnel.ts', {}, { fetch, process: { env: configured }, AbortSignal }).getCommercialFunnel;
const response = body => ({ ok: true, json: async () => body });

test('missing/invalid start and range before activation do not query or invent data', async () => {
  const forbidden = () => assert.fail('network');
  for (const value of [undefined, '', 'bad', '2026-02-30T00:00:00Z']) {
    assert.equal((await api(forbidden, { ...env, COMMERCIAL_ANALYTICS_START_AT: value })(start, start + day)).status, 'start_not_configured');
  }
  assert.equal((await api(forbidden)(start - day, start)).status, 'before_start');
  assert.equal((await api(forbidden, { COMMERCIAL_ANALYTICS_START_AT: env.COMMERCIAL_ANALYTICS_START_AT })(start, start + day)).status, 'not_configured');
  assert.equal((await api(forbidden)(start, start)).status, 'error');
});

test('activation clips selected range exactly, including milliseconds; query is read-only and private', async () => {
  const clipped = start + 1.125;
  let calls = 0;
  const get = api(async (url, init) => {
    calls++;
    assert.match(url, /\/api\/projects\/123\/query\/$/);
    assert.equal(init.cache, 'no-store');
    const request = JSON.parse(init.body);
    assert.equal(request.query.values.from, clipped);
    assert.equal(request.query.values.to, start + day);
    assert.equal(request.query.query, commercialFunnelQuery);
    assert.doesNotMatch(request.query.query, /email|phone|customer_id|address|\bINSERT\b|\bUPDATE\b|\bDELETE\b|checkout_session_id/);
    return response({ results: query(sequence(), clipped, start + day) });
  }, { ...env, COMMERCIAL_ANALYTICS_START_AT: new Date(clipped * 1000).toISOString() });
  const result = await get(start - day, start + day);
  assert.equal(calls, 1); assert.equal(result.status, 'ok'); assert.equal(result.from, clipped);
  assert.deepEqual(plain(result.data.steps.map(s => s.count)), [0, 0, 0, 0, 0, 0]);
  assert.doesNotMatch(JSON.stringify(result), /test-only-secret|browser-a|session-a|order-a/);
  let later;
  await api(async (_, init) => { later = JSON.parse(init.body).query.values.from; return response({ results: query([]) }); })(start + 20, start + day);
  assert.equal(later, start + 20);
});

test('PostHog failure is not zero; pending/partial results differ from successful zero', async () => {
  for (const fetch of [async () => ({ ok: false }), async () => { throw new Error('secret@example.invalid'); }, async () => response({ error: 'secret' }), async () => response({ results: [[1, -1, 0]] }), async () => response({})]) {
    const result = await api(fetch)(start, start + day);
    assert.equal(result.status, 'error'); assert.equal(result.data, undefined); assert.doesNotMatch(JSON.stringify(result), /secret|@/);
  }
  for (const body of [{ query_status: { complete: false } }, { results: [] }, { results: query([]), hasMore: true }]) {
    const result = await api(async () => response(body))(start, start + day);
    assert.equal(result.status, 'pending'); assert.equal(result.data, undefined);
  }
  const zero = await api(async () => response({ results: query([]) }))(start, start + day);
  assert.equal(zero.status, 'ok'); assert.equal(zero.data.steps[0].count, 0);
});

test('API authenticates before queries, validates dates, and never flushes outbox', async () => {
  let calls = 0;
  const route = authenticated => load('app/api/admin/analytics/funnel/route.ts', {
    '@/lib/admin-auth': { isAdminAuthenticated: async () => authenticated },
    '@/lib/posthog-funnel': { getCommercialFunnel: async (from, to) => { calls++; assert.ok(from < to); return { status: 'pending', startAt: env.COMMERCIAL_ANALYTICS_START_AT }; } },
  }).GET;
  assert.equal((await route(false)(new Request('https://test/api/admin/analytics/funnel'))).status, 401);
  assert.equal((await route(true)(new Request('https://test/api/admin/analytics/funnel?period=invalid'))).status, 400);
  assert.equal(calls, 0);
  const res = await route(true)(new Request('https://test/api/admin/analytics/funnel?period=custom&from=2026-09-01&to=2026-09-02'));
  assert.equal(res.status, 200); assert.equal(calls, 1); assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal((await res.json()).status, 'pending');
  for (const file of ['app/api/admin/analytics/funnel/route.ts', 'lib/posthog-funnel.ts', 'app/admin/analitica/page.tsx']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /scheduleAnalyticsFlush|createAdminServerClient|\.capture\(/);
  }
});

test('UI distinguishes all states, shows local start, six responsive stages, and no identifiers', () => {
  const { AnalyticsFunnel } = load('components/admin/AnalyticsFunnel.tsx');
  const render = result => renderToStaticMarkup(React.createElement(AnalyticsFunnel, { result }));
  const ok = { status: 'ok', startAt: env.COMMERCIAL_ANALYTICS_START_AT, from: start, to: start + day, data: parseFunnelRows(query(sequence())) };
  const html = render(ok);
  assert.equal((html.match(/<li /g) || []).length, 6);
  assert.match(html, /23\/9\/26.*18:36/);
  assert.match(html, /Ventana de conversión: 7 días/);
  assert.match(html, /sm:grid-cols-2 xl:grid-cols-3/);
  assert.match(html, /pedidos únicos/); assert.match(html, /Conversión completa de recorridos/);
  assert.doesNotMatch(html, /distinct_id|session_id|order_id|browser-a|order-a|session-a|POSTHOG/);
  for (const [status, text] of [['start_not_configured', 'Fecha de inicio de analítica comercial no configurada'], ['not_configured', 'Analytics no configurado'], ['before_start', 'Embudo comercial no disponible para este período.'], ['pending', 'Datos todavía no disponibles'], ['error', 'No se pudo consultar']]) {
    const state = render({ status, startAt: status === 'start_not_configured' ? null : ok.startAt, message: 'No se pudo consultar' });
    assert.ok(state.includes(text)); assert.doesNotMatch(state, /<li /);
  }
  const empty = render({ ...ok, data: parseFunnelRows(query([])) });
  assert.match(empty, /0 recorridos medibles/); assert.doesNotMatch(empty, />0%/); assert.match(empty, /—/);
});

test('Admin queries funnel once with the shared period, enforces auth and keeps it independent of KPIs', async () => {
  const makePage = (authenticated, summary) => {
    const calls = [];
    const Page = load('app/admin/analitica/page.tsx', {
      'next/navigation': { redirect: () => { throw new Error('redirect'); } },
      '@/lib/admin-auth': { isAdminAuthenticated: async () => authenticated },
      '@/components/admin/AnalyticsDetails': { AnalyticsDetails: () => React.createElement('div', { id: 'summary-kpis' }) },
      '@/components/admin/AnalyticsFunnel': load('components/admin/AnalyticsFunnel.tsx'),
      '@/lib/posthog-admin': { getAnalyticsSummary: async (...range) => { calls.push(['summary', ...range]); return summary; } },
      '@/lib/posthog-funnel': { getCommercialFunnel: async (...range) => { calls.push(['funnel', ...range]); return { status: 'ok', startAt: env.COMMERCIAL_ANALYTICS_START_AT, from: range[0], to: range[1], data: parseFunnelRows(query(sequence())) }; } },
    }).default;
    return { Page, calls };
  };
  const params = { searchParams: Promise.resolve({ period: 'custom', from: '2026-09-01', to: '2026-09-02' }) };
  const unauthorized = makePage(false, {});
  await assert.rejects(unauthorized.Page(params), /redirect/); assert.equal(unauthorized.calls.length, 0);
  const data = { totals: {}, visitors: 0, sessions: 0, productionEvents: 1, legacyEvents: 0, connectorNoResults: 0, pages: [], products: [], brands: [], models: [] };
  for (const summary of [{ status: 'error', message: 'Unavailable' }, { status: 'ok', data }]) {
    const { Page, calls } = makePage(true, summary);
    const html = renderToStaticMarkup(await Page(params));
    assert.equal(calls.length, 2); assert.deepEqual(calls[0].slice(1), calls[1].slice(1));
    assert.equal(calls[1][1], Date.parse('2026-09-01T03:00:00Z') / 1000);
    assert.equal((html.match(/id="commercial-funnel-title"/g) || []).length, 1);
    if (summary.status === 'ok') assert.ok(html.indexOf('summary-kpis') < html.indexOf('id="commercial-funnel-title"'));
  }
});
