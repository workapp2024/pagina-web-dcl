/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const load = require('./load-ts.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
const contextApi = load('lib/store/analytics-context.ts');
const row = () => ({ id: randomUUID(), event_type: 'order_created', distinct_id: randomUUID(), session_id: randomUUID(), environment: 'production', occurred_at: '2026-09-23T12:00:00.123456+00:00', properties: { order_id: randomUUID(), total: 200 }, lease_token: randomUUID() });
function harness({ response = { ok: true, status: 200 }, fetchError, ackError, configured = true, claimError = false } = {}) {
  const calls = [], requests = [], callbacks = []; const event = row();
  const api = load('lib/store/analytics-outbox.ts', {
    'next/server': { after: callback => callbacks.push(callback) },
    '@/lib/supabase/server': { createAdminServerClient: () => ({ rpc: async (name, args) => {
      calls.push({ name, args: plain(args) });
      if (name === 'claim_analytics_outbox') return { data: [event], error: claimError ? {} : null };
      return { data: !ackError, error: ackError ? {} : null };
    } }) },
  }, {
    process: { env: configured ? { NODE_ENV: 'production', VERCEL_ENV: 'production', NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'public-token', NEXT_PUBLIC_POSTHOG_HOST: 'https://example.invalid', POSTHOG_PERSONAL_API_KEY: 'never-send-private' } : {} },
    AbortSignal,
    fetch: async (url, options) => { requests.push({ url: String(url), options }); if (fetchError) throw fetchError; return response; },
  });
  return { api, calls, requests, callbacks, event };
}

test('browser context uses real SDK APIs, accepts UUIDs, omits unavailable sessions and fails open', () => {
  const distinct_id = randomUUID(), session_id = randomUUID();
  const sdk = { __loaded: true, get_distinct_id: () => distinct_id, get_session_id: () => session_id };
  assert.deepEqual(plain(contextApi.readBrowserAnalyticsContext(sdk)), { distinct_id, session_id });
  assert.deepEqual(plain(contextApi.readBrowserAnalyticsContext({ ...sdk, get_session_id: () => '' })), { distinct_id });
  assert.equal(contextApi.readBrowserAnalyticsContext({ ...sdk, __loaded: false }), null);
  assert.equal(contextApi.readBrowserAnalyticsContext({ ...sdk, get_distinct_id: () => { throw Error('unavailable'); } }), null);
  for (const value of [null, '', [], {}, { distinct_id: 'email@test.test' }, { distinct_id, session_id: null }, ...['name','customer_name','phone','email','document','address','message','payment_details'].map(k => ({ distinct_id, [k]: 'private' }))]) assert.equal(contextApi.sanitizeAnalyticsContext(value), null);
});

test('server environment never uses request input; optional activation date is strict and unset by default', () => {
  for (const [env, expected] of [[{},'development'],[{ NODE_ENV:'production',VERCEL_ENV:'preview',NEXT_PUBLIC_ANALYTICS_ENVIRONMENT:'production' },'preview'],[{ NODE_ENV:'production',VERCEL_ENV:'production' },'production'],[{ NODE_ENV:'production' },'preview']]) {
    const api = load('lib/commercial-analytics-config.ts', {}, { process: { env } });
    assert.equal(api.commercialAnalyticsEnvironment(), expected); assert.equal(api.commercialAnalyticsStartAt(), null);
  }
  for (const [date, expected] of [['2026-09-23T12:00:00Z','2026-09-23T12:00:00.000Z'],['2026-02-30T00:00:00Z',null],['invalid',null],['2026-09-23',null]]) assert.equal(load('lib/commercial-analytics-config.ts', {}, { process:{env:{COMMERCIAL_ANALYTICS_START_AT:date}} }).commercialAnalyticsStartAt(), expected);
});

test('flush only runs after response; success acknowledges stable payload with privacy flags', async () => {
  const h = harness(); h.api.scheduleAnalyticsFlush();
  assert.equal(h.calls.length, 0); assert.equal(h.callbacks.length, 1);
  await h.callbacks[0]();
  assert.deepEqual(h.calls.map(c => c.name), ['claim_analytics_outbox','ack_analytics_outbox']);
  assert.deepEqual(h.calls[0].args, { p_environment:'production',p_limit:5 });
  const payload = JSON.parse(h.requests[0].options.body);
  assert.equal(payload.api_key,'public-token'); assert.equal(payload.event,'order_created');
  assert.equal(payload.properties.environment,'production');
  assert.equal(payload.uuid,h.event.id); assert.equal(payload.timestamp,h.event.occurred_at);
  assert.equal(payload.distinct_id,h.event.distinct_id); assert.equal(payload.properties.$session_id,h.event.session_id);
  assert.equal(payload.properties.$process_person_profile,false); assert.equal(payload.properties.$geoip_disable,true);
  assert.equal(payload.properties.$ip,undefined);
  assert.equal(h.requests[0].url,'https://example.invalid/i/v0/e/');
  assert.doesNotMatch(h.requests[0].options.body,/never-send-private/);
  assert.ok(h.requests[0].options.signal); assert.equal(h.requests[0].options.redirect,'error');
});

test('later events never carry an active browser session; origin retained in snapshot', () => {
  const h = harness();
  for (const event_type of ['payment_approved','purchase_completed']) {
    const event = { ...h.event,event_type,properties:{...h.event.properties,checkout_session_id:h.event.session_id} };
    const payload = h.api.outboxPayload(event,'token');
    assert.equal(payload.properties.$session_id,undefined);
    assert.equal(payload.properties.checkout_session_id,h.event.session_id);
  }
});

test('400/401/403, 429, 5xx, network failure and timeout remain pending and never acknowledge', async () => {
  for (const options of [...[400,401,403,429,503].map(status => ({response:{ok:false,status}})),{fetchError:new Error('network private details')},{fetchError:new DOMException('private details','TimeoutError')}]) {
    const h = harness(options); await h.api.flushAnalyticsOutbox();
    assert.deepEqual(h.calls.map(c=>c.name),['claim_analytics_outbox','fail_analytics_outbox']);
    assert.equal(h.calls[1].args.p_lease,h.event.lease_token);
    assert.match(h.calls[1].args.p_error,/^(http_400|http_401|http_403|http_429|http_503|transport_error)$/);
  }
});

test('failed acknowledgement and renewed lease resend the identical immutable event', async () => {
  const h = harness({ackError:true}); await h.api.flushAnalyticsOutbox();
  h.event.lease_token=randomUUID(); await h.api.flushAnalyticsOutbox();
  assert.equal(h.requests.length,2); assert.equal(h.requests[0].options.body,h.requests[1].options.body);
});

test('missing config and failed claim make no HTTP requests; scheduling errors cannot affect commerce', async () => {
  for (const options of [{configured:false},{claimError:true}]) { const h=harness(options); await h.api.flushAnalyticsOutbox(); assert.equal(h.requests.length,0); }
  const api=load('lib/store/analytics-outbox.ts',{'next/server':{after:()=>{throw Error('no lifecycle');}}});
  assert.doesNotThrow(()=>api.scheduleAnalyticsFlush());
});
