/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');

function loadKey(crypto) {
  return load('components/admin/FinancesManager.tsx', {
    react: { useCallback() {}, useEffect() {}, useState() {} },
  }, { crypto }).createFinanceIdempotencyKey;
}

test('finance idempotency keys fall back to cryptographic UUID v4 generation without randomUUID', () => {
  let seed = 0;
  const crypto = {
    getRandomValues(bytes) { bytes.fill(++seed); return bytes; },
  };
  const createKey = loadKey(crypto);
  const first = createKey();
  const second = createKey();
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(first, second);
});

test('finance idempotency keys keep using randomUUID when the secure-context API exists', () => {
  let fallbackCalled = false;
  const createKey = loadKey({
    randomUUID: () => '1e37942d-9e02-4b85-bc02-21d3a4d251f3',
    getRandomValues() { fallbackCalled = true; throw new Error('unexpected fallback'); },
  });
  assert.equal(createKey(), '1e37942d-9e02-4b85-bc02-21d3a4d251f3');
  assert.equal(fallbackCalled, false);
});
