// Explicit execution only. Does not load .env files, accept payment IDs or call MP.
const { createHmac, randomUUID } = require('node:crypto');

async function main() {
  if (process.env.VERCEL === '1' || process.env.CI) {
    throw new Error('Manual diagnostic only: never run this probe in a build or deployment.');
  }
  const [target, ...extra] = process.argv.slice(2);
  const url = new URL(target);
  if (extra.length || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/api/payments/mercadopago/checkout-pro-webhook' ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Use the exact HTTPS Checkout Pro endpoint (HTTP allowed only on loopback).');
  }
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) throw new Error('MERCADOPAGO_WEBHOOK_SECRET is required in the process environment.');
  const id = 'dcl-wholesale-webhook-probe';
  url.searchParams.set('type', 'payment');
  url.searchParams.set('data.id', id);
  for (const valid of [false, true]) {
    const ts = String(Date.now()), requestId = randomUUID();
    const signature = createHmac('sha256', secret).update(`id:${id};request-id:${requestId};ts:${ts};`).digest('hex');
    const response = await fetch(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'content-type': 'application/json', 'x-request-id': requestId,
        'x-signature': `ts=${ts},v1=${valid ? signature : (signature[0] === '0' ? '1' : '0') + signature.slice(1)}` },
      body: JSON.stringify({ type: 'payment', data: { id } }),
    });
    const body = await response.json();
    if (response.status !== (valid ? 200 : 401) || (valid &&
        (body.ok !== true || body.diagnostic !== 'signature_verified' || body.paymentProcessed !== false))) {
      throw new Error(`Unexpected ${valid ? 'valid' : 'invalid'} signature result: HTTP ${response.status}. Stop; do not enable payments.`);
    }
    console.log(JSON.stringify({ check: valid ? 'valid_signature' : 'invalid_signature', status: response.status, requestId }));
  }
  console.log('Transport and signature probe passed. No payment processed. Sender was this script, not Mercado Pago.');
}

main().catch(() => {
  console.error('Probe failed. Verify endpoint, deployment and secret privately; keep wholesale payments disabled.');
  process.exitCode = 1;
});
