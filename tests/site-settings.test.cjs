/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const load = require('./load-ts.cjs');
const { buildSiteSettingsPatch, pickSiteSettings } = load('lib/site-settings-patch.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const request = body => new Request('https://test.invalid/api/admin/site-settings', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('Footer renders only configured HTTPS social links, with safe external navigation and no defaults', async () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  for (const settings of [null, {}, { facebook: '', instagram: ' ' }, { facebook: 'javascript:alert(1)', instagram: 'invalid' },
    { facebook: 'https://facebook.com/example' }, { instagram: 'https://instagram.com/example' },
    { facebook: 'https://facebook.com/example', instagram: ' https://instagram.com/example ' }]) {
    const { Footer } = load('components/layout/Footer.tsx', {
      'next/link': ({ children, ...props }) => React.createElement('a', props, children),
      '@/components/ui/WhatsAppButton': { WhatsAppButton: () => React.createElement('span', null, 'WhatsApp') },
      '@/lib/supabase/site-settings': { getSupabaseSiteSettings: async () => settings },
    });
    const html = renderToStaticMarkup(await Footer());
    for (const key of ['facebook', 'instagram']) {
      const expected = settings?.[key]?.trim().startsWith('https://') || false;
      assert.equal(html.includes(`>${key === 'facebook' ? 'Facebook' : 'Instagram'}</a>`), expected);
      if (expected) assert.ok(html.includes(`href="${settings[key].trim()}" target="_blank" rel="noopener noreferrer"`));
    }
    assert.ok(!html.includes('javascript:'));
  }
});

test('configuration sends only supplied fields; absent values never become defaults', () => {
  assert.deepEqual(plain(buildSiteSettingsPatch('configuration', { instagram: 'https://instagram.com/example', facebook: '' })), { instagram: 'https://instagram.com/example', facebook: '' });
  assert.deepEqual(plain(pickSiteSettings('configuration', { instagram: 'https://instagram.com/example', themePreset: 'legacy', transferAlias: 'old', radioEnabled: false })), { instagram: 'https://instagram.com/example' });
  for (const section of ['home', 'transfer']) assert.equal(Object.hasOwn(pickSiteSettings(section, { themePreset: 'graphite-pro' }), 'themePreset'), false);
});

test('API rejects legacy full snapshots, cross-section fields, malformed values and unknown themes', () => {
  for (const [section, settings] of [
    [undefined, { instagram: 'https://instagram.com/example' }], ['__proto__', {}], ['configuration', []],
    ['configuration', { themePreset: 'graphite-pro' }], ['configuration', { email: null }],
    ['configuration', { phone: 'x'.repeat(101) }], ['appearance', { themePreset: 'legacy' }],
    ['appearance', { themePreset: 'modern-bold' }],
    ['appearance', {}], ['transfer', { transferAlias: 'partial' }],
  ]) assert.throws(() => buildSiteSettingsPatch(section, settings));
});

test('social URLs preserve valid HTTPS links, trim outer spaces and reject unsafe or malformed inputs', async () => {
  for (const key of ['facebook', 'instagram']) {
    for (const value of [`https://${key}.com/DCL.CreeLed`, `https://www.${key}.com/profile.php?id=123&ref=share`, 'https://example.org/shared/link']) {
      assert.equal(buildSiteSettingsPatch('configuration', { [key]: `  ${value}  ` })[key], value);
    }
    assert.equal(buildSiteSettingsPatch('configuration', { [key]: '   ' })[key], '');
    for (const value of ['invalid', 'http://facebook.com/example', 'javascript:alert(1)', 'https://', 'https://user:password@facebook.com', 'https://facebook.com/a b']) {
      const { POST, calls } = route();
      const response = await POST(request({ section: 'configuration', siteSettings: { [key]: value } }));
      assert.equal(response.status, 400);
      assert.match((await response.json()).message, /HTTPS/);
      assert.equal(calls.length, 0);
    }
  }
});

test('each social patch preserves graphite, complete bank data, WhatsApp URL, radio and Home', async () => {
  const baseline = {
    id: 1, theme_preset: 'graphite-pro', instagram: 'https://instagram.com/old', facebook: 'https://facebook.com/old',
    logo_url: 'logo', whatsapp: 'https://wa.me/5491100000000?text=Hola%20DCL', email: 'stored@example.org', phone: 'stored-phone', address: 'stored-address',
    transfer_alias: 'bank.alias', transfer_cbu_cvu: '123456', transfer_holder: 'holder', transfer_institution: 'bank', transfer_instructions: 'instructions',
    radio_enabled: false, radio_show_player: false, radio_name: 'station', radio_stream_url: 'https://example.org/stream', radio_subtitle: 'subtitle',
    vehicle_section_title: 'vehicles', needs_section_title: 'needs', why_us_section_title: 'why', products_section_title: 'products', promotions_section_title: 'promotions',
  };
  for (const changes of [{ facebook: 'https://facebook.com/new' }, { instagram: 'https://instagram.com/new' }, { facebook: 'https://facebook.com/new', instagram: 'https://instagram.com/new' }]) {
    const { POST, calls } = route();
    assert.equal((await POST(request({ section: 'configuration', siteSettings: changes }))).status, 200);
    const sent = calls.find(call => call[0] === 'update')[1];
    assert.deepEqual(sent, changes);
    assert.deepEqual({ ...baseline, ...sent }, { ...baseline, ...changes });
  }
});

