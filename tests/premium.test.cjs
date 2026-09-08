/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const load = require('./load-ts.cjs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const premium = load('lib/premium.ts');

// Use the installed SDK against an in-memory HTTP transport. No .env, database
// connection, migration or real fetch is used by these tests.
function harness(responses = [], authenticated = true) {
  const calls = [];
  const logs = [];
  const client = load('lib/supabase/premium-client.ts', {
    'server-only': {},
    '@supabase/supabase-js': {
      createClient: (url, key, options) => createClient(url, key, {
        ...options,
        global: { fetch: async (url, init) => {
          calls.push({ url: new URL(url), init });
          assert.ok(responses.length, 'Unexpected SDK request');
          const table = new URL(url).pathname.split('/').pop();
          const match = responses.findIndex(response => response.table === table);
          const { data, status = 200 } = responses.splice(match >= 0 ? match : 0, 1)[0];
          return Response.json(data, { status });
        } },
      }),
    },
  }, { process: { env: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://premium.invalid',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-test-key',
    SUPABASE_SERVICE_ROLE_KEY: 'private-test-key',
  } } });
  const mocks = {
    '@/lib/admin-auth': { isAdminAuthenticated: async () => authenticated },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true },
    '@/lib/supabase/premium-client': client,
    './premium-client': client,
    './test-connection': { isSupabaseConfigured: () => true },
    '@/lib/supabase/storage': { sanitizeStoredImageUrl: url => url || '' },
  };
  return {
    calls,
    logs,
    route: load('app/api/admin/premium/route.ts', mocks, { console: { error: (...args) => logs.push(args) } }),
    reader: load('lib/supabase/premium.ts', mocks, { console: { error: (...args) => logs.push(args) } }),
  };
}

test('Premium public reader uses public credentials and preserves selection order', async () => {
  const h = harness([{ data: [{ product_ids: ['second', 'first'] }] }]);
  assert.deepEqual(await h.reader.getPremiumProductIds(), ['second', 'first']);
  assert.equal(h.calls[0].init.headers.get('apikey'), 'public-test-key');
  assert.equal(h.calls[0].url.searchParams.get('select'), 'product_ids');
  assert.equal(h.calls[0].url.searchParams.get('id'), 'eq.1');
});

test('Premium reader tolerates missing migration or singleton without falling back to products', async () => {
  for (const response of [
    { data: { code: 'PGRST205', message: 'Missing premium_settings table' }, status: 404 },
    { data: [] },
  ]) {
    const h = harness([response]);
    assert.equal((await h.reader.getPremiumProductIds()).length, 0);
    assert.equal(h.calls.length, 1);
  }
});

test('Premium admin GET uses the SDK projections and private credentials', async () => {
  const h = harness([
    { table: 'premium_settings', data: [{ product_ids: ['one'], revision: 3 }] },
    { table: 'products', data: [{ id: 'one', name: 'One', image_url: '/one.webp', price: 150, active: true, show_in_catalog: true }] },
  ]);
  const response = await h.route.GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true, selection: { productIds: ['one'], revision: 3 },
    products: [{ id: 'one', name: 'One', image: '/one.webp', price: 150, active: true, showInCatalog: true }],
  });
  assert.ok(h.calls.every(call => call.init.headers.get('apikey') === 'private-test-key'));
});

