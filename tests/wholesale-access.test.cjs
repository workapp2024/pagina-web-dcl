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
  const dbMock = { from: table => ({
    select() { return this; }, eq() { return this; },
    maybeSingle: async () => table === 'wholesale_access_sessions' ? { data: session, error: null } : { data: customer, error: null },
  }) };
  return load('lib/wholesale-server.ts', {
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => dbMock },
    'next/headers': { cookies: async () => ({ get: () => null }) },
  });
}

test('code lookup and session authorization reject inactive, archived, expired, and replaced access', async () => {
  const { generateWholesaleCode, hashWholesaleCode, hashWholesaleSessionToken } = load('lib/wholesale-access.ts');
  const { isWholesaleSessionValid } = serverHarness({ session: null, customer: null });
  const code = generateWholesaleCode();
  const enabledCustomer = { id: randomUUID(), wholesale_code_hash: hashWholesaleCode(code), wholesale_enabled: true, wholesale_access_active: true, archived_at: null, wholesale_code_updated_at: '2026-10-07T03:00:00+00:00' };
  const lookup = await serverHarness({ session: null, customer: enabledCustomer }).findActiveWholesaleCustomerByCode(code);
  assert.equal(lookup.customer.id, enabledCustomer.id);
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

const nextServerMock = { NextResponse: { json(body, init) { const response = Response.json(body, init); response.cookies = { set(name, value, options) { response.testCookie = { name, value, options }; } }; return response; } } };
const req = (path, body) => new Request(`https://dcl.test${path}`, { method: 'POST', headers: { origin: 'https://dcl.test', 'content-type': 'application/json' }, body: JSON.stringify(body) });

function sessionRouteHarness(customer) {
  const calls = [];
  return { calls, ...load('app/api/wholesale/session/route.ts', {
    'next/server': nextServerMock,
    '@/lib/rate-limit': { rateLimit: () => null },
    '@/lib/store/buyer-session': { isSameOriginWrite: () => true },
    '@/lib/wholesale-server': {
      findActiveWholesaleCustomerByCode: async code => { calls.push(['lookup', code]); return { customer, unavailable: false }; },
      createWholesaleSession: async (...args) => { calls.push(['create', ...args]); return true; },
      WHOLESALE_SESSION_COOKIE: 'dcl_wholesale_session', wholesaleSessionCookieOptions: { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 28800 },
    },
  }) };
}

test('valid access returns no customer data and establishes only an opaque HttpOnly cookie', async () => {
  const { generateWholesaleCode, hashWholesaleCode } = load('lib/wholesale-access.ts');
  const code = generateWholesaleCode();
  const customer = { id: randomUUID(), wholesale_code_hash: hashWholesaleCode(code), wholesale_enabled: true, wholesale_access_active: true, archived_at: null, wholesale_code_updated_at: new Date().toISOString() };
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

test('authorized catalog returns only eligible product data, including its wholesale price', async () => {
  const { GET } = load('app/api/wholesale/catalog/route.ts', {
    'next/server': nextServerMock,
    '@/lib/wholesale-server': { isWholesaleSessionValid: async () => true, loadWholesaleCatalog: async () => [{ id: 'p1', name: 'LED', wholesalePrice: 1200 }] },
  });
  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, [{ id: 'p1', name: 'LED', wholesalePrice: 1200 }]);
});

test('catalog source filters products without a positive wholesale price', async () => {
  let selection = '';
  const rows = [
    { id: 'hidden', name: 'Sin precio', wholesale_price: null },
    { id: 'invalid', name: 'Precio cero', wholesale_price: 0 },
    { id: 'eligible', name: 'Con precio', description: '', image_url: '', category: 'Auxiliar', connector_type: null, vehicle_types: [], wholesale_price: 1500 },
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
  assert.deepEqual(products.map(product => product.id), ['eligible']);
  assert.equal(products[0].wholesalePrice, 1500);
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
