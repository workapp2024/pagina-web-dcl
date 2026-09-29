/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Buffer } = require('node:buffer');
const { PGlite } = require('@electric-sql/pglite');
const load = require('./load-ts.cjs');
const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const password = 'new-password-12345';
const plain = value => JSON.parse(JSON.stringify(value));
const request = (body, method = 'POST') => new Request('https://test.invalid/api/admin/account', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function harness(role = 'ADMIN') {
  const state = { profile: role === 'legacy' || role === 'anonymous' ? null : { id, email: 'owner@example.test', display_name: 'Owner', role, active: true, session_version: 1 }, cookie: '', marker: false, writes: [], authCalls: [], failAuth: false, race: false };
  const db = { from(table) {
    let columns = '*', patch; const filters = [];
    const result = () => {
      const candidate = table === 'admin_bootstrap' ? (state.marker ? { id: 1 } : null) : state.profile;
      if (!candidate || !filters.every(([key, value]) => candidate[key] === value)) return { data: null, error: null };
      if (patch) { state.writes.push(plain(patch)); Object.assign(candidate, patch); }
      return { data: columns === '*' ? { ...candidate } : Object.fromEntries(columns.split(',').map(key => [key, candidate[key]])), error: null };
    };
    const chain = {
      select(value = '*') { columns = value; return chain; },
      eq(...args) { filters.push(args); return chain; },
      update(value) { patch = value; return chain; },
      insert(value) { state.writes.push(plain(value)); return chain; },
      maybeSingle: async () => result(),
      limit: async () => { const r = result(); return { data: r.data ? [r.data] : [], error: null }; },
      order: async () => { const r = result(); return { data: r.data ? [r.data] : [], error: null }; },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    }; return chain;
  }, rpc: async (name, args) => {
    assert.equal(name, 'complete_admin_bootstrap');
    if (state.marker || state.race || state.profile?.role === 'ADMIN') return { error: { message: 'BOOTSTRAP_CLOSED' } };
    state.marker = true;
    state.profile = { id: args.p_user, email: args.p_email, display_name: args.p_name, role: 'ADMIN', active: true, session_version: 1 };
    state.writes.push(plain(args)); return { data: args.p_user, error: null };
  }, auth: { admin: {
    createUser: async input => { state.authCalls.push({ action: 'create', input }); return { data: { user: { id, email: input.email } }, error: null }; },
    deleteUser: async uid => { state.authCalls.push({ action: 'delete', uid }); return { error: null }; },
    updateUserById: async (uid, input) => { state.authCalls.push({ action: 'update', uid, input }); return { data: { user: { id: uid } }, error: state.failAuth ? { message: 'Password rejected' } : null }; },
  } } };
  const env = { NODE_ENV: 'test', ADMIN_SESSION_SECRET: 'test-secret', ADMIN_PASSWORD: 'legacy-password', ADMIN_AUTH_MODE: 'legacy' };
  const server = { createAdminServerClient: () => db, createServerClient: () => ({ auth: { signInWithPassword: async () => ({ data: { user: { id } }, error: null }) } }), isServiceRoleConfigured: () => true };
  const auth = load('lib/admin-auth.ts', { '@/lib/supabase/server': server, 'next/headers': { cookies: async () => ({ get: () => ({ value: state.cookie }) }) } }, { Buffer, process: { env } });
  if (role !== 'anonymous') state.cookie = auth.createAdminSession(state.profile || undefined);
  const mocks = {
    '@/lib/admin-auth': auth, '@/lib/supabase/server': server, '@/lib/rate-limit': { rateLimit: () => null },
    'next/server': { NextResponse: { json: (body, init) => { const response = Response.json(body, init); response.cookies = { set: (key, value, options) => { state.setCookie = { key, value, options }; } }; return response; } } },
  };
  return { state, db, auth, env, mocks, api: path => load(`app/api/admin/${path}/route.ts`, mocks, { process: { env } }) };
}

test('legacy owner creates first ADMIN through Auth + server RPC; action closes in UI state and API', async () => {
  const h = harness('legacy');
  let response = await h.api('users').GET();
  assert.equal((await response.json()).bootstrapAvailable, true);
  const body = { name: 'Owner', email: 'owner@example.test', password, confirmation: password };
  response = await h.api('users/bootstrap').POST(request(body));
  assert.equal(response.status, 201); assert.equal(h.state.profile.role, 'ADMIN'); assert.equal(h.state.profile.active, true);
  assert.equal((await h.api('users/bootstrap').POST(request(body))).status, 409);
  assert.equal(h.state.authCalls.filter(call => call.action === 'create').length, 1);
  assert.equal((await (await h.api('users').GET()).json()).bootstrapAvailable, false);
  assert.equal((await h.auth.getAdminIdentity()).legacy, true, 'legacy access is not removed automatically');
});

test('anonymous, seller and individual ADMIN cannot use bootstrap; unknown client privileges are rejected', async () => {
  const body = { name: 'Owner', email: 'owner@example.test', password, confirmation: password };
  for (const role of ['anonymous','VENDEDOR','ADMIN']) {
    const h = harness(role); assert.equal((await h.api('users/bootstrap').POST(request(body))).status, 403); assert.equal(h.state.authCalls.length, 0);
  }
  const h = harness('legacy');
  assert.equal((await h.api('users/bootstrap').POST(request({ ...body, role: 'ADMIN' }))).status, 400);
  assert.equal((await h.api('users/bootstrap').POST(request({ ...body, confirmation: 'mismatch' }))).status, 400);
  h.env.ADMIN_AUTH_MODE = 'users'; assert.equal((await h.api('users/bootstrap').POST(request(body))).status, 403);
});

test('concurrent bootstrap loser cannot create a second profile and removes only its new Auth account', async () => {
  const h = harness('legacy'); h.state.race = true;
  assert.equal((await h.api('users/bootstrap').POST(request({ name: 'Owner', email: 'owner@example.test', password, confirmation: password }))).status, 409);
  assert.equal(h.state.profile, null);
  assert.deepEqual(h.state.authCalls.map(call => call.action), ['create','delete']);
});

test('new ADMIN can log in, retains all owner permissions, and user management rejects legacy sessions', async () => {
  const h = harness('legacy');
  await h.api('users/bootstrap').POST(request({ name: 'Owner', email: 'owner@example.test', password, confirmation: password }));
  assert.equal((await h.api('users').POST(request({}))).status, 403);
  assert.equal((await h.api('users').PATCH(request({ id, active: false }, 'PATCH'))).status, 403);
  const form = new FormData(); form.set('email', 'owner@example.test'); form.set('password', password);
  assert.equal((await h.api('login').POST(new Request('https://test.invalid', { method: 'POST', body: form }))).status, 200);
  h.state.cookie = h.state.setCookie.value;
  assert.equal(await h.auth.isIndividualAdmin(), true);
  for (const permission of ['admin','catalog','commercial','stock:read','orders:operate']) assert.equal(await h.auth.isAdminAuthenticated(permission), true);
  assert.equal((await h.api('users').GET()).status, 200);
});

test('My account shows only authenticated identity fields and permits display name changes', async () => {
  for (const role of ['ADMIN','VENDEDOR']) {
    const h = harness(role); const body = await (await h.api('account').GET()).json();
    assert.deepEqual(body.data, { display_name: 'Owner', email: 'owner@example.test', role });
    assert.equal((await h.api('account').PATCH(request({ name: 'New name' }, 'PATCH'))).status, 200);
    assert.equal(h.state.profile.display_name, 'New name'); assert.equal(h.state.authCalls.length, 0);
  }
});

test('ADMIN and VENDEDOR change only their own password through Auth and receive a renewed cookie', async () => {
  for (const role of ['ADMIN','VENDEDOR']) {
    const h = harness(role); const oldCookie = h.state.cookie;
    const response = await h.api('account').PATCH(request({ password, confirmation: password }, 'PATCH'));
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(plain(h.state.authCalls), [{ action: 'update', uid: id, input: { password } }]);
    assert.equal(h.state.writes.some(write => JSON.stringify(write).includes(password)), false);
    assert.equal(await h.auth.getAdminIdentity(), null, 'old cookie revoked');
    h.state.cookie = h.state.setCookie.value;
    assert.notEqual(h.state.cookie, oldCookie); assert.equal((await h.auth.getAdminIdentity()).role, role);
    assert.equal(h.state.setCookie.options.httpOnly, true);
  }
});

test('My account rejects role/active/session_version/email/other-user changes before any write', async () => {
  for (const extra of [{ role: 'ADMIN' }, { active: true }, { session_version: 99 }, { email: 'other@example.test' }, { id: otherId }, { userId: otherId }]) {
    const h = harness('VENDEDOR');
    assert.equal((await h.api('account').PATCH(request({ password, confirmation: password, ...extra }, 'PATCH'))).status, 400);
    assert.equal(h.state.writes.length, 0); assert.equal(h.state.authCalls.length, 0);
  }
});

test('My account rejects anonymous, legacy and inactive users, and mismatched or short passwords', async () => {
  for (const role of ['anonymous','legacy']) {
    const h = harness(role); assert.equal((await h.api('account').GET()).status, 401);
    assert.equal((await h.api('account').PATCH(request({ password, confirmation: password }, 'PATCH'))).status, 401);
  }
  const h = harness('VENDEDOR');
  for (const body of [{ password, confirmation: 'different' }, { password: 'short', confirmation: 'short' }]) assert.equal((await h.api('account').PATCH(request(body, 'PATCH'))).status, 400);
  h.state.profile.active = false;
  assert.equal((await h.api('account').PATCH(request({ name: 'Inactive' }, 'PATCH'))).status, 401);
});

test('failed Auth password update never renews a revoked session or returns password details', async () => {
  const h = harness(); h.state.failAuth = true;
  const response = await h.api('account').PATCH(request({ password, confirmation: password }, 'PATCH'));
  assert.equal(response.status, 400); assert.equal(h.state.setCookie.options.maxAge, 0);
  assert.equal(await h.auth.getAdminIdentity(), null);
  assert.equal(JSON.stringify(await response.json()).includes(password), false);
});

test('My account page rejects anonymous users and is allowed for both individual roles', async () => {
  for (const role of ['anonymous','legacy','ADMIN','VENDEDOR']) {
    const h = harness(role);
    h.mocks['next/navigation'] = { redirect: () => { throw new Error('REDIRECT'); } };
    h.mocks['next/link'] = () => null;
    h.mocks['@/components/admin/MyAccount'] = { MyAccount: () => null };
    const page = load('app/admin/mi-cuenta/page.tsx', h.mocks).default;
    if (role === 'anonymous') await assert.rejects(page(), /REDIRECT/);
    else assert.ok(await page());
  }
  const { canVisitAdminPage } = load('lib/admin-permissions.ts');
  assert.equal(canVisitAdminPage('VENDEDOR','/admin/mi-cuenta'), true);
});

test('account UI has no service role or server Auth import; secrets/passwords absent from profile schema', () => {
  for (const file of ['components/admin/MyAccount.tsx','components/admin/UsersManager.tsx']) {
    const source = fs.readFileSync(file,'utf8');
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|supabase\/server|auth\.admin/);
    assert.match(source, /type="password"/);
  }
  const sql = fs.readFileSync('supabase/migrations/20260930010000_staff_users_why_dcl.sql','utf8');
  assert.doesNotMatch(sql.match(/CREATE TABLE public.admin_profiles \([\s\S]*?\);/)[0], /password|secret|token/);
});

