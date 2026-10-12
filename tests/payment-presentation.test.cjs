/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./load-ts.cjs');
const { PaymentMethods } = load('components/sections/PaymentMethods.tsx', {}, { process: { env: { MERCADOPAGO_ACCESS_TOKEN: 'test-token', NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY: 'test-public-key' } } });
const base = {
  paymentPresentationEnabled: true,
  paymentPresentationTitle: 'Pagá como más te convenga',
  paymentPresentationDescription: 'Aceptamos tarjetas, transferencias bancarias y medios de pago digitales.',
  paymentPresentationMethods: [
    { id: 'mercadopago', name: 'Mercado Pago', logoUrl: '', enabled: true, showHome: true, showWholesale: true, showCheckout: true, sortOrder: 1 },
    { id: 'card', name: 'Tarjetas', logoUrl: '', enabled: true, showHome: true, showWholesale: true, showCheckout: true, sortOrder: 2, cardBrands: [
      { id: 'visa', name: 'Visa', logoUrl: '', enabled: true, sortOrder: 10 },
      { id: 'mastercard', name: 'Mastercard', logoUrl: '', enabled: false, sortOrder: 20 },
      { id: 'american_express', name: 'American Express', logoUrl: '', enabled: false, sortOrder: 30 },
      { id: 'naranja_x', name: 'Naranja X', logoUrl: '', enabled: false, sortOrder: 40 },
      { id: 'cabal', name: 'Cabal', logoUrl: '', enabled: false, sortOrder: 50 },
    ] },
    { id: 'transfer', name: 'Transferencia bancaria', logoUrl: '', enabled: true, showHome: false, showWholesale: true, showCheckout: true, sortOrder: 2 },
  ],
  paymentPresentationHome: true, paymentPresentationWholesale: true, paymentPresentationCheckout: true,
};

test('payment section advertises only enabled methods configured for that surface and ready transfer', () => {
  const html = renderToStaticMarkup(React.createElement(PaymentMethods, { settings: base, surface: 'home' }));
  assert.match(html, /Mercado Pago/);
  assert.match(html, /Visa/);
  assert.doesNotMatch(html, /Mastercard/);
  assert.doesNotMatch(html, /Transferencia bancaria/);
  assert.doesNotMatch(html, /transferencias bancarias/i);
  const configured = renderToStaticMarkup(React.createElement(PaymentMethods, { settings: { ...base, transferAlias: 'dcl.alias', transferHolder: 'DCL', transferInstitution: 'Banco' }, surface: 'wholesale' }));
  assert.match(configured, /Transferencia bancaria/);
  assert.match(configured, /Mercado Pago/);
  assert.match(configured, /Visa/);
  assert.equal(PaymentMethods({ settings: { ...base, paymentPresentationCheckout: false }, surface: 'checkout' }), null);
});

test('card brands remain hidden when cards are disabled or provider credentials are missing', () => {
  const disabled = renderToStaticMarkup(React.createElement(PaymentMethods, { settings: { ...base, paymentPresentationMethods: base.paymentPresentationMethods.map(method => method.id === 'card' ? { ...method, enabled: false } : method) }, surface: 'home' }));
  assert.doesNotMatch(disabled, /Visa/);
  const { PaymentMethods: withoutCredentials } = load('components/sections/PaymentMethods.tsx', {}, { process: { env: {} } });
  assert.equal(withoutCredentials({ settings: base, surface: 'home' }), null);
});
