/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');

const {
  parseWholesalePaymentTerms,
  getWholesaleAdvancePercent,
  getWholesaleAdvancePreview,
  serializeWholesalePaymentTerms,
} = load('lib/wholesale-commercial-conditions.ts');

test('serializes all payment modalities into the existing commercial conditions text contract', () => {
  assert.equal(serializeWholesalePaymentTerms({ method: 'full_before_delivery' }), 'Pago total antes de la entrega');
  assert.equal(serializeWholesalePaymentTerms({ method: 'pay_on_delivery' }), 'Pago al momento de la entrega');
  assert.equal(serializeWholesalePaymentTerms({ method: 'deposit_balance', advanceChoice: '30' }), 'Entrega a cuenta y saldo pendiente: anticipo del 30%');
  assert.equal(serializeWholesalePaymentTerms({ method: 'other', otherText: 'A convenir por transferencia' }), 'Otra condición acordada: A convenir por transferencia');
});

test('validates custom advance percentages and rejects empty or overlong custom conditions', () => {
  assert.equal(getWholesaleAdvancePercent({ advanceChoice: 'other', customAdvancePercent: '0' }), null);
  assert.equal(getWholesaleAdvancePercent({ advanceChoice: 'other', customAdvancePercent: '100' }), null);
  assert.equal(getWholesaleAdvancePercent({ advanceChoice: 'other', customAdvancePercent: '35.5' }), 35.5);
  assert.equal(serializeWholesalePaymentTerms({ method: 'deposit_balance', advanceChoice: 'other', customAdvancePercent: '100' }), null);
  assert.equal(serializeWholesalePaymentTerms({ method: 'other', otherText: '   ' }), null);
  assert.equal(serializeWholesalePaymentTerms({ method: 'other', otherText: 'a'.repeat(301) }), null);
});

test('rounds estimate previews to cents without treating an advance as a payment', () => {
  const first = getWholesaleAdvancePreview(29640, 30);
  assert.equal(first.advance, 8892);
  assert.equal(first.balance, 20748);
  const second = getWholesaleAdvancePreview(100.01, 20);
  assert.equal(second.advance, 20);
  assert.equal(second.balance, 80.01);
  assert.equal(getWholesaleAdvancePreview(100, 100), null);
});

test('loads saved terms back into the selector and preserves legacy free text', () => {
  assert.equal(parseWholesalePaymentTerms('Pago total antes de la entrega').method, 'full_before_delivery');
  assert.equal(parseWholesalePaymentTerms('Entrega a cuenta y saldo pendiente: anticipo del 35.5%').customAdvancePercent, '35.5');
  assert.equal(parseWholesalePaymentTerms('Otra condición acordada: Retiro coordinado').otherText, 'Retiro coordinado');
  const legacy = parseWholesalePaymentTerms('Entrega coordinada por el cliente');
  assert.equal(legacy.method, 'other');
  assert.equal(legacy.otherText, 'Entrega coordinada por el cliente');
});
