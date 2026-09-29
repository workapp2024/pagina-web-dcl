/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Buffer, File } = require('node:buffer');
const { PGlite } = require('@electric-sql/pglite');
const load = require('./load-ts.cjs');
const permissions = load('lib/admin-permissions.ts');
const id = '11111111-1111-4111-8111-111111111111';
const plain = value => JSON.parse(JSON.stringify(value));
const request = (body, method = 'POST') => new Request('https://test.invalid/api/admin/test', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function harness(role = 'VENDEDOR') {
  const state = { profile: { id, role, active: true, session_version: 1, email: 'staff@example.test', display_name: 'Staff' }, cookie: '', writes: [], calls: [] };
  const db = { from(table) {
    const call = { table, filters: [] }; state.calls.push(call);
    const result = () => ({ data: table === 'admin_profiles' ? state.profile : [], error: null });
    const chain = {
      select() { return chain; }, eq(...args) { call.filters.push(args); return chain; }, order() { return Promise.resolve(result()); },
      maybeSingle: async () => result(), single: async () => result(),
      insert(value) { state.writes.push({ table, value: plain(value) }); return chain; },
      update(value) { state.writes.push({ table, value: plain(value) }); return chain; },
      upsert(value) { state.writes.push({ table, value: plain(value) }); return chain; },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    }; return chain;
  }, auth: { admin: { createUser: async input => { state.created = input; return { data: { user: { id, email: input.email } }, error: null }; }, deleteUser: async () => ({ error: null }) } } };
  const server = { createAdminServerClient: () => db, isServiceRoleConfigured: () => true };
  const env = { NODE_ENV: 'test', ADMIN_SESSION_SECRET: 'test-secret', ADMIN_PASSWORD: 'old-owner-password', ADMIN_AUTH_MODE: 'users' };
  const auth = load('lib/admin-auth.ts', { '@/lib/supabase/server': server, 'next/headers': { cookies: async () => ({ get: () => ({ value: state.cookie }) }) } }, { Buffer, process: { env } });
  state.cookie = auth.createAdminSession(state.profile);
  const mocks = { '@/lib/admin-auth': auth, '@/lib/supabase/server': server, '@/lib/rate-limit': { rateLimit: () => null }, '@/lib/supabase/products': { mapAdminProductRow: x => x }, '@/lib/store/analytics-outbox': { scheduleAnalyticsFlush() {} } };
  return { state, auth, db, mocks, env };
}

test('signed identity is server-derived; inactive, changed version, forged, expired and legacy sessions fail closed', async () => {
  const h = harness();
  assert.equal((await h.auth.getAdminIdentity()).role, 'VENDEDOR');
  assert.equal(await h.auth.isAdminAuthenticated(), false);
  assert.equal(await h.auth.isAdminAuthenticated('catalog'), true);
  h.state.profile.active = false; assert.equal(await h.auth.getAdminIdentity(), null);
  h.state.profile.active = true; h.state.profile.session_version++; assert.equal(await h.auth.getAdminIdentity(), null);
  h.state.cookie = h.auth.createAdminSession(h.state.profile) + 'x'; assert.equal(await h.auth.getAdminIdentity(), null);
  h.state.cookie = h.auth.createAdminSession(); assert.equal(await h.auth.getAdminIdentity(), null);
  h.env.ADMIN_AUTH_MODE = 'legacy'; assert.equal((await h.auth.getAdminIdentity()).role, 'ADMIN');
  h.env.ADMIN_AUTH_MODE = 'users'; assert.equal(await h.auth.getAdminIdentity(), null);
  const payload = Buffer.from(JSON.stringify({ v: 2, sub: id, role: 'ADMIN', version: 2, exp: 1 })).toString('base64url');
  h.state.cookie = payload + '.' + require('node:crypto').createHmac('sha256', h.env.ADMIN_SESSION_SECRET).update(payload).digest('base64url');
  assert.equal(await h.auth.getAdminIdentity(), null);
});

test('individual login validates Auth and active profile; client-supplied role cannot elevate; old login is disabled in users mode', async () => {
  const h = harness(); let setCookie;
  h.mocks['@/lib/supabase/server'].createServerClient = () => ({ auth: { signInWithPassword: async () => ({ data: { user: { id } }, error: null }) } });
  h.mocks['next/server'] = { NextResponse: { json: (body, init) => { const response = Response.json(body, init); response.cookies = { set: (_key, value, options) => { setCookie = { value, options }; } }; return response; } } };
  const api = load('app/api/admin/login/route.ts', h.mocks, { process: { env: h.env } });
  const login = (email = 'staff@example.test') => { const form = new FormData(); form.set('email', email); form.set('password', h.env.ADMIN_PASSWORD); form.set('role', 'ADMIN'); return api.POST(new Request('https://test.invalid', { method: 'POST', body: form })); };
  assert.equal((await login()).status, 200);
  h.state.cookie = setCookie.value;
  assert.equal((await h.auth.getAdminIdentity()).role, 'VENDEDOR');
  assert.equal(setCookie.options.httpOnly, true); assert.equal(setCookie.options.sameSite, 'lax');
  assert.equal((await login('')).status, 401);
  h.state.profile.active = false; assert.equal((await login()).status, 401);
  h.env.ADMIN_AUTH_MODE = 'legacy'; assert.equal((await login('')).status, 200);
});

test('ADMIN retains all pages; seller page allowlist excludes owner modules and unknown routes', () => {
  for (const path of ['/admin', '/admin/productos', '/admin/compatibilidades', '/admin/ventas', '/admin/pedidos', '/admin/clientes', '/admin/inventario', '/admin/pedidos/DCL-123456/comprobante']) assert.equal(permissions.canVisitAdminPage('VENDEDOR', path), true, path);
  for (const path of ['/admin/finanzas', '/admin/configuracion', '/admin/usuarios', '/admin/home', '/admin/analitica', '/admin/unknown']) {
    assert.equal(permissions.canVisitAdminPage('VENDEDOR', path), false, path);
    assert.equal(permissions.canVisitAdminPage('ADMIN', path), true, path);
  }
});

test('server pages enforce roles independently of navigation, including direct owner URLs', async () => {
  for (const role of ['ADMIN', 'VENDEDOR']) {
    for (const path of ['productos', 'compatibilidades', 'pedidos', 'ventas', 'clientes', 'inventario', 'finanzas', 'configuracion', 'usuarios', 'home', 'analitica']) {
      if (role === 'ADMIN' && path === 'analitica') continue; // Do not execute unrelated analytics reads.
      const h = harness(role);
      const file = `app/admin/${path}/page.tsx`;
      const source = fs.readFileSync(file, 'utf8');
      for (const [, imported] of source.matchAll(/from\s+["'](@\/components\/[^"']+)["']/g)) h.mocks[imported] = new Proxy({}, { get: () => () => null });
      h.mocks['next/navigation'] = { redirect: to => { throw new Error(`REDIRECT:${to}`); } };
      const page = load(file, h.mocks).default;
      if (permissions.canVisitAdminPage(role, `/admin/${path}`)) assert.ok(await page({ searchParams: Promise.resolve({}) }), `${role}:${path}`);
      else await assert.rejects(page({ searchParams: Promise.resolve({}) }), /REDIRECT:\/admin\/login/, `${role}:${path}`);
    }
  }
});

test('direct restricted APIs reject seller before data access or writes', async () => {
  for (const [route, method] of [['site-settings','POST'], ['home-settings','POST'], ['users','GET'], ['users','POST'], ['users','PATCH'], ['inventory','POST'], ['finances','GET'], ['dashboard','GET'], ['orders/archive','POST'], ['orders/resolve','POST'], ['analytics/detail','GET']]) {
    const h = harness(); const api = load(`app/api/admin/${route}/route.ts`, h.mocks);
    const response = await api[method](method === 'GET' ? new Request('https://test.invalid') : request({ role: 'ADMIN', active: true }));
    assert.ok([401,403].includes(response.status), route);
    assert.equal(h.state.writes.length, 0, route);
    assert.ok(h.state.calls.every(call => call.table === 'admin_profiles'), route);
  }
});

test('seller cannot perform sensitive actions on otherwise permitted endpoints', async () => {
  for (const [route, body] of [['orders', { action: 'confirm_transfer', orderId: id }], ['customers', { action: 'delete', customerId: id }], ['customers', { action: 'archive', customerId: id }]]) {
    const h = harness(); const response = await load(`app/api/admin/${route}/route.ts`, h.mocks).POST(request(body));
    assert.equal(response.status, 403); assert.equal(h.state.writes.length, 0);
  }
});

test('seller creates/edits products with main and additional images, without writing stock', async () => {
  for (const exists of [false, true]) {
    const h = harness(); const original = h.db.from;
    h.db.from = table => { const chain = original(table); if (table === 'products') chain.maybeSingle = async () => ({ data: exists ? { id: 'p', category: 'General' } : null, error: null }); return chain; };
    const api = load('app/api/admin/products/route.ts', h.mocks);
    const response = await api.POST(request({ role: 'ADMIN', product: { id: 'p', name: 'LED', category: 'General', image: '/main.webp', images: ['/extra.webp'], price: 100, stock: 999 } }));
    assert.equal(response.status, 200);
    const saved = h.state.writes[0].value;
    assert.equal(saved.name, 'LED'); assert.equal(saved.image_url, '/main.webp'); assert.deepEqual(saved.additional_image_urls, ['/extra.webp']);
    assert.equal(Object.hasOwn(saved, 'stock'), false);
    assert.equal((await api.PATCH(request({ id: 'p', classification: { category: 'General', vehicleTypes: [], functions: [] } }, 'PATCH'))).status, exists ? 200 : 404);
  }
});

test('seller upload uses server storage and is restricted to products', async () => {
  const h = harness(); let uploads = 0;
  h.db.storage = { from: bucket => { assert.equal(bucket, 'dcl-media'); return { upload: async path => { uploads++; return { data: { path }, error: null }; } }; } };
  h.mocks['@/lib/supabase/storage'] = { STORAGE_BUCKET: 'dcl-media', validateImageFile: () => ({ valid: true }), generateStoragePath: category => `${category}/image.png`, getStoragePublicUrl: path => `https://test.invalid/${path}` };
  const api = load('app/api/admin/upload/route.ts', h.mocks, { File });
  const upload = category => { const form = new FormData(); form.set('category', category); form.set('file', new File(['image'], 'image.png', { type: 'image/png' })); return api.POST(new Request('https://test.invalid', { method: 'POST', body: form })); };
  assert.equal((await upload('products')).status, 200);
  for (const category of ['site','hero','../site','music']) assert.equal((await upload(category)).status, 403);
  assert.equal(uploads, 1);
});

test('seller reaches sales, customers, compatibility and operational handlers; stock GET remains permitted', async () => {
  for (const route of ['sales','customers','vehicle-compatibility','orders/operational-status']) {
    const h = harness(); const api = load(`app/api/admin/${route}/route.ts`, h.mocks);
    const response = await api.POST(request({}));
    assert.equal(response.status, 400, route);
  }
  const h = harness();
  const response = await load('app/api/admin/inventory/route.ts', h.mocks).GET(new Request('https://test.invalid'));
  assert.equal(response.status, 200);
});

test('seller can create sales and customers and submit operational transitions through existing RPCs', async () => {
  const cases = [
    ['sales', { action: 'create_sale', customerId: id, items: [{ productId: 'p', quantity: 1 }], paymentMethod: 'cash', idempotencyKey: id }, 'create_sale_with_inventory', id],
    ['customers', { action: 'create', fullName: 'Customer' }, 'admin_manage_customer', { id }],
    ['orders/operational-status', { orderId: id, expectedStatus: 'received', status: 'preparing', note: 'Preparing' }, 'set_order_operational_status', 'preparing'],
  ];
  for (const [route, body, expectedRpc, data] of cases) {
    const h = harness(); let called;
    h.db.rpc = async (name, args) => { called = { name, args }; return { data, error: null }; };
    const response = await load(`app/api/admin/${route}/route.ts`, h.mocks).POST(request(body));
    assert.equal(response.status, 200, route);
    assert.equal(called.name, expectedRpc, route);
  }
});

test('ADMIN creates only sellers and toggles only seller profiles; never returns passwords', async () => {
  const h = harness('ADMIN'); const api = load('app/api/admin/users/route.ts', h.mocks);
  const response = await api.POST(request({ name: 'Seller', email: 'seller@example.test', password: 'initial-password-123', role: 'VENDEDOR' }));
  assert.equal(response.status, 201); assert.equal(h.state.writes[0].value.role, 'VENDEDOR');
  assert.equal(JSON.stringify(await response.json()).includes('password'), false);
  assert.equal((await api.POST(request({ name: 'Bad', email: 'bad@example.test', password: 'initial-password-123', role: 'ADMIN' }))).status, 400);
  assert.equal((await api.PATCH(request({ id, active: false }, 'PATCH'))).status, 200);
  assert.ok(h.state.calls.some(call => call.filters.some(([key,value]) => key === 'role' && value === 'VENDEDOR')));
  assert.equal((await api.PATCH(request({ id, active: true, role: 'ADMIN' }, 'PATCH'))).status, 400);
});

test('Why DCL renders original cards by default, configured text, or nothing', () => {
  const { renderToStaticMarkup } = require('react-dom/server');
  const settings = { whyUsSectionTitle: 'Custom title', whyUsEnabled: true, whyUsDisplayMode: 'cards', whyUsText: 'Long paragraph\nSecond line <script>' };
  const render = () => renderToStaticMarkup(load('components/sections/WhyUs.tsx', { '@/components/providers/SiteContentProvider': { useSiteContent: () => ({ content: { siteSettings: settings } }) } }).WhyUs());
  const cards = render(); assert.equal((cards.match(/<article/g) || []).length, 4); assert.match(cards, /Custom title/);
  settings.whyUsDisplayMode = 'text'; const text = render(); assert.doesNotMatch(text, /<article/); assert.match(text, /Long paragraph/); assert.match(text, /&lt;script&gt;/);
  settings.whyUsEnabled = false; assert.equal(render(), '');
});

test('Why DCL patch validates mode and boolean and excludes secrets; owner can save', async () => {
  const { buildSiteSettingsPatch } = load('lib/site-settings-patch.ts');
  const config = { whyUsEnabled: false, whyUsDisplayMode: 'text', whyUsText: 'Paragraph', whyUsSectionTitle: 'Title' };
  assert.deepEqual(plain(buildSiteSettingsPatch('home', config)), { why_us_enabled: false, why_us_display_mode: 'text', why_us_text: 'Paragraph', why_us_section_title: 'Title' });
  for (const changes of [{ whyUsDisplayMode: 'html' }, { whyUsEnabled: 'false' }, { whyUsText: 'a'.repeat(4001) }, { serviceRole: 'secret' }]) assert.throws(() => buildSiteSettingsPatch('home', changes));
  const h = harness('ADMIN');
  assert.equal((await load('app/api/admin/site-settings/route.ts', h.mocks).POST(request({ section: 'home', siteSettings: config }))).status, 200);
});

test('additive SQL preserves current Home, protects profiles, invalidates sessions on status/role changes', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid primary key);
      CREATE TABLE public.site_settings(id integer primary key, why_us_section_title text);
      INSERT INTO public.site_settings VALUES(1,'Existing title');`);
    await db.exec(fs.readFileSync('supabase/migrations/20260930010000_staff_users_why_dcl.sql','utf8'));
    const home = (await db.query('SELECT * FROM site_settings')).rows[0];
    assert.equal(home.why_us_enabled, true); assert.equal(home.why_us_display_mode, 'cards'); assert.equal(home.why_us_section_title, 'Existing title');
    await db.exec(`INSERT INTO auth.users VALUES('${id}'); INSERT INTO admin_profiles(id,email,role) VALUES('${id}','staff@example.test','VENDEDOR'); UPDATE admin_profiles SET active=false WHERE id='${id}'; UPDATE admin_profiles SET active=true WHERE id='${id}';`);
    assert.equal((await db.query('SELECT session_version FROM admin_profiles')).rows[0].session_version, 3);
    for (const role of ['anon','authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(db.query('SELECT * FROM admin_profiles'), /permission denied/);
      await assert.rejects(db.query(`UPDATE admin_profiles SET role='ADMIN'`), /permission denied/);
      await db.exec('RESET ROLE');
    }
  } finally { await db.close(); }
});