test('PostgreSQL bootstrap completion is unique, durable after deletion, and restricted to service role', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid primary key); CREATE TABLE public.site_settings(id integer primary key);
      INSERT INTO auth.users VALUES('${id}'),('${otherId}');`);
    await db.exec(fs.readFileSync('supabase/migrations/20260930010000_staff_users_why_dcl.sql','utf8'));
    for (const role of ['anon','authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(db.query(`SELECT complete_admin_bootstrap('${id}','owner@example.test','Owner')`), /permission denied/);
      await assert.rejects(db.query('SELECT * FROM admin_bootstrap'), /permission denied/);
      await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role');
    const results = await Promise.allSettled([
      db.query(`SELECT complete_admin_bootstrap('${id}','owner@example.test','Owner')`),
      db.query(`SELECT complete_admin_bootstrap('${otherId}','second@example.test','Second')`),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    await db.exec('RESET ROLE');
    assert.equal((await db.query("SELECT count(*)::int AS n FROM admin_profiles WHERE role='ADMIN'")).rows[0].n, 1);
    await db.exec('DELETE FROM admin_profiles');
    await assert.rejects(db.query(`SELECT complete_admin_bootstrap('${otherId}','second@example.test','Second')`), /BOOTSTRAP_CLOSED/);
  } finally { await db.close(); }
});
