const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./load-ts.cjs');
function render(transferReady = true) {
  let state = 0;
  const { CheckoutForm } = load('components/store/CheckoutForm.tsx', {
    react: { ...React, useEffect() {}, useRef: value => ({ current: value }), useState: value => [state++ === 0 ? false : value, () => {}] },
    'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    'posthog-js': {}, '@/lib/analytics': { analyticsEvents: {}, capture() {} },
    '@/components/store/CartProvider': { useCart: () => ({ ready: true, total: 2400, consumePurchasedItems() {}, lines: [{ id: 'fixture', name: 'Producto de muestra', quantity: 2, price: 1200 }] }) },
  });
  return renderToStaticMarkup(React.createElement(CheckoutForm, { transfer: { alias: transferReady ? 'fixture' : '', holder: 'Fixture', institution: 'Fixture', cbuCvu: '', instructions: '' } }));
}
test('checkout highlights item quantities and total without legacy card badges', () => {
  const html = render();
  assert.match(html, /Finalizar compra/); assert.match(html, /Resumen de compra/); assert.match(html, /Producto de muestra/); assert.match(html, /2 \u00d7/); assert.match(html, /Total.*ARS/);
  assert.match(html, /Continu\u00e1 en el sitio de Mercado Pago/);
  assert.match(html, /Tarjeta en la tienda/); assert.match(html, /Transferencia bancaria directa/);
  assert.doesNotMatch(html, /Visa|Mastercard/);
  assert.match(html, /aria-pressed="false"/);
});
test('direct card flow remains distinct; incomplete transfer configuration is never advertised', () => {
  const html = render(false);
  assert.match(html, /Tarjeta en la tienda/); assert.match(html, /Formulario integrado/);
  assert.doesNotMatch(html, /Transferencia bancaria directa/);
  assert.match(html, /Continu\u00e1 en el sitio de Mercado Pago/);
});