test('appearance and transfer send only their own columns', async () => {
  const appearance = route();
  assert.equal((await appearance.POST(request({ section: 'appearance', siteSettings: { themePreset: 'graphite-pro' } }))).status, 200);
  assert.deepEqual(appearance.calls[0], ['update', { theme_preset: 'graphite-pro' }]);
  const transfer = route();
  const settings = { transferAlias: 'alias', transferCbuCvu: '', transferHolder: 'holder', transferInstitution: 'bank', transferInstructions: 'instructions' };
  assert.equal((await transfer.POST(request({ section: 'transfer', siteSettings: settings }))).status, 200);
  assert.deepEqual(transfer.calls[0], ['update', { transfer_alias: 'alias', transfer_cbu_cvu: '', transfer_holder: 'holder', transfer_institution: 'bank', transfer_instructions: 'instructions' }]);
});

test('corrective migration is guarded, transactional and only replaces the named CHECK (static audit, no execution)', () => {
  const sql = fs.readFileSync('supabase/migrations/20260906010000_reconcile_site_settings_theme_preset.sql', 'utf8').replace(/--[^\n]*/g, '').trim();
  assert.ok(sql.startsWith('BEGIN;') && sql.endsWith('COMMIT;'));
  assert.ok(sql.indexOf('LOCK TABLE') < sql.indexOf('IF EXISTS'));
  assert.ok(sql.indexOf('RAISE EXCEPTION') < sql.indexOf('DROP CONSTRAINT'));
  assert.match(sql, /theme_preset IS NULL/);
  assert.match(sql, /LOCK TABLE public\.site_settings IN ACCESS EXCLUSIVE MODE/);
  const expected = ['dcl-dark', 'clean-light', 'graphite-pro', 'midnight-blue'];
  for (const match of sql.matchAll(/theme_preset (?:NOT )?IN \(([^)]+)\)/g)) assert.deepEqual([...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]), expected);
  assert.equal([...sql.matchAll(/theme_preset (?:NOT )?IN /g)].length, 2);
  assert.equal([...sql.matchAll(/ALTER TABLE public\.site_settings/g)].length, 2);
  assert.equal([...sql.matchAll(/DROP CONSTRAINT site_settings_theme_preset_check/g)].length, 1);
  assert.equal([...sql.matchAll(/ADD CONSTRAINT site_settings_theme_preset_check/g)].length, 1);
  assert.doesNotMatch(sql, /\b(?:UPDATE|INSERT|DELETE|TRUNCATE|CASCADE)\b|DROP\s+(?:TABLE|COLUMN)|SET\s+DEFAULT|modern-bold/i);
});

