const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./load-ts.cjs');
const customerId = '11111111-1111-4111-8111-111111111111';
const key = '22222222-2222-4222-8222-222222222222';
const request = (body, { url = 'https://dcl.test/api/wholesale/orders', origin = 'https://dcl.test', host = new URL(url).host } = {}) => new Request(url, {
  method: 'POST', headers: { origin, host, 'content-type': 'application/json' }, body,
});

function harness({ session = customerId, rpcError = null, nodeEnv = 'test' } = {}) {
  const calls = [];
  const { POST } = load('app/api/wholesale/orders/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/wholesale-server': { getWholesaleSessionCustomerId: async () => session },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => ({ rpc: async (...args) => { calls.push(args); return { data: '33333333-3333-4333-8333-333333333333', error: rpcError }; } }) },
    '@/lib/store/buyer-session': { isSameOriginWrite: request => request.headers.get('origin') === new URL(request.url).origin && request.headers.get('sec-fetch-site') !== 'cross-site' },
  }, { process: { env: { NODE_ENV: nodeEnv } } });
  return { POST, calls };
}

test('submission accepts the authorized private LAN origin in development', async () => {
  const h = harness({ nodeEnv: 'development' });
  const response = await h.POST(request(JSON.stringify({ attemptId: key }), {
    url: 'http://192.168.100.3:3000/api/wholesale/orders',
    origin: 'http://192.168.100.3:3000',
  }));
  assert.equal(response.status, 200);
  assert.equal(h.calls.length, 1);
});

test('submission accepts a valid same-origin production request', async () => {
  const h = harness({ nodeEnv: 'production' });
  const response = await h.POST(request(JSON.stringify({ attemptId: key })));
  assert.equal(response.status, 200);
  assert.equal(h.calls.length, 1);
});

test('submission rejects an external origin before invoking the RPC', async () => {
  const h = harness({ nodeEnv: 'development' });
  const response = await h.POST(request(JSON.stringify({ attemptId: key }), {
    url: 'http://192.168.100.3:3000/api/wholesale/orders',
    origin: 'https://attacker.example',
  }));
  assert.equal(response.status, 403);
  assert.equal(h.calls.length, 0);
});

test('wholesale order endpoint requires server session and ignores any customer_id supplied by browser', async () => {
  const unauthenticated = harness({ session: null });
  const unauthorizedResponse = await unauthenticated.POST(request(JSON.stringify({ attemptId: key })));
  assert.equal(unauthorizedResponse.status, 401);
  assert.equal(unauthenticated.calls.length, 0);
  const authorized = harness();
  const withCustomerId = await authorized.POST(request(JSON.stringify({ customer_id: 'attacker', attemptId: key })));
  assert.equal(withCustomerId.status, 400);
  assert.equal(authorized.calls.length, 0);
  const response = await authorized.POST(request(JSON.stringify({ attemptId: key })));
  assert.equal(response.status, 200);
  assert.equal(authorized.calls[0][1].p_customer, customerId);
  assert.equal(authorized.calls[0][0], 'submit_wholesale_order_attempt');
  assert.equal(authorized.calls[0][1].p_attempt, key);
  assert.equal(JSON.stringify(authorized.calls[0][1]), JSON.stringify({ p_customer: customerId, p_attempt: key }));
});

test('attempt submission rejects malformed IDs and any browser-supplied item override before RPC', async () => {
  for (const body of [ '{', JSON.stringify({ attemptId: 'bad' }),
    JSON.stringify({ attemptId: key, items: [{ productId: 'p1', quantity: 4 }] }),
    JSON.stringify({ attemptId: key, items: [{ productId: 'p1', quantity: 2, unit_price: 0 }] }) ]) {
    const h = harness();
    assert.equal((await h.POST(request(body))).status, 400);
    assert.equal(h.calls.length, 0);
  }
});

test('browser cannot supply products or prices when submitting a reserved attempt', async () => {
  const h = harness();
  const response = await h.POST(request(JSON.stringify({ attemptId: key, items: [{ productId: 'p1', quantity: 2, price: 0 }] })));
  assert.equal(response.status, 400);
  assert.equal(h.calls.length, 0);
});

test('known RPC eligibility and idempotency errors return controlled messages without PostgreSQL details', async () => {
  for (const [code, status] of [['WHOLESALE_PRODUCT_UNAVAILABLE', 422], ['WHOLESALE_IDEMPOTENCY_CONFLICT', 409]]) {
    const h = harness({ rpcError: { message: `ERROR ${code}: internal postgres details` } });
    const response = await h.POST(request(JSON.stringify({ attemptId: key })));
    assert.equal(response.status, status);
    assert.doesNotMatch(JSON.stringify(await response.json()), /postgres details/);
  }
});