const patchRequest = body => new Request('https://premium.invalid/api/admin/premium', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('Premium PATCH preserves revision-checked updates and reports conflicts', async () => {
  for (const conflict of [false, true]) {
    const h = harness([
      { data: [{ id: 'one' }] },
      { data: conflict ? [] : [{ product_ids: ['one'], revision: 4 }] },
    ]);
    const response = await h.route.PATCH(patchRequest({ productIds: ['one'], revision: 3 }));
    assert.equal(response.status, conflict ? 409 : 200);
    assert.equal(h.calls[1].init.method, 'PATCH');
    assert.equal(h.calls[1].url.searchParams.get('id'), 'eq.1');
    assert.equal(h.calls[1].url.searchParams.get('revision'), 'eq.3');
    assert.deepEqual(JSON.parse(h.calls[1].init.body), { product_ids: ['one'], revision: 4 });
  }
});

test('Premium rejects unauthorized access and invalid selections before SDK requests', async () => {
  const unauthorized = harness([], false);
  assert.equal((await unauthorized.route.GET()).status, 401);
  assert.equal((await unauthorized.route.PATCH(patchRequest({ productIds: [], revision: 0 }))).status, 401);
  assert.equal(unauthorized.calls.length, 0);
  const invalid = harness();
  assert.equal((await invalid.route.PATCH(patchRequest({ productIds: ['one', 'one'], revision: 0 }))).status, 400);
  assert.equal(invalid.calls.length, 0);
});

test('selection accepts zero, one, many and exactly 24 IDs; rejects duplicates, overflow and invalid revisions', () => {
  for (const ids of [[], ['one'], ['two', 'one'], Array.from({ length: 24 }, (_, i) => `p-${i}`)]) {
    const result = premium.validatePremiumSelection({ productIds: ids, revision: 0 });
    assert.equal(JSON.stringify(result.productIds), JSON.stringify(ids));
  }
  for (const body of [
    { productIds: ['one', 'one'], revision: 0 },
    { productIds: Array.from({ length: 25 }, (_, i) => `p-${i}`), revision: 0 },
    { productIds: ['../one'], revision: 0 },
    { productIds: [], revision: -1 }, { productIds: [], revision: '0' },
    { productIds: [], revision: 0, price: 50 },
  ]) assert.throws(() => premium.validatePremiumSelection(body));
});

const product = (id, extra = {}) => ({ id, name: id, image: `/${id}.webp`, price: 150,
  href: `/productos/${id}`, category: 'General', active: true, showInCatalog: true, ...extra });

test('resolution preserves real objects/order and excludes missing, hidden and inactive products, not zero stock', () => {
  const first = product('first'), second = product('second', { stock: 0 });
  const products = [first, second, product('hidden', { showInCatalog: false }), product('inactive', { active: false })];
  const resolved = premium.resolvePremiumProducts(['second', 'missing', 'hidden', 'first', 'inactive', 'second'], products);
  assert.equal(resolved.length, 2);
  assert.equal(resolved[0], second);
  assert.equal(resolved[1], first);
  first.name = 'Updated'; first.price = 299.5; first.image = '/new.webp'; first.href = '/productos/new-slug';
  assert.equal(premium.resolvePremiumProducts(['first'], products)[0], first);
  assert.equal(premium.resolvePremiumProducts([], products).length, 0);
  assert.equal(JSON.stringify(premium.movePremiumProduct(['first', 'second'], 1, -1)), '["second","first"]');
  assert.equal(JSON.stringify(premium.movePremiumProduct(['first', 'second'], 0, -1)), '["first","second"]');
});

test('PATCH saves empty and ordered multiple selections, but never writes an unknown product', async () => {
  for (const ids of [[], ['second', 'first']]) {
    const responses = ids.length ? [{ data: ids.map(id => ({ id })) }] : [];
    responses.push({ data: [{ product_ids: ids, revision: 1 }] });
    const h = harness(responses);
    const response = await h.route.PATCH(patchRequest({ productIds: ids, revision: 0 }));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).selection, { productIds: ids, revision: 1 });
    assert.equal(h.calls.length, ids.length ? 2 : 1);
  }
  const missing = harness([{ data: [] }]);
  assert.equal((await missing.route.PATCH(patchRequest({ productIds: ['deleted'], revision: 0 }))).status, 400);
  assert.equal(missing.calls.length, 1);
});

test('missing table is distinguished from unexpected errors; public Home remains usable with errors logged', async () => {
  for (const unavailable of [true, false]) {
    const failure = { data: { code: unavailable ? 'PGRST205' : '42501', message: unavailable ? 'Missing premium_settings table' : 'Permission denied' }, status: unavailable ? 404 : 403 };
    const h = harness([failure]);
    assert.equal((await h.reader.getPremiumProductIds()).length, 0);
    assert.equal(h.logs.length, unavailable ? 0 : 1);
    const admin = harness([{ ...failure, table: 'premium_settings' }, { data: [], table: 'products' }]);
    const response = await admin.route.GET();
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.message.includes('migración'), unavailable);
  }
});

