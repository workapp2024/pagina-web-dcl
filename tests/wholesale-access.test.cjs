/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const load = require('./load-ts.cjs');

const migration = fs.readFileSync('supabase/migrations/20261007030000_wholesale_access_sessions.sql', 'utf8');
let db;
before(async () => {
  db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE TABLE public.customers(id UUID PRIMARY KEY);');
  await db.exec(migration);
});
after(async () => { await db?.close(); });

test('session migration is transactional, private to service_role, and constrains opaque tokens', async () => {
  const table = await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.wholesale_access_sessions'::regclass");
  assert.equal(table.rows[0].relrowsecurity, true);
  const privileges = await db.query("SELECT has_table_privilege('anon','public.wholesale_access_sessions','SELECT') AS anon, has_table_privilege('authenticated','public.wholesale_access_sessions','SELECT') AS authenticated, has_table_privilege('service_role','public.wholesale_access_sessions','SELECT') AS service");
  assert.deepEqual(privileges.rows[0], { anon: false, authenticated: false, service: true });
  await assert.rejects(db.query("INSERT INTO wholesale_access_sessions(token_hash,customer_id,wholesale_code_updated_at,expires_at) VALUES('bad',$1,now(),now()+interval '1 hour')", [randomUUID()]), /check constraint/i);
});

function serverHarness({ session, customer }) {
  const dbMock = { from: table => {
    let filterColumn = '', filterValue = '';
    return {
      select() { return this; }, eq(column, value) { filterColumn = column; filterValue = value; return this; },
      maybeSingle: async () => {
        if (table === 'wholesale_access_sessions') return { data: session, error: null };
        if (filterColumn === 'wholesale_code_hash') return { data: customer?.wholesale_code_hash === filterValue ? customer : null, error: null };
        return { data: customer, error: null };
      },
    };
  } };
  return load('lib/wholesale-server.ts', {
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => dbMock },
    'next/headers': { cookies: async () => ({ get: () => null }) },
  });
}

test('code lookup and session authorization reject inactive, archived, expired, and replaced access', async () => {
  const { hashWholesaleCode, hashWholesaleSessionToken } = load('lib/wholesale-access.ts');
  const { isWholesaleSessionValid } = serverHarness({ session: null, customer: null });
  const code = 'dcl2026';
  const enabledCustomer = { id: randomUUID(), wholesale_code_hash: hashWholesaleCode('DCL2026'), wholesale_enabled: true, wholesale_access_active: true, archived_at: null, wholesale_code_updated_at: '2026-10-07T03:00:00+00:00' };
  const lookup = await serverHarness({ session: null, customer: enabledCustomer }).findActiveWholesaleCustomerByCode(code);
  assert.equal(lookup.customer.id, enabledCustomer.id);
  assert.equal(lookup.matchedCode, 'DCL2026');
  assert.equal((await serverHarness({ session: null, customer: { ...enabledCustomer, wholesale_access_active: false } }).findActiveWholesaleCustomerByCode(code)).customer, null);
  assert.equal((await serverHarness({ session: null, customer: { ...enabledCustomer, wholesale_enabled: false } }).findActiveWholesaleCustomerByCode(code)).customer, null);
  assert.equal((await serverHarness({ session: null, customer: { ...enabledCustomer, archived_at: new Date().toISOString() } }).findActiveWholesaleCustomerByCode(code)).customer, null);

  const token = 'a'.repeat(64);
  const validSession = { token_hash: hashWholesaleSessionToken(token), customer_id: enabledCustomer.id, wholesale_code_updated_at: enabledCustomer.wholesale_code_updated_at, expires_at: new Date(Date.now() + 60_000).toISOString() };
  assert.equal(await serverHarness({ session: validSession, customer: enabledCustomer }).isWholesaleSessionValid(token), true);
  assert.equal(await serverHarness({ session: { ...validSession, expires_at: new Date(Date.now() - 1000).toISOString() }, customer: enabledCustomer }).isWholesaleSessionValid(token), false);
  assert.equal(await serverHarness({ session: validSession, customer: { ...enabledCustomer, wholesale_access_active: false } }).isWholesaleSessionValid(token), false);
  assert.equal(await serverHarness({ session: validSession, customer: { ...enabledCustomer, wholesale_code_updated_at: '2026-10-07T03:00:01+00:00' } }).isWholesaleSessionValid(token), false);
  assert.equal(await isWholesaleSessionValid(token), false);
});

