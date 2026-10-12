/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./load-ts.cjs');

const {
  buildWholesaleCustomerOrderCards,
  getOpenWholesaleAttempts,
  wholesaleOrderStatusLabel,
  wholesaleOrderNextAction,
  isWholesaleOrderActive,
  wholesaleSelectionMatchesAttempt,
  independentOrderConfirmation,
  recoveredOrderMessage,
} = load('lib/wholesale-customer-orders.ts');

const order = {
  id: 'order-1', order_number: 'MW-000001', status: 'awaiting_customer', created_at: '2026-01-01T00:00:00Z',
  confirmed_at: null, total_amount: 29640, currency: 'ARS',
  items: [{ productId: 'lamp-1', name: 'Lámpara LED', quantity: 3, unitPrice: 9880, lineTotal: 29640, currency: 'ARS' }],
};

test('a created attempt linked to an order decorates its single real order card instead of creating a second card', () => {
  const attempt = { attemptId: 'attempt-1', status: 'created', createdAt: order.created_at, items: [{ productId: 'lamp-1', quantity: 3 }], order: { id: order.id, orderNumber: order.order_number } };
  const cards = buildWholesaleCustomerOrderCards([order], [attempt]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].order.id, order.id);
  assert.equal(cards[0].recoveryAttempt.attemptId, attempt.attemptId);
});

test('order cards deduplicate repeated real order IDs and do not create cards for unlinked created attempts', () => {
  const unlinked = { attemptId: 'attempt-2', status: 'created', createdAt: order.created_at, items: [], order: null };
  const cards = buildWholesaleCustomerOrderCards([order, { ...order }], [unlinked]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].recoveryAttempt, null);
});

test('only open attempts without an order appear as pending recovery', () => {
  const attempts = [
    { attemptId: 'open', status: 'open', order: null },
    { attemptId: 'created', status: 'created', order: { id: order.id, orderNumber: order.order_number } },
    { attemptId: 'invalid-open-link', status: 'open', order: { id: order.id, orderNumber: order.order_number } },
  ];
  assert.deepEqual(getOpenWholesaleAttempts(attempts).map(item => item.attemptId), ['open']);
});

test('order statuses and next actions distinguish proposal response from commercial confirmation', () => {
  assert.equal(wholesaleOrderStatusLabel('awaiting_customer'), 'Propuesta recibida: revisá y respondé');
  assert.match(wholesaleOrderNextAction('awaiting_customer'), /respondé a DCL desde este pedido/);
  assert.equal(wholesaleOrderStatusLabel('in_review', 'approved'), 'Propuesta aceptada · pendiente de confirmación DCL');
  assert.equal(wholesaleOrderStatusLabel('in_review', 'rejected'), 'Propuesta rechazada · revisión de DCL');
  assert.match(wholesaleOrderNextAction('in_review', 'approved'), /DCL debe confirmar/);
  assert.match(wholesaleOrderNextAction('in_review', 'rejected'), /puede preparar otra revisión/);
  assert.equal(wholesaleOrderStatusLabel('rejected'), 'Rechazada');
  assert.equal(wholesaleOrderStatusLabel('cancelled'), 'Cancelada');
  assert.equal(wholesaleOrderStatusLabel('unknown'), 'Estado actualizado');
  assert.equal(isWholesaleOrderActive('confirmed'), true);
  assert.equal(isWholesaleOrderActive('rejected'), false);
  assert.equal(isWholesaleOrderActive('cancelled'), false);
});

test('customer portal renders current proposal terms and sends only decision plus revision ID', () => {
  const source = fs.readFileSync('components/wholesale/WholesaleCatalog.tsx', 'utf8');
  assert.match(source, /Propuesta recibida/);
  assert.match(source, /revisá y respondé/);
  assert.match(source, /Aceptar propuesta/);
  assert.match(source, /Rechazar propuesta/);
  assert.match(source, /revisionId: order\.revision_id, decision/);
  assert.doesNotMatch(source, /customerId:\s*order\./);
  assert.match(source, /Esto no confirma el pedido ni registra pagos o entregas/);
});

test('current selections match a pending attempt by product IDs and quantities', () => {
  const selection = { 'lamp-1': { quantity: 3 }, 'lamp-2': { quantity: 1 } };
  assert.equal(wholesaleSelectionMatchesAttempt(selection, [
    { productId: 'lamp-2', quantity: 1 }, { productId: 'lamp-1', quantity: 3 },
  ]), true);
  assert.equal(wholesaleSelectionMatchesAttempt(selection, [{ productId: 'lamp-1', quantity: 3 }]), false);
});

test('independent request confirmation explains the outcome and leaves existing orders unchanged', () => {
  assert.equal(independentOrderConfirmation([]), null);
  assert.match(independentOrderConfirmation(['MW-000001']), /nueva e independiente/);
  assert.match(independentOrderConfirmation(['MW-000001']), /no cambiarán ni se cancelarán/);
});

test('recovered order message uses its customer order number and never exposes a server UUID', () => {
  assert.match(recoveredOrderMessage('MW-000001'), /MW-000001/);
  assert.doesNotMatch(recoveredOrderMessage('MW-000001'), /order-1/);
  assert.match(recoveredOrderMessage(), /consultá el historial/);
});
