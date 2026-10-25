const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');
const publicOrigin = 'https://pagina-web-dcl.onrender.com';
function guard(configured = publicOrigin) {
  return load('lib/store/buyer-session.ts', { 'next/headers': {}, '@/lib/supabase/server': {} }, { Buffer, process: { env: { NODE_ENV: 'production', NEXT_PUBLIC_SITE_URL: configured } } }).isSameOriginWrite;
}
function request(url, origin, host = 'pagina-web-dcl.onrender.com', extra = {}) {
  return new Request(url, { method: 'POST', headers: { ...(origin ? { origin } : {}), host, ...extra } });
}
test('Render internal request URL accepts configured public HTTPS origin only with matching Host', () => {
  for (const url of ['http://localhost:10000/api/store/buyer-session', 'https://localhost:10000/api/store/orders']) {
    assert.equal(guard()(request(url, publicOrigin)), true);
    assert.equal(guard()(request(url, publicOrigin, 'evil.invalid')), false);
    assert.equal(guard()(request(url, publicOrigin, 'pagina-web-dcl.onrender.com:444')), false);
  }
});
test('CSRF protection rejects cross-site, missing/null/foreign origin and spoofed forwarding headers', () => {
  const url = 'http://localhost:10000/api/store/buyer-session';
  for (const origin of [null, 'null', 'https://evil.invalid', 'https://pagina-web-dcl.vercel.app', publicOrigin + '/', publicOrigin + '.evil.invalid', 'http://pagina-web-dcl.onrender.com']) assert.equal(guard()(request(url, origin)), false);
  assert.equal(guard()(request(url, publicOrigin, 'pagina-web-dcl.onrender.com', { 'sec-fetch-site': 'cross-site' })), false);
  assert.equal(guard()(request(url, 'https://evil.invalid', 'evil.invalid', { 'x-forwarded-host': 'evil.invalid', 'x-forwarded-proto': 'https' })), false);
  for (const configured of ['', 'bad', 'http://pagina-web-dcl.onrender.com', publicOrigin + '/checkout', publicOrigin + '?x=1', publicOrigin + '#x', 'https://user:secret@pagina-web-dcl.onrender.com']) assert.equal(guard(configured)(request(url, publicOrigin)), false);
});
test('direct same-origin requests preserve existing local and production behavior', () => {
  assert.equal(guard('')(request(publicOrigin + '/api', publicOrigin)), true);
  assert.equal(guard('')(request('http://localhost:3000/api', 'http://localhost:3000', 'localhost:3000')), true);
  assert.equal(guard()(request(publicOrigin + '/api', publicOrigin, 'pagina-web-dcl.onrender.com', { 'sec-fetch-site': 'cross-site' })), false);
});
test('buyer-session route rejects CSRF before session work and permits proxy-safe session creation', async () => {
  let sessions = 0;
  const route = load('app/api/store/buyer-session/route.ts', {
    '@/lib/rate-limit': { rateLimit: () => null },
    '@/lib/store/buyer-session': { isSameOriginWrite: guard(), establishBuyerSession: async () => { sessions++; } },
  });
  const url = 'http://localhost:10000/api/store/buyer-session';
  assert.equal((await route.POST(request(url, 'https://evil.invalid'))).status, 403);
  assert.equal(sessions, 0);
  assert.equal((await route.POST(request(url, publicOrigin))).status, 200);
  assert.equal(sessions, 1);
});
