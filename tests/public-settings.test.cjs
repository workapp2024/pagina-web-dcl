/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./load-ts.cjs');
const { defaultSiteContent } = load('lib/site-data.ts');
const { publicPresentation, publicContact } = load('lib/public-site-content.ts');
const plain = value => JSON.parse(JSON.stringify(value));
function mocks(settings = {}, vehicleCategories = []) {
  return {
    'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    '@/components/providers/SiteContentProvider': { useSiteContent: () => ({ content: { ...defaultSiteContent, siteSettings: { ...defaultSiteContent.siteSettings, ...settings }, vehicleCategories } }) },
    '@/components/providers/WhatsAppProvider': { useWhatsAppConfiguration: () => ({ number: '5492617791393', refresh: () => {} }) },
    '@/components/ui/ManagedImage': { ManagedImage: ({ source }) => React.createElement('img', { src: source, alt: '' }) },
    '@/components/sections/VehicleCategories': { VehicleCategories: () => null },
    '@/components/public/VehicleFinder': { VehicleFinder: () => null },
    '@/components/public/ConnectorField': { ConnectorField: () => null },
    '@/lib/analytics': { analyticsEvents: {}, capture: () => {} },
    './WhyUsIcon': { WhyUsIcon: () => null }, './WhyUs.module.css': {},
  };
}
const render = (file, name, settings, props = {}) => renderToStaticMarkup(React.createElement(load(file, mocks(settings), { URLSearchParams })[name], props));
test('all five existing Home title fields are consumed, with blank/unavailable fallbacks and wrapping', () => {
  for (const [file, name, field] of [
    ['VehicleSelector', 'VehicleSelector', 'vehicleSectionTitle'], ['NeedCategories','NeedCategories','needsSectionTitle'],
    ['PremiumSectionTitle','PremiumSectionTitle','productsSectionTitle'], ['Promotions','Promotions','promotionsSectionTitle'], ['WhyUs','WhyUs','whyUsSectionTitle'],
  ]) {
    const path = `components/sections/${file}.tsx`;
    const title = 'Título configurado '.repeat(10).trim();
    assert.ok(render(path, name, { [field]: title }).includes(title));
    const text = html => html.replace(/<[^>]*>/g, '');
    assert.ok(text(render(path, name, { [field]: '  ' })).includes(defaultSiteContent.siteSettings[field]), field);
    assert.ok(text(render(path, name, { [field]: undefined })).includes(defaultSiteContent.siteSettings[field]), field);
  }
  for (const settings of [null, {}, { logo: '', productsSectionTitle: ' ' }]) assert.equal(publicPresentation(settings).productsSectionTitle, 'Premium');
});
test('vehicle edits are cosmetic, keep canonical IDs and hide only Home entries', () => {
  const categories = [{ id: 'auto', title: 'Título cambiado', description: 'Descripción cambiada', image: '/custom.webp', active: false }, { id: 'moto', title: 'X'.repeat(255), description: 'Y'.repeat(255), image: '/moto.webp', active: true }, { id: 'inventado', title: 'Unknown', active: true }];
  const { VehicleCategories } = load('components/sections/VehicleCategories.tsx', { ...mocks({}, categories), '@/components/sections/VehicleCategories': undefined });
  const home = renderToStaticMarkup(React.createElement(VehicleCategories, { homeVisibility: true }));
  assert.ok(!home.includes('Título cambiado')); assert.ok(home.includes('X'.repeat(255))); assert.ok(!home.includes('inventado'));
  const finder = renderToStaticMarkup(React.createElement(VehicleCategories));
  assert.ok(finder.includes('Título cambiado')); assert.ok(finder.includes('Descripción cambiada')); assert.ok(finder.includes('/custom.webp'));
  assert.ok(finder.includes('href="/vehiculos?vehiculo=auto"')); assert.ok(finder.includes('[overflow-wrap:anywhere]'));
  assert.equal((finder.match(/href="\/vehiculos\?vehiculo=/g) || []).length, 4);
});
test('Footer uses configured logo and contact; blank/unavailable configuration never exposes demo contacts', async () => {
  for (const settings of [null, {}, { logo: '/logo.webp', email: 'ventas@example.org', phone: '+54 9 261 779-1393', address: 'Dirección configurada' }]) {
    const { Footer } = load('components/layout/Footer.tsx', { ...mocks(), '@/lib/supabase/site-settings': { getSupabaseSiteSettings: async () => settings }, '@/components/ui/WhatsAppButton': { WhatsAppButton: () => null } });
    const html = renderToStaticMarkup(await Footer());
    assert.ok(html.includes(`src="${settings?.logo || defaultSiteContent.siteSettings.logo}"`));
    if (settings?.email) { assert.ok(html.includes('mailto:ventas@example.org')); assert.ok(html.includes('tel:+5492617791393')); assert.ok(html.includes('Dirección configurada')); }
    else assert.ok(!/mailto:|tel:|ventas@dclcreeled|0000-0000/.test(html));
  }
  assert.deepEqual(plain(publicContact({ email: 'x@y.org?subject=bad', phone: 'javascript:bad', address: '' })), { email: '', phone: '', address: '' });
});

test('saved settings replace stale presentation cache without resetting unrelated configuration or using WhatsApp drafts', async () => {
  for (const remote of [null, {}, { vehicleSectionTitle: 'Guardado', whatsapp: 'https://wa.me/5492615551234' }]) {
    const states = [], refreshed = []; let cursor = 0;
    const cache = { ...defaultSiteContent, siteSettings: { ...defaultSiteContent.siteSettings, logo: '/stale.webp', vehicleSectionTitle: 'Borrador local', productsSectionTitle: 'Borrador Premium', whatsapp: 'https://wa.me/5492614441234', transferAlias: 'NO-RESET' } };
    const { SiteContentProvider } = load('components/providers/SiteContentProvider.tsx', {
      react: { ...React, useState: initial => { const index = cursor++; states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], updater => { states[index] = typeof updater === 'function' ? updater(states[index]) : updater; }]; }, useEffect: effect => effect(), useMemo: fn => fn() },
      '@/components/providers/WhatsAppProvider': { useWhatsAppConfiguration: () => ({ refresh: value => refreshed.push(value) }) },
      '@/lib/content-store': { getStoredSiteContent: () => cache, saveSiteContent: () => {} },
      '@/lib/supabase/products': { getSupabaseProducts: async () => null },
      '@/lib/supabase/promotions': { getSupabasePromotions: async () => null },
      '@/lib/supabase/vehicle-categories': { getSupabaseVehicleCategories: async () => null },
      '@/lib/supabase/site-settings': { getSupabaseSiteSettings: async () => remote },
      '@/lib/supabase/home-settings': { getSupabaseHomeSettings: async () => null },
    }, { document: { documentElement: { dataset: {} } } });
    SiteContentProvider({ children: null }); await Promise.resolve();
    assert.equal(states[0].siteSettings.vehicleSectionTitle, remote?.vehicleSectionTitle || defaultSiteContent.siteSettings.vehicleSectionTitle);
    assert.equal(states[0].siteSettings.logo, defaultSiteContent.siteSettings.logo);
    assert.equal(states[0].siteSettings.productsSectionTitle, 'Premium');
    assert.equal(states[0].siteSettings.transferAlias, 'NO-RESET');
    assert.deepEqual(refreshed, [remote?.whatsapp]);
  }
});