test('public Premium renders no empty section, native swipe cards and the existing cart abstraction', () => {
  const seen = [];
  const { PremiumProducts } = load('components/sections/PremiumProducts.tsx', {
    'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    '@/components/ui/ManagedImage': { ManagedImage: ({ source, ...props }) => React.createElement('img', { src: source, ...props }) },
    '@/components/store/AddToCartButton': { AddToCartButton: ({ product }) => { seen.push(product); return React.createElement('button', null, 'Agregar al carrito'); } },
  });
  const render = products => renderToStaticMarkup(React.createElement(PremiumProducts, { products }));
  assert.equal(render([]), '');
  const one = render([product('one')]);
  assert.ok(one.includes('Ver producto'));
  assert.ok(!one.includes('Deslizá'));
  const multiple = render([product('second'), product('first')]);
  assert.ok(multiple.includes('snap-x snap-mandatory'));
  assert.ok(multiple.includes('overflow-x-auto'));
  assert.ok(multiple.includes('Deslizá'));
  assert.ok(multiple.indexOf('/productos/second') < multiple.indexOf('/productos/first'));
  assert.equal(seen[0].href, '/productos/one');
  assert.equal(seen[0].price, 150);
  assert.ok(!Object.hasOwn(seen[0], 'stock'));
});

test('admin response parser rejects malformed product data rather than enabling a corrupt selection', () => {
  const valid = { selection: { productIds: ['one'], revision: 2 }, products: [product('one')] };
  assert.equal(premium.readPremiumResponse(valid).products[0].image, '/one.webp');
  assert.throws(() => premium.readPremiumResponse({ ...valid, products: [{ id: 'one' }] }));
});

test('admin editor can search, add, reorder, remove and save only ordered IDs and revision', async () => {
  const states = [], refs = [], effects = [], requests = [];
  let cursor = 0, refCursor = 0;
  const hookReact = {
    useState: initial => {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useRef: initial => { const index = refCursor++; return refs[index] ||= { current: initial }; },
    useCallback: callback => callback,
    useEffect: callback => { if (!effects.length) effects.push(callback); },
  };
  const { PremiumManager } = load('components/admin/PremiumManager.tsx', {
    react: hookReact,
    '@/components/ui/ManagedImage': { ManagedImage: () => null },
  }, { fetch: async (_url, options) => {
    if (options?.method === 'PATCH') {
      const body = JSON.parse(options.body); requests.push(body);
      return Response.json({ ok: true, selection: { ...body, revision: body.revision + 1 } });
    }
    return Response.json({ ok: true, selection: { productIds: ['one'], revision: 0 }, products: [product('one'), product('two'), product('hidden', { active: false })] });
  } });
  const render = () => { cursor = 0; refCursor = 0; return PremiumManager(); };
  const all = node => !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(all)];
  const text = node => React.Children.toArray(node.props?.children).map(child => typeof child === 'object' ? text(child) : child).join('');
  const button = label => all(render()).find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node) === label));
  render(); effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(button('Agregar two'));
  assert.equal(button('Agregar hidden'), undefined);
  all(render()).find(node => node.type === 'input').props.onChange({ target: { value: 'unknown' } });
  assert.equal(button('Agregar two'), undefined);
  all(render()).find(node => node.type === 'input').props.onChange({ target: { value: '' } });
  button('Agregar two').props.onClick();
  assert.equal(button('Agregar two'), undefined);
  button('Subir two').props.onClick();
  button('Guardar selección').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests[0], { productIds: ['two', 'one'], revision: 0 });
  button('Quitar two').props.onClick();
  button('Quitar one').props.onClick();
  button('Guardar selección').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests[1], { productIds: [], revision: 1 });
});

test('Premium migration has isolated table/RLS/grants and shared ID limit; static review only', () => {
  const sql = require('node:fs').readFileSync('supabase/migrations/20260907010000_premium_settings.sql', 'utf8').replace(/--[^\n]*/g, '');
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /GRANT SELECT, UPDATE ON public.premium_settings TO service_role/);
  assert.match(sql, /GRANT SELECT ON public.premium_settings TO anon, authenticated/);
  assert.match(sql, new RegExp(`cardinality\\(ids\\) <= ${premium.MAX_PREMIUM_PRODUCTS}`));
  assert.doesNotMatch(sql, /(?:UPDATE|ALTER TABLE|DELETE FROM)\s+(?:public\.)?products\b/i);
  assert.doesNotMatch(sql, /TRUNCATE|CASCADE/i);
});
