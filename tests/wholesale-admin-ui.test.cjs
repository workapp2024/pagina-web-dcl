/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('components/admin/WholesaleOrdersManager.tsx', 'utf8');

test('admin proposal failures preserve the draft and explain safe same-key recovery', () => {
  assert.match(source, /No pudimos confirmar si la propuesta se registr/);
  assert.match(source, /El borrador se conserva/);
  assert.match(source, /misma clave/);
  assert.match(source, /revision_rejected/);
});

test('admin wholesale UI separates current revision from the proposed draft and never accepts client prices', () => {
  assert.match(source, /Importe vigente/);
  assert.match(source, /Propuesta en edici/);
  assert.match(source, /Pedido original/);
  assert.match(source, /Subtotal estimado de propuesta/);
  assert.match(source, /Agregar a la propuesta/);
  assert.match(source, /Condiciones comerciales propuestas/);
  assert.match(source, /Buscar por nombre/);
  assert.match(source, /el servidor vuelve a validar productos y precios/);
  assert.doesNotMatch(source, /unit_cost_reference|cost_price|wholesale_code_hash|ID de art/);
});

test('product selector uses named catalog products and rejects anonymous or invalid quantities', () => {
  assert.match(source, /product\.name/);
  assert.match(source, /product\.id/);
  assert.match(source, /product\.connectorType/);
  assert.match(source, /Number\.isInteger\(quantity\)/);
  assert.match(source, /!selectedProductId \|\| !validAddQuantity/);
  assert.match(source, /if \(!product \|\| !Number\.isInteger\(quantity\)/);
  assert.match(source, /No disponible para una nueva propuesta/);
});

test('detail uses a single card with responsive navigation and preserved product wrapping', () => {
  assert.match(source, /grid min-w-0 items-start gap-5 min-\[1600px\]:grid-cols-2/);
  assert.match(source, /max-w-\[1680px\]/);
  assert.match(source, /aria-label="Secciones del pedido"/);
  assert.match(source, /grid-cols-2 gap-2 sm:grid-cols-4/);
  assert.match(source, /\[overflow-wrap:anywhere\]/);
  assert.match(source, /w-full border-amber-300\/40/);
});

test('payment terms use the existing text value and keep the advance preview explicitly non-financial', () => {
  assert.match(source, /serializeWholesalePaymentTerms\(paymentTermsDraft\)/);
  assert.match(source, /Pago total antes de la entrega/);
  assert.match(source, /Entrega a cuenta y saldo pendiente/);
  assert.match(source, /Pago al momento de la entrega/);
  assert.match(source, /Otra condición acordada/);
  assert.match(source, /mayor que 0 y menor que 100/);
  assert.match(source, /Vista previa estimada; no registra un pago/);
  assert.match(source, /commercialConditions, internalNote/);
  assert.doesNotMatch(source, /setCommercialConditions/);
});

test('admin actions are gated by order and revision states and share a pending-operation lock', () => {
  assert.match(source, /detail\.status === "received"/);
  assert.match(source, /detail\.status === "in_review"/);
  assert.match(source, /detail\.revision\.requires_customer_approval/);
  assert.match(source, /detail\.revision\.status === "approved"/);
  assert.match(source, /processing\)\}/);
  assert.match(source, /performAction\("start_review"\)/);
  assert.match(source, /performAction\("confirm"/);
  assert.match(source, /WholesaleOrderLedger/);
  assert.doesNotMatch(source, /los pagos no se gestionan en esta etapa/);
  assert.match(source, /performAction\("reject"/);
});

test('stale proposals reload the current revision and require explicit administrator review', () => {
  assert.match(source, /body\.error === "WHOLESALE_REVISION_STALE"/);
  assert.match(source, /await showDetail\(selectedId\)/);
  assert.match(source, /Ya revisé la versión vigente/);
  assert.match(source, /needsReview && !reviewedLatest/);
  assert.match(source, /body\.error === "WHOLESALE_IDEMPOTENCY_CONFLICT"/);
});

test('successful actions reload both order detail and timeline plus the paginated list', () => {
  assert.match(source, /await showDetail\(selectedId\);\s*await load\(\);/);
  assert.match(source, /aria-label="Antecedentes comerciales"/);
});
