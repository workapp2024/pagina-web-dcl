const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

for (const env of [{ VERCEL: '1' }, { CI: 'true' }]) {
  test(`manual diagnostic refuses automation before network access: ${Object.keys(env)[0]}`, async () => {
    const process = { env, argv: ['node', 'probe', 'https://pagina-web-dcl.vercel.app/api/payments/mercadopago/checkout-pro-webhook'] };
    let requests = 0;
    const logs = [];
    vm.runInNewContext(fs.readFileSync('scripts/maintenance/probe-checkout-pro-webhook.cjs', 'utf8'), {
      require, process, URL, console: { error: message => logs.push(message), log: message => logs.push(message) },
      fetch: () => { requests++; throw Error('Network forbidden'); },
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(process.exitCode, 1);
    assert.equal(requests, 0);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /Probe failed/);
  });
}
