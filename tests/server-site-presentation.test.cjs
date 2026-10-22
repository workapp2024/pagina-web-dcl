const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./load-ts.cjs');
const { defaultSiteContent } = load('lib/site-data.ts');

test('each request reads saved visual settings; empty/unavailable sections never restore demo images', async () => {
  let revision = 1;
  const { getServerSitePresentation } = load('lib/server-site-presentation.ts', {
    react: { cache: fn => fn }, 'next/server': { connection: async () => {} },
    '@/lib/supabase/site-settings': { getSupabaseSiteSettings: async () => revision ? { logo: `/logo-${revision}.png`, themePreset: 'midnight-blue' } : null },
    '@/lib/supabase/home-settings': { getSupabaseHomeSettings: async () => revision ? { heroImage: `/hero-${revision}.webp`, heroTitle: 'Guardado' } : null },
    '@/lib/supabase/promotions': { getSupabasePromotions: async () => [] },
    '@/lib/supabase/vehicle-categories': { getSupabaseVehicleCategories: async () => [] },
  });
  const first = await getServerSitePresentation();
  assert.equal(first.siteSettings.heroImage, '/hero-1.webp');
  assert.equal(first.siteSettings.themePreset, 'midnight-blue');
  assert.equal(first.promotions.length, 0);
  revision = 2;
  assert.equal((await getServerSitePresentation()).siteSettings.heroImage, '/hero-2.webp');
  revision = 0;
  const unavailable = await getServerSitePresentation();
  assert.equal(unavailable.siteSettings.heroImage, '');
  assert.equal(unavailable.siteSettings.logo, '');
  assert.equal(unavailable.vehicleCategories.length, 0);
});

test('server-seeded provider renders saved Hero before effects and never replays local drafts or client visual queries', async () => {
  const effects = [], states = [];
  let visualReads = 0;
  const forbidden = () => { visualReads++; throw Error('Unexpected client visual read'); };
  const presentation = { siteSettings: { ...defaultSiteContent.siteSettings, heroImage: '/saved.webp', heroTitle: 'Título guardado', themePreset: 'midnight-blue' }, promotions: [], vehicleCategories: [] };
  const { SiteContentProvider } = load('components/providers/SiteContentProvider.tsx', {
    react: { ...React, useState: initial => { const index = states.length; states.push(typeof initial === 'function' ? initial() : initial); return [states[index], update => { states[index] = typeof update === 'function' ? update(states[index]) : update; }]; }, useEffect: fn => effects.push(fn), useMemo: fn => fn() },
    '@/components/providers/WhatsAppProvider': { useWhatsAppConfiguration: () => ({ refresh: forbidden }) },
    '@/lib/content-store': { getStoredSiteContent: forbidden, saveSiteContent: forbidden },
    '@/lib/supabase/site-settings': { getSupabaseSiteSettings: forbidden },
    '@/lib/supabase/home-settings': { getSupabaseHomeSettings: forbidden },
    '@/lib/supabase/promotions': { getSupabasePromotions: forbidden },
    '@/lib/supabase/vehicle-categories': { getSupabaseVehicleCategories: forbidden },
  }, { document: { documentElement: { dataset: {} } } });
  SiteContentProvider({ children: null, initialPresentation: presentation, initialProducts: [{ id: 'existing' }] });
  const { Hero } = load('components/sections/Hero.tsx', {
    '@/components/providers/SiteContentProvider': { useSiteContent: () => ({ content: states[0] }) },
    '@/components/ui/ManagedImage': { ManagedImage: ({ source, ...props }) => React.createElement('img', { src: source, ...props }) },
    'next/link': props => React.createElement('a', props),
  });
  const before = renderToStaticMarkup(React.createElement(Hero));
  assert.match(before, /saved.webp/);
  assert.match(before, /Título guardado/);
  assert.ok(!before.includes(defaultSiteContent.siteSettings.heroImage));
  effects.forEach(effect => effect());
  await Promise.resolve();
  assert.equal(visualReads, 0);
  assert.equal(renderToStaticMarkup(React.createElement(Hero)), before);
});

test('all public content boundaries use server initialization and root HTML includes saved theme', () => {
  for (const file of ['app/page.tsx', 'app/productos/page.tsx', 'app/productos/[slug]/page.tsx', 'app/vehiculos/page.tsx', 'app/carrito/page.tsx', 'app/music/page.tsx', 'app/privacidad/page.tsx']) {
    assert.match(fs.readFileSync(file, 'utf8'), /providers\/ServerSiteContentProvider/);
  }
  assert.match(fs.readFileSync('app/layout.tsx', 'utf8'), /data-theme=\{isThemePreset\(settings.themePreset\)/);
});