test('code, generated types, CSS and migration agree on the four supported presets', () => {
  const { themePresets } = load('lib/theme.ts');
  const sql = fs.readFileSync('supabase/migrations/20260901010000_site_settings_theme_preset.sql', 'utf8');
  const allowed = [...sql.match(/CHECK \(theme_preset IN \(([^)]+)\)/)[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(plain(themePresets.map(theme => theme.id)), allowed);
  const types = fs.readFileSync('lib/supabase/database.types.ts', 'utf8');
  const declared = [...types.match(/theme_preset: ([^;]+);/)[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(declared, allowed);
  const css = fs.readFileSync('app/globals.css', 'utf8');
  for (const preset of allowed) {
    assert.equal(buildSiteSettingsPatch('appearance', { themePreset: preset }).theme_preset, preset);
    if (preset !== 'dcl-dark') assert.ok(css.includes(`html[data-theme="${preset}"]`));
  }
});

function route(result = { data: { id: 1 }, error: null }, authenticated = true) {
  const calls = [];
  const query = {
    update(row) { calls.push(['update', plain(row)]); return this; },
    eq(...args) { calls.push(['eq', ...args]); return this; },
    select() { return this; }, maybeSingle: async () => result,
  };
  const { POST } = load('app/api/admin/site-settings/route.ts', {
    '@/lib/admin-auth': { isAdminAuthenticated: async () => authenticated },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => ({ from: () => query }) },
  }, { Error, console: { warn() {}, error() {} } });
  return { POST, calls };
}

test('route updates id=1 with the exact social patch and no theme, radio or bank data', async () => {
  const { POST, calls } = route();
  assert.equal((await POST(request({ section: 'configuration', siteSettings: { instagram: 'https://instagram.com/example', facebook: 'https://facebook.com/example' } }))).status, 200);
  assert.deepEqual(calls, [['update', { instagram: 'https://instagram.com/example', facebook: 'https://facebook.com/example' }], ['eq', 'id', 1]]);
});

test('route cannot insert/reset missing settings, bypass auth or silently repair constraint errors', async () => {
  for (const [result, auth, status] of [
    [{ data: null, error: null }, true, 409],
    [{ data: null, error: { message: 'site_settings_theme_preset_check' } }, true, 500],
    [{ data: { id: 1 }, error: null }, false, 401],
  ]) {
    const { POST, calls } = route(result, auth);
    assert.equal((await POST(request({ section: 'configuration', siteSettings: { instagram: 'https://instagram.com/example' } }))).status, status);
    assert.equal(calls.filter(call => call[0] === 'update').length, auth ? 1 : 0);
  }
  const { POST, calls } = route();
  assert.equal((await POST(request({ siteSettings: { instagram: 'https://instagram.com/example', themePreset: 'graphite-pro' } }))).status, 400);
  assert.equal(calls.length, 0);
});

test('Supabase reader preserves stored WhatsApp and explicitly empty contact fields', async () => {
  const row = { id: 1, whatsapp: 'stored-whatsapp', instagram: '', facebook: '', email: '', phone: '', address: '', theme_preset: 'graphite-pro' };
  const query = { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: row }) };
  const { getSupabaseSiteSettings } = load('lib/supabase/site-settings.ts', {
    './client': {}, './server': { createServerClient: () => ({ from: () => query }) },
    './test-connection': { isSupabaseConfigured: () => true }, './storage': { sanitizeStoredImageUrl: () => '' },
  });
  const settings = await getSupabaseSiteSettings();
  for (const key of ['whatsapp', 'instagram', 'facebook', 'email', 'phone', 'address']) assert.equal(settings[key], row[key]);
  assert.equal(settings.themePreset, 'graphite-pro');
});

test('browser helper scopes actual JSON payload before sending it', async () => {
  const calls = [];
  const { upsertSupabaseSiteSettings } = load('lib/supabase/site-settings.ts', {
    './client': {}, './server': {}, './test-connection': { isSupabaseConfigured: () => true }, './storage': {},
  }, { fetch: async (_url, init) => { calls.push(JSON.parse(init.body)); return Response.json({ ok: true }); } });
  await upsertSupabaseSiteSettings({ instagram: 'https://instagram.com/example', themePreset: 'graphite-pro', logo: 'logo', transferAlias: 'old' }, 'configuration');
  assert.deepEqual(calls, [{ section: 'configuration', siteSettings: { logo: 'logo', instagram: 'https://instagram.com/example' } }]);
});

test('isolated PostgreSQL reproduces unrelated theme rejection and verifies partial update preserves all other columns', async () => {
  // Synthetic drift fixture, not an assertion about production. No migrations or network.
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE site_settings(id int PRIMARY KEY, theme_preset text DEFAULT 'dcl-dark'
      CONSTRAINT site_settings_theme_preset_check CHECK(theme_preset IN ('graphite-pro')),
      instagram text, facebook text, logo_url text, whatsapp text, email text, phone text, address text,
      transfer_alias text, radio_enabled boolean);
      INSERT INTO site_settings VALUES(1,'graphite-pro','old-ig','old-fb','logo','wa','email','phone','address','bank',false);`);
    const before = (await db.query('SELECT * FROM site_settings')).rows[0];
    await assert.rejects(db.exec(`INSERT INTO site_settings(id,instagram,theme_preset) VALUES(1,'https://instagram.com/example','dcl-dark')
      ON CONFLICT(id) DO UPDATE SET instagram=EXCLUDED.instagram,theme_preset=EXCLUDED.theme_preset`), /site_settings_theme_preset_check/);
    const patch = buildSiteSettingsPatch('configuration', { instagram: 'https://instagram.com/updated', facebook: 'https://facebook.com/updated' });
    await db.query('UPDATE site_settings SET instagram=$1,facebook=$2 WHERE id=1', [patch.instagram, patch.facebook]);
    assert.deepEqual((await db.query('SELECT * FROM site_settings')).rows[0], { ...before, instagram: 'https://instagram.com/updated', facebook: 'https://facebook.com/updated' });
  } finally { await db.close(); }
});
