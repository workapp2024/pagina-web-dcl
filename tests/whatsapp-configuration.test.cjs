/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./load-ts.cjs');
const wa = load('lib/whatsapp.ts');
const { buildSiteSettingsPatch } = load('lib/site-settings-patch.ts');

test('official Mendoza number and editable destinations normalize without changing contextual messages', () => {
  for (const value of ['2617791393', '+54 261 779 1393', '+54 9 261 779-1393', 'https://wa.me/5492617791393', 'https://api.whatsapp.com/send?phone=5492617791393']) {
    assert.equal(wa.configuredWhatsAppNumber(value), '5492617791393');
  }
  const message = 'Hola, ¿tenés H7? Pedido y comprobante: texto contextual.';
  const href = wa.whatsappUrl(message, 'https://wa.me/5492615551234');
  assert.equal(new URL(href).pathname, '/5492615551234');
  assert.equal(new URL(href).searchParams.get('text'), message);
  assert.equal(new URL(wa.configuredWhatsAppHref(wa.whatsappUrl(message), '5492615551234')).searchParams.get('text'), message);
  for (const value of [undefined, '', 'invalid', 'https://evil.example/5492615551234', 'https://wa.me.evil.example/5492615551234', 'https://evil.example/?wa.me=5492615551234', 'javascript:alert(1)', 'https://user@wa.me/5492615551234', 'https://wa.me/5492615551234/extra', 'https://wa.me/01234567890']) {
    assert.equal(wa.configuredWhatsAppNumber(value), null);
    assert.equal(new URL(wa.whatsappUrl(message, value)).pathname, '/5492617791393');
  }
});

test('Admin accepts changed WhatsApp numbers, rejects arbitrary links, and patches only its existing field', () => {
  for (const value of ['', '2615551234', 'https://wa.me/5492615551234']) {
    const patch = buildSiteSettingsPatch('configuration', { whatsapp: value });
    assert.deepEqual(Object.keys(patch), ['whatsapp']); assert.equal(patch.whatsapp, value);
  }
  for (const value of ['https://example.org', 'invalid', 'https://wa.me/not-a-phone']) {
    assert.throws(() => buildSiteSettingsPatch('configuration', { whatsapp: value }), /WhatsApp/);
  }
});

test('public adapter changes only the number and preserves existing commercial tracking props', () => {
  const seen = [];
  const { ConfiguredWhatsAppLink } = load('components/ui/ConfiguredWhatsAppLink.tsx', {
    '@/components/providers/WhatsAppProvider': { useWhatsAppConfiguration: () => ({ number: '5492615551234' }) },
    '@/components/analytics/CommercialWhatsAppLink': { CommercialWhatsAppLink: props => { seen.push(props); return React.createElement('a', { href: props.href }, props.children); } },
  });
  const html = renderToStaticMarkup(React.createElement(ConfiguredWhatsAppLink, { href: wa.whatsappUrl('Consulta H7'), source: 'product', analyticsContext: { product_id: 'h7' }, children: 'Consultar' }));
  assert.ok(html.includes('wa.me/5492615551234'));
  assert.equal(new URL(seen[0].href).searchParams.get('text'), 'Consulta H7');
  assert.equal(seen[0].source, 'product'); assert.equal(seen[0].analyticsContext.product_id, 'h7');
});

test('checkout contact uses centralized destination and exact messages, with no personal data in tracking', async () => {
  for (const configured of ['5492615551234', '', 'invalid']) {
    for (const initialOrder of [null, { orderNumber: 'DCL-900001', result: 'pending', paymentMethod: 'transfer', paymentStatus: 'pending', total: 100, currency: 'ARS', items: [], transfer: { alias: 'test', instructions: '' } }]) {
      const states = [], events = [], assigned = []; let cursor = 0;
      const { CheckoutResult } = load('components/store/CheckoutResult.tsx', {
        react: { ...React, useState: value => { const index = cursor++; states[index] = index === 0 ? initialOrder : value; return [states[index], updater => { states[index] = typeof updater === 'function' ? updater(states[index]) : updater; }]; }, useRef: value => ({ current: value }), useEffect: () => {} },
        '@/components/providers/WhatsAppProvider': { useWhatsAppConfiguration: () => ({ number: configured }) },
        '@/components/store/MercadoPagoBrick': { MercadoPagoBrick: () => null },
        '@/lib/analytics': { analyticsEvents: { whatsappClick: 'whatsapp_click' }, capture: (event, properties) => events.push([event, JSON.parse(JSON.stringify(properties))]), captureOnce: () => {} },
      }, { fetch: async () => Response.json({ ok: true }), window: { location: { assign: href => assigned.push(href) } } });
      const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
      const tree = CheckoutResult({ orderNumber: 'DCL-900001', publicKey: '' });
      const help = nodes(tree).find(node => node.type === 'a' && node.props.children === 'Necesito ayuda con mi pedido');
      const expectedNumber = configured === '5492615551234' ? configured : '5492617791393';
      assert.equal(new URL(help.props.href).pathname, `/${expectedNumber}`);
      assert.equal(new URL(help.props.href).searchParams.get('text'), initialOrder ? 'Hola, necesito ayuda con mi pedido DCL-900001.' : 'Hola, necesito ayuda para recuperar mi pedido.');
      help.props.onClick();
      assert.deepEqual(events, [['whatsapp_click', { source: 'other' }]]);
      if (initialOrder) {
        const transferButton = nodes(tree).find(node => node.type === 'button' && String(node.props.children).startsWith('Ya transferí'));
        transferButton.props.onClick(); await new Promise(resolve => setImmediate(resolve));
        assert.equal(new URL(assigned[0]).pathname, `/${expectedNumber}`);
        assert.equal(new URL(assigned[0]).searchParams.get('text'), 'Hola, realicé la transferencia correspondiente al pedido DCL-900001. Quiero enviar el comprobante.');
        assert.deepEqual(events[1], ['whatsapp_click', { source: 'other' }]);
      }
    }
  }
});