test('legacy payload is rejected before RPC so a rollbacked client cannot create an ambiguous order', async () => {
  const h = harness();
  const body = JSON.stringify({ idempotencyKey: key, items: [{ productId: 'p1', quantity: 2 }] });
  const first = await h.POST(request(body));
  const second = await h.POST(request(JSON.stringify({ idempotencyKey: '44444444-4444-4444-8444-444444444444', items: [{ productId: 'p1', quantity: 2 }] })));
  assert.equal(first.status, 409);
  assert.equal(second.status, 409);
  assert.equal(h.calls.length, 0);
  assert.doesNotMatch(await first.text(), /idempotencyKey|secret|token/i);
  const source = fs.readFileSync('components/wholesale/WholesaleCatalog.tsx', 'utf8');
  const drawer = fs.readFileSync('components/wholesale/WholesaleCartDrawer.tsx', 'utf8');
  assert.doesNotMatch(source, /pendingRequest = useRef|crypto\.randomUUID|idempotencyKey/);
  assert.match(source, /if \(submissionInFlight\.current \|\| !Object\.keys\(currentSelection\)\.length\) return/);
  assert.match(source, /onSubmit=\{\(\) => void submitOrder\(\)\}/);
  assert.match(drawer, /disabled=\{busy\} onClick=\{onSubmit\}/);
  assert.match(source, /submissionInFlight\.current = true/);
});

test('new UI starts and retries attempts by ID while keeping pending and current selections separate', () => {
  const source = fs.readFileSync('components/wholesale/WholesaleCatalog.tsx', 'utf8');
  assert.match(source, /fetch\("\/api\/wholesale\/orders\/attempts"/);
  assert.match(source, /const attemptId = attemptBody\.data\?\.attemptId/);
  assert.match(source, /if \(attemptBody\.data\?\.recovered === true\)/);
  assert.match(source, /async function retryAttempt\(attemptId: string\)/);
  assert.match(source, /body: JSON\.stringify\(\{ attemptId \}\)/);
  assert.match(source, /attempt\.items\.map/);
  assert.match(source, /Reintentar este intento/);
  assert.match(source, /cerrá la solicitud pendiente/);
  assert.match(source, /if \(!response\.ok \|\| !body\.ok\) throw/);
  assert.ok(source.indexOf('if (attemptBody.data?.recovered === true)') < source.indexOf('clearSubmittedSelection(currentSelection)'));
  assert.match(source, /newIntent: true/);
  assert.doesNotMatch(source, /crypto\.randomUUID|idempotencyKey|pendingRequest/);
});

test('attempt endpoints derive customer identity from session and expose no client key', () => {
  const attempts = fs.readFileSync('app/api/wholesale/orders/attempts/route.ts', 'utf8');
  const submit = fs.readFileSync('app/api/wholesale/orders/route.ts', 'utf8');
  assert.match(attempts, /getWholesaleSessionCustomerId\(\)/);
  assert.match(attempts, /p_customer: customerId/);
  assert.match(attempts, /p_new_intent: payload\.newIntent === true/);
  assert.match(submit, /submit_wholesale_order_attempt/);
  assert.match(submit, /p_customer: customerId/);
});

test('attempt creation API passes only server session identity to RPC and rejects unauthenticated callers', async () => {
  const calls = [];
  const route = load('app/api/wholesale/orders/attempts/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/wholesale-server': { getWholesaleSessionCustomerId: async () => customerId },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => ({ rpc: async (...args) => { calls.push(args); return { data: { attemptId: '33333333-3333-4333-8333-333333333333', status: 'open' }, error: null }; } }) },
    '@/lib/store/buyer-session': { isSameOriginWrite: () => true },
  });
  const valid = new Request('https://dcl.test/api/wholesale/orders/attempts', {
    method: 'POST', headers: { origin: 'https://dcl.test', 'content-type': 'application/json' },
    body: JSON.stringify({ items: [{ productId: 'p1', quantity: 1 }] }),
  });
  assert.equal((await route.POST(valid)).status, 200);
  assert.equal(calls[0][1].p_customer, customerId);
  assert.equal(JSON.stringify(calls[0][1]), JSON.stringify({ p_customer: customerId, p_items: [{ productId: 'p1', quantity: 1 }], p_new_intent: false }));
  assert.equal(calls[0][1].p_new_intent, false);

  const anonymousRoute = load('app/api/wholesale/orders/attempts/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/wholesale-server': { getWholesaleSessionCustomerId: async () => null },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => ({ rpc: async () => { throw new Error('must not call'); } }) },
    '@/lib/store/buyer-session': { isSameOriginWrite: () => true },
  });
  assert.equal((await anonymousRoute.POST(valid)).status, 401);
});