test('existing generated codes keep their case-sensitive hash and lookup behavior', async () => {
  const { hashWholesaleCode } = load('lib/wholesale-access.ts');
  const legacyCode = 'aA1Bc2De3Fg4Hi5Jk6Lm7No8';
  assert.equal(legacyCode.length, 24);
  const customer = { id: randomUUID(), wholesale_code_hash: hashWholesaleCode(legacyCode), wholesale_enabled: true, wholesale_access_active: true, archived_at: null, wholesale_code_updated_at: '2026-10-07T03:00:00+00:00' };
  const lookup = await serverHarness({ session: null, customer }).findActiveWholesaleCustomerByCode(legacyCode);
  assert.equal(lookup.customer.id, customer.id);
  assert.equal(lookup.matchedCode, legacyCode);
});

const nextServerMock = { NextResponse: { json(body, init) { const response = Response.json(body, init); response.cookies = { set(name, value, options) { response.testCookie = { name, value, options }; } }; return response; } } };
const req = (path, body) => new Request(`https://dcl.test${path}`, { method: 'POST', headers: { origin: 'https://dcl.test', 'content-type': 'application/json' }, body: JSON.stringify(body) });

function sessionRouteHarness(customer) {
  const calls = [];
  const { hashWholesaleCode, normalizeWholesaleCode } = load('lib/wholesale-access.ts');
  return { calls, ...load('app/api/wholesale/session/route.ts', {
    'next/server': nextServerMock,
    '@/lib/rate-limit': { rateLimit: () => null },
    '@/lib/store/buyer-session': { isSameOriginWrite: () => true },
    '@/lib/wholesale-server': {
      findActiveWholesaleCustomerByCode: async code => { calls.push(['lookup', code]); const normalized = normalizeWholesaleCode(code); return { customer, matchedCode: customer?.wholesale_code_hash === hashWholesaleCode(normalized) ? normalized : code, unavailable: false }; },
      createWholesaleSession: async (...args) => { calls.push(['create', ...args]); return true; },
      WHOLESALE_SESSION_COOKIE: 'dcl_wholesale_session', wholesaleSessionCookieOptions: { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 28800 },
    },
  }) };
}

test('valid access returns no customer data and establishes only an opaque HttpOnly cookie', async () => {
  const { hashWholesaleCode } = load('lib/wholesale-access.ts');
  const code = 'dcl2026';
  const customer = { id: randomUUID(), wholesale_code_hash: hashWholesaleCode('DCL2026'), wholesale_enabled: true, wholesale_access_active: true, archived_at: null, wholesale_code_updated_at: new Date().toISOString() };
  const h = sessionRouteHarness(customer);
  const response = await h.POST(req('/api/wholesale/session', { code }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.testCookie.options.httpOnly, true);
  assert.equal(response.testCookie.options.sameSite, 'lax');
  assert.match(response.testCookie.value, /^[a-f0-9]{64}$/);
  assert.equal(h.calls[1][1], customer.id);
  assert.equal(h.calls[1][2], customer.wholesale_code_updated_at);
});

test('manual code normalization and the existing 24-character code both establish sessions', async () => {
  const { hashWholesaleCode } = load('lib/wholesale-access.ts');
  for (const code of ['mAy001', 'aA1Bc2De3Fg4Hi5Jk6Lm7No8']) {
    const expected = code === 'mAy001' ? 'MAY001' : code;
    const customer = { id: randomUUID(), wholesale_code_hash: hashWholesaleCode(expected), wholesale_enabled: true, wholesale_access_active: true, archived_at: null, wholesale_code_updated_at: new Date().toISOString() };
    const response = await sessionRouteHarness(customer).POST(req('/api/wholesale/session', { code }));
    assert.equal(response.status, 200);
  }
});

test('invalid code receives the same generic response and does not create a session', async () => {
  const h = sessionRouteHarness(null);
  const response = await h.POST(req('/api/wholesale/session', { code: 'not-a-valid-code' }));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, error: 'Código inválido o acceso inactivo.' });
  assert.equal(h.calls.some(call => call[0] === 'create'), false);
});

