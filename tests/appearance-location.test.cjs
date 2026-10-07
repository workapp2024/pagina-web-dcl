/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./load-ts.cjs');
const { pickSiteSettings, buildSiteSettingsPatch } = load('lib/site-settings-patch.ts');

test('Home contains the existing appearance editor closed by default; Configuration keeps its other editors', async () => {
  const mocks = {
    '@/lib/admin-auth': { isAdminAuthenticated: async () => true },
    'next/navigation': { redirect: () => { throw new Error('redirect'); } },
    '@/components/admin/EditorForms': { AdminHomeEditor: () => React.createElement('div', null, 'Home editor'), AdminSiteSettingsForm: () => React.createElement('div', null, 'Contact editor') },
    '@/components/admin/PremiumManager': { PremiumManager: () => React.createElement('div', null, 'Premium editor') },
    '@/components/admin/AppearanceSettings': { AppearanceSettings: () => React.createElement('div', null, 'Appearance editor'), TransferSettings: () => React.createElement('div', null, 'Transfer editor') },
  };
  const home = renderToStaticMarkup(await load('app/admin/home/page.tsx', mocks).default());
  assert.match(home, /<details[^>]*><summary[^>]*>Apariencia de la tienda<\/summary><div>Appearance editor<\/div><\/details>/);
  assert.doesNotMatch(home, /<details[^>]*\bopen\b/);
  assert.match(home, /Home editor/); assert.match(home, /Premium editor/);
  const config = renderToStaticMarkup(await load('app/admin/configuracion/page.tsx', mocks).default());
  assert.doesNotMatch(config, /Appearance editor/);
  assert.match(config, /Contact editor/); assert.match(config, /Transfer editor/);
});

test('existing appearance editor previews locally and saves only theme_preset, preserving unrelated settings', async () => {
  let content = { siteSettings: { themePreset: 'graphite-pro', logo: '/saved.webp', whatsapp: 'saved' } };
  const saved = [], states = []; let cursor = 0;
  const { AppearanceSettings } = load('components/admin/AppearanceSettings.tsx', {
    react: { ...React, useState: initial => { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = value; }]; } },
    '@/components/providers/SiteContentProvider': { useSiteContent: () => ({ content, setContent: update => { content = update(content); } }) },
    '@/lib/supabase/site-settings': { upsertSupabaseSiteSettings: async (settings, section) => { saved.push(buildSiteSettingsPatch(section, settings)); return { success: true }; } },
  });
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  const render = () => { cursor = 0; return nodes(AppearanceSettings()); };
  const initial = render(); assert.equal(saved.length, 0);
  const themeButtons = initial.filter(node => node.type === 'button' && node.key);
  assert.equal(themeButtons.length, 4);
  themeButtons.find(node => node.key === 'midnight-blue').props.onClick();
  assert.equal(content.siteSettings.themePreset, 'midnight-blue'); assert.equal(saved.length, 0);
  render().find(node => node.type === 'button' && node.props.children === 'Aplicar paleta').props.onClick();
  await Promise.resolve();
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), [{ theme_preset: 'midnight-blue' }]);
  assert.equal(content.siteSettings.logo, '/saved.webp');
  for (const section of ['home', 'configuration', 'transfer']) assert.equal(Object.hasOwn(pickSiteSettings(section, content.siteSettings), 'themePreset'), false);
});