test('attempt creation accepts the authorized private LAN origin in development', async () => {
  const calls = [];
  const route = load('app/api/wholesale/orders/attempts/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/wholesale-server': { getWholesaleSessionCustomerId: async () => customerId },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => ({ rpc: async (...args) => {
      calls.push(args);
      return { data: { attemptId: key, status: 'open' }, error: null };
    } }) },
    '@/lib/store/buyer-session': { isSameOriginWrite: request => request.headers.get('origin') === new URL(request.url).origin && request.headers.get('sec-fetch-site') !== 'cross-site' },
  }, { process: { env: { NODE_ENV: 'development' } } });
  const lanRequest = new Request('http://192.168.100.3:3000/api/wholesale/orders/attempts', {
    method: 'POST',
    headers: { origin: 'http://192.168.100.3:3000', host: '192.168.100.3:3000', 'content-type': 'application/json' },
    body: JSON.stringify({ items: [{ productId: 'p1', quantity: 1 }] }),
  });

  assert.equal((await route.POST(lanRequest)).status, 200);
  assert.equal(calls.length, 1);
});

test('attempt creation rejects an external origin before invoking the RPC', async () => {
  const calls = [];
  const route = load('app/api/wholesale/orders/attempts/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/wholesale-server': { getWholesaleSessionCustomerId: async () => customerId },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => ({ rpc: async (...args) => {
      calls.push(args);
      return { data: { attemptId: key, status: 'open' }, error: null };
    } }) },
    '@/lib/store/buyer-session': { isSameOriginWrite: request => request.headers.get('origin') === new URL(request.url).origin && request.headers.get('sec-fetch-site') !== 'cross-site' },
  }, { process: { env: { NODE_ENV: 'development' } } });
  const externalRequest = new Request('http://192.168.100.3:3000/api/wholesale/orders/attempts', {
    method: 'POST',
    headers: { origin: 'https://attacker.example', host: '192.168.100.3:3000', 'content-type': 'application/json' },
    body: JSON.stringify({ items: [{ productId: 'p1', quantity: 1 }] }),
  });

  const response = await route.POST(externalRequest);
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});

test('attempt recovery API returns original item IDs and quantities without the private idempotency key', async () => {
  const attempt = { attemptId: key, status: 'open', createdAt: '2026-10-08T00:00:00Z', items: [{ productId: 'p1', quantity: 3 }], order: null };
  const calls = [];
  const route = load('app/api/wholesale/orders/attempts/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/wholesale-server': { getWholesaleSessionCustomerId: async () => customerId },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => ({ rpc: async (...args) => { calls.push(args); return { data: [attempt], error: null }; } }) },
    '@/lib/store/buyer-session': { isSameOriginWrite: () => true },
  });
  const response = await route.GET();
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(calls[0][1].p_customer, customerId);
  assert.deepEqual(result.data[0].items, [{ productId: 'p1', quantity: 3 }]);
  assert.doesNotMatch(JSON.stringify(result), /idempotencyKey|idempotency_key/);
});

test('order history API validates pagination and maps only customer-scoped RPC results', async () => {
  const reads = [];
  const query = {
    select(fields) { reads.push(['select',fields]); return this; },
    in(field, values) { reads.push(['in',field,Array.from(values)]); return this; },
    order() { return this; },
    async range() { return {data:[
      {id:1,order_id:'order-1',event_type:'delivery_recorded',created_at:'2026-10-13T12:00:00Z',actor_id:'PRIVATE',notes:'PRIVATE'},
      {id:2,order_id:'other-customer',event_type:'order_confirmed',created_at:'2026-10-13T12:00:00Z'},
      {id:3,order_id:'order-1',event_type:'private_note',created_at:'2026-10-13T12:00:00Z'},
    ],error:null}; },
  };
  const route = load('app/api/wholesale/orders/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/wholesale-server': { getWholesaleSessionCustomerId: async () => customerId },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => ({ rpc: async () => ({ data: [{ id: 'order-1' }], error: null }), from: table => { if(table==='site_settings') return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{whatsapp:'5492617791393'},error:null})}; if(table==='wholesale_payment_entries') return {select(){return this;},in(){return this;},order(){return this;},range:async()=>({data:[],error:null})}; assert.equal(table,'wholesale_order_events'); return query; } }) },
    '@/lib/store/buyer-session': { isSameOriginWrite: () => true },
  });
  const response = await route.GET(new Request('https://dcl.test/api/wholesale/orders?limit=25'));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.data, [{ id: 'order-1', whatsapp:'5492617791393',transfer_notices:[],payment_summary:null, tracking_events:[{id:'1',type:'delivery_recorded',at:'2026-10-13T12:00:00Z'}] }]);
  assert.deepEqual(reads[0],['select','id,order_id,event_type,created_at']);
  assert.deepEqual(reads[1],['in','order_id',['order-1']]);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|other-customer|private_note|actor_id|notes/);
});