test('catalog endpoint withholds all data without a valid wholesale session', async () => {
  const { GET } = load('app/api/wholesale/catalog/route.ts', {
    'next/server': nextServerMock,
    '@/lib/wholesale-server': { isWholesaleSessionValid: async () => false, loadWholesaleCatalog: async () => { throw new Error('must not load'); } },
  });
  const response = await GET();
  assert.equal(response.status, 401);
  assert.equal((await response.json()).data, undefined);
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('authorized catalog ignores browser prices and returns only server-loaded wholesale data', async () => {
  const { GET } = load('app/api/wholesale/catalog/route.ts', {
    'next/server': nextServerMock,
    '@/lib/wholesale-server': { isWholesaleSessionValid: async () => true, loadWholesaleCatalog: async () => [{ id: 'p1', name: 'LED', wholesalePrice: 1200 }] },
  });
  const response = await GET(new Request('https://dcl.test/api/wholesale/catalog?price=1&wholesalePrice=1'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.data, [{ id: 'p1', name: 'LED', wholesalePrice: 1200 }]);
  assert.doesNotMatch(JSON.stringify(body), /"price"|costPrice|marginPercentage|"stock"/);
});

test('catalog source filters products without a positive wholesale price', async () => {
  let selection = '';
  const rows = [
    { id: 'hidden', name: 'Sin precio', wholesale_price: null },
    { id: 'invalid', name: 'Precio cero', wholesale_price: 0 },
    { id: 'eligible', name: 'Con precio', description: '', image_url: '', category: 'Antiniebla', functions: [], connector_type: 'H7', vehicle_types: ['auto'], wholesale_price: 1500 },
  ];
  const dbMock = { from: () => ({
    select(value) { selection = value; return this; }, eq() { return this; }, not() { return this; }, gt() { return this; },
    order() { return Promise.resolve({ data: rows, error: null }); },
  }) };
  const { loadWholesaleCatalog } = load('lib/wholesale-server.ts', {
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => dbMock },
    'next/headers': { cookies: async () => ({ get: () => null }) },
  });
  const products = await loadWholesaleCatalog();
  assert.match(selection, /wholesale_price/);
  assert.match(selection, /functions/);
  assert.doesNotMatch(selection, /,price|,stock|cost_price|margin_percentage/);
  assert.deepEqual(products.map(product => product.id), ['eligible']);
  assert.equal(products[0].wholesalePrice, 1500);
  assert.equal(products[0].category, 'Auxiliar');
  assert.equal(products[0].functions.join(','), 'fog');
});

test('wholesale text search reuses product filters for connector, name, category and function', () => {
  const { filterWholesaleCatalogProducts } = load('lib/wholesale-catalog-search.ts');
  const products = [
    { id: 'h7', name: 'Iron Black X', description: 'Iluminación potente', imageUrl: '', category: 'Iluminación frontal', connectorType: 'H7', functions: [], vehicleTypes: ['auto'], wholesalePrice: 1200 },
    { id: 'fog', name: 'Auxiliar redondo', description: '', imageUrl: '', category: 'Auxiliar', connectorType: 'H11', functions: ['fog'], vehicleTypes: [], wholesalePrice: 900 },
  ];
  assert.equal(filterWholesaleCatalogProducts(products, 'H7').map(product => product.id).join(','), 'h7');
  assert.equal(filterWholesaleCatalogProducts(products, 'Iron Black').map(product => product.id).join(','), 'h7');
  assert.equal(filterWholesaleCatalogProducts(products, 'Antiniebla').map(product => product.id).join(','), 'fog');
  assert.equal(filterWholesaleCatalogProducts(products, '', 'Auxiliar').map(product => product.id).join(','), 'fog');
  assert.equal(filterWholesaleCatalogProducts([products[0], { ...products[0] }], 'H7').map(product => product.id).join(','), 'h7');
});

test('wholesale vehicle search reuses compatibility rules and rejects wrong year or position', () => {
  const { findWholesaleVehicleMatches } = load('lib/wholesale-catalog-search.ts');
  const products = [
    { id: 'low', name: 'LED H7', description: '', imageUrl: '', category: 'Iluminación frontal', connectorType: 'H7', functions: [], vehicleTypes: ['auto'], wholesalePrice: 1200 },
    { id: 'high', name: 'LED H4', description: '', imageUrl: '', category: 'Iluminación frontal', connectorType: 'H4', functions: [], vehicleTypes: ['auto'], wholesalePrice: 1500 },
  ];
  const compatibility = [{ id: 'fit-1', modelId: '308', brandName: 'Peugeot', modelName: '308', vehicleType: 'Auto', active: true, yearFrom: 2012, yearTo: 2016, version: null, connectorLow: 'H7', connectorHigh: 'H4', connectorFog: null, connectorAux: null, combinedHighLow: false, notes: '' }];
  const matches = findWholesaleVehicleMatches('Peugeot 308 2014 baja', products, compatibility);
  assert.equal(matches.map(match => match.product.id).join(','), 'low');
  assert.match(matches[0].fitments[0], /2012–2016 · Baja/);
  assert.equal(findWholesaleVehicleMatches('Peugeot 308', products, compatibility).length, 2);
  assert.equal(findWholesaleVehicleMatches('Peugeot 308 2018 baja', products, compatibility).length, 0);
  assert.equal(findWholesaleVehicleMatches('Peugeot 308 2014 antiniebla', products, compatibility).length, 0);
  assert.equal(findWholesaleVehicleMatches('Peugeot 308 2014 baja', [products[0], { ...products[0] }], compatibility).length, 1);
});

test('guided wholesale vehicle matches group compatibility rows by product id', () => {
  const { groupWholesaleVehicleMatches } = load('lib/wholesale-catalog-search.ts');
  const { vehicleProductMatches } = load('lib/vehicle-product-search.ts');
  const product = { id: 'same', name: 'LED H7', description: '', price: 0, image: '', category: 'Iluminación frontal', functions: [], vehicleTypes: ['auto'], featured: false, active: true, showInCatalog: true, href: '', ctaText: '', order: 0, connectorType: 'H7' };
  const rows = [
    { id: 'fit-low', modelId: '308', brandName: 'Peugeot', modelName: '308', vehicleType: 'Auto', active: true, yearFrom: 2012, yearTo: 2016, version: null, connectorLow: 'H7', connectorHigh: 'H7', connectorFog: null, connectorAux: null, combinedHighLow: false, notes: '' },
    { id: 'fit-high', modelId: '308', brandName: 'Peugeot', modelName: '308', vehicleType: 'Auto', active: true, yearFrom: 2012, yearTo: 2016, version: null, connectorLow: 'H7', connectorHigh: 'H7', connectorFog: null, connectorAux: null, combinedHighLow: false, notes: '' },
  ];
  const matches = vehicleProductMatches([product], rows, '2014');
  const grouped = groupWholesaleVehicleMatches(matches, '2014');
  assert.equal(matches.length, 4);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].product.id, 'same');
  assert.equal(grouped[0].fitments.length, 2);
});

test('normal public product loader omits wholesale_price from query and mapped response', async () => {
  let selected = '';
  const dbMock = { from: () => ({ select(columns) { selected = columns; return this; }, eq() { return this; }, order() { return Promise.resolve({ data: [{ id: 'p1', name: 'LED', description: '', price: 5000, wholesale_price: 1200, previous_price: null, category: 'Auxiliar', vehicle_types: [], functions: [], integrated_high_low: false, image_url: '', additional_image_urls: [], cta_text: 'VER', featured: false, active: true, show_in_catalog: true, sort_order: 1, watts: null, lumens: null, voltage: null, color_temperature: null, connector_type: null, canbus: false, chip_type: null, warranty: null, warranty_days: null }], error: null }); } }) };
  const { getSupabaseProducts } = load('lib/supabase/products.ts', {
    './client': { createBrowserClient: () => dbMock }, './server': { createServerClient: () => dbMock },
    './test-connection': { isSupabaseConfigured: () => true }, './storage': { sanitizeStoredImageUrl: value => value },
  });
  const products = await getSupabaseProducts();
  assert.doesNotMatch(selected, /wholesale_price/);
  assert.equal(products[0].wholesalePrice, undefined);
});
