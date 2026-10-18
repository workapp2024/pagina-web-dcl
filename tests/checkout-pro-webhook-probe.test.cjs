const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const load = require('./load-ts.cjs');

for (const mode of ['disabled-checkout', 'enabled-checkout', 'retired']) test(`authenticated probe has no external effects (${mode})`, async () => {
  const enabled = mode === 'enabled-checkout';
  const secret = 'isolated-probe-secret';
  const forbidden = () => { throw Error('Probe must not access any integration'); };
  const route = load('app/api/payments/mercadopago/checkout-pro-webhook/route.ts', {
    '@/lib/supabase/server': { createAdminServerClient: forbidden },
    '@/lib/store/mercadopago-recovery': { reconcileCheckoutPro: forbidden },
    '@/lib/store/analytics-outbox': { scheduleAnalyticsFlush: forbidden },
    '@/lib/prepared-finance-features': { wholesaleCheckoutPreparedEnabled: () => enabled },
    '@/lib/wholesale-checkout': { reconcileWholesaleCheckoutPayment: forbidden },
  }, { process: { env: { NODE_ENV: 'production', MERCADOPAGO_WEBHOOK_SECRET: secret,
    DCL_WHOLESALE_CHECKOUT_ENABLED: enabled ? '1' : '0',
    DCL_WHOLESALE_WEBHOOK_DIAGNOSTIC_DISABLED: mode === 'retired' ? '1' : '0',
  } }, fetch: forbidden });
  for (const valid of [false, true]) {
    const ts = String(Date.now()), requestId = 'isolated-probe';
    const signature = createHmac('sha256', secret).update(`id:dcl-wholesale-webhook-probe;request-id:${requestId};ts:${ts};`).digest('hex');
    const request = new Request('https://dcl.test/api/payments/mercadopago/checkout-pro-webhook?type=payment&data.id=dcl-wholesale-webhook-probe', {
      method: 'POST', headers: { 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${valid ? signature : '0'.repeat(64)}` },
      body: JSON.stringify({ data: { id: '700001' }, external_reference: 'wholesale:ignored' }),
    });
    request.nextUrl = new URL(request.url);
    const response = await route.POST(request);
    const diagnosticAvailable = mode === 'disabled-checkout';
    assert.equal(response.status, valid ? (diagnosticAvailable ? 200 : 404) : 401);
    if (valid && diagnosticAvailable) {
      assert.deepEqual(await response.json(), { ok: true, diagnostic: 'signature_verified', paymentProcessed: false });
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  }
});

test('a real payment ID cannot select diagnosis through body or query flags', async () => {
  const secret = 'isolated-probe-secret';
  let reconciliations = 0;
  const route = load('app/api/payments/mercadopago/checkout-pro-webhook/route.ts', {
    '@/lib/supabase/server': { createAdminServerClient: () => ({}) },
    '@/lib/store/mercadopago-recovery': { reconcileCheckoutPro: async (_db, id) => {
      assert.equal(id, '700001'); reconciliations++; throw Error('Isolated payment rejected');
    } },
    '@/lib/store/analytics-outbox': { scheduleAnalyticsFlush: () => { throw Error('Unexpected analytics'); } },
  }, { process: { env: { NODE_ENV: 'production', MERCADOPAGO_WEBHOOK_SECRET: secret, MERCADOPAGO_ACCESS_TOKEN: 'fixture' } } });
  const ts = String(Date.now()), requestId = 'isolated-real-id';
  const signature = createHmac('sha256', secret).update(`id:700001;request-id:${requestId};ts:${ts};`).digest('hex');
  const request = new Request('https://dcl.test/api/payments/mercadopago/checkout-pro-webhook?type=payment&data.id=700001&diagnostic=1', {
    method: 'POST', headers: { 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${signature}` },
    body: JSON.stringify({ data: { id: 'dcl-wholesale-webhook-probe' }, diagnostic: true }),
  });
  request.nextUrl = new URL(request.url);
  const response = await route.POST(request);
  assert.equal(response.status, 503);
  assert.equal(reconciliations, 1);
  assert.equal((await response.json()).diagnostic, undefined);
});
