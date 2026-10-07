/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { renderToStaticMarkup } = require('react-dom/server');
const { PGlite } = require('@electric-sql/pglite');
const load = require('./load-ts.cjs');
const model = load('lib/why-us.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const defaults = () => plain(model.defaultWhyUsCards);
const icon = load('components/sections/WhyUsIcon.tsx');
const styles = Object.fromEntries(['section','inner','header','accent','title','grid','card','icon','rule'].map(key => [key, key]));
function render(settings = {}) {
  const { WhyUs } = load('components/sections/WhyUs.tsx', {
    '@/components/providers/SiteContentProvider': { useSiteContent: () => ({ content: { siteSettings: settings } }) },
    './WhyUsIcon': icon, './WhyUs.module.css': { __esModule: true, default: styles },
  });
  return renderToStaticMarkup(WhyUs());
}

test('three exact default cards render as real text and graphical SVGs, with DCL emphasis', () => {
  const html = render();
  assert.equal((html.match(/<article/g) || []).length, 3);
  assert.equal((html.match(/<svg/g) || []).length, 3);
  for (const card of defaults()) { assert.ok(html.includes(card.title)); assert.ok(html.includes(card.description)); }
  assert.match(html, /<span>DCL<\/span>/);
  assert.doesNotMatch(html, /<img|<image|<script|background-image/);
});

test('custom general title, edits, order, visibility and section switch are respected', () => {
  const cards = defaults();
  cards[0].enabled = false;
  cards[1] = { ...cards[1], title: 'Atención especial', description: 'Texto propio', icon: 'shield', order: 3 };
  cards[2].order = 2;
  const settings = { whyUsSectionTitle: 'Día del taxista', whyUsCards: cards };
  const html = render(settings);
  assert.match(html, /Día del taxista/); assert.doesNotMatch(html, /<span>DCL/);
  assert.equal((html.match(/<article/g) || []).length, 2);
  assert.ok(html.indexOf(cards[2].title) < html.indexOf(cards[1].title));
  assert.ok(html.includes('Texto propio'));
  assert.doesNotMatch(html, /Encontrá la luz/);
  assert.equal(render({ ...settings, whyUsEnabled: false }), '');
  assert.doesNotMatch(render({ whyUsCards: cards.map(card => ({ ...card, enabled: false })) }), /<article/);
});

test('optional/missing data does not crash and all seven closed icons render', () => {
  for (const whyUsCards of [undefined, null, [], {}, [{ icon: '<svg>' }]]) assert.equal((render({ whyUsCards }).match(/<article/g) || []).length, 3);
  const cards = defaults(); cards[0].description = '';
  assert.equal((render({ whyUsCards: cards }).match(/<p>/g) || []).length, 2);
  for (const name of Object.keys(model.whyUsIcons)) assert.match(renderToStaticMarkup(icon.WhyUsIcon({ icon: name })), /<svg/);
});

test('API validates exactly three cards, closed icons, stable IDs, limits and unique positions', () => {
  const { buildSiteSettingsPatch } = load('lib/site-settings-patch.ts');
  assert.deepEqual(plain(buildSiteSettingsPatch('home', { whyUsCards: defaults() })).why_us_cards, defaults());
  for (const cards of [[], defaults().slice(0, 2), [...defaults(), defaults()[0]]]) assert.throws(() => model.validateWhyUsCards(cards));
  for (const patch of [{ id: 'other' }, { icon: '<svg/>' }, { title: '' }, { title: 'x'.repeat(121) }, { description: 'x'.repeat(601) }, { order: 2 }, { enabled: 'false' }, { html: '<script/>' }]) {
    const cards = defaults(); cards[0] = { ...cards[0], ...patch }; assert.throws(() => model.validateWhyUsCards(cards));
  }
  assert.throws(() => buildSiteSettingsPatch('home', { whyUsDisplayMode: 'text' }));
});

test('existing site settings API persists ADMIN edits and denies VENDEDOR without writes', async () => {
  for (const role of ['ADMIN', 'VENDEDOR']) {
    const writes = [];
    const chain = { update: patch => { writes.push(plain(patch)); return chain; }, eq: () => chain, select: () => chain, maybeSingle: async () => ({ data: { id: 1 }, error: null }) };
    const api = load('app/api/admin/site-settings/route.ts', {
      '@/lib/admin-auth': { isAdminAuthenticated: async () => load('lib/admin-permissions.ts').hasAdminPermission(role) },
      '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => ({ from: () => chain }) },
    });
    const settings = { whyUsEnabled: false, whyUsSectionTitle: 'Beneficios', whyUsCards: defaults() };
    const response = await api.POST(new Request('https://test.invalid', { method: 'POST', body: JSON.stringify({ section: 'home', siteSettings: settings }) }));
    assert.equal(response.status, role === 'ADMIN' ? 200 : 401);
    assert.equal(writes.length, role === 'ADMIN' ? 1 : 0);
    if (writes.length) assert.deepEqual(writes[0], { why_us_enabled: false, why_us_section_title: 'Beneficios', why_us_cards: defaults() });
  }
});

const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
test('editor edits draft fields, hides a card and swaps order without adding cards', () => {
  const { WhyUsCardsEditor } = load('components/admin/WhyUsCardsEditor.tsx', { '@/components/sections/WhyUsIcon': icon });
  let value = defaults();
  const tree = () => nodes(WhyUsCardsEditor({ value, onChange: next => { value = plain(next); } }));
  tree().find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: false } });
  assert.equal(value[0].enabled, false);
  tree().find(node => node.type === 'input' && node.props.maxLength === 120).props.onChange({ target: { value: '' } });
  assert.equal(tree().find(node => node.type === 'input' && node.props.maxLength === 120).props.value, '', 'empty title draft must not reset all cards');
  tree().find(node => node.type === 'input' && node.props.maxLength === 120).props.onChange({ target: { value: 'Nuevo título' } });
  tree().find(node => node.type === 'textarea').props.onChange({ target: { value: 'Nueva descripción' } });
  tree().filter(node => node.type === 'select')[0].props.onChange({ target: { value: 'bulb' } });
  tree().filter(node => node.type === 'select')[1].props.onChange({ target: { value: '3' } });
  assert.equal(value.length, 3); assert.deepEqual(value.map(card => card.order).sort(), [1, 2, 3]);
  assert.deepEqual(value.find(card => card.id === 'vehicle'), { id: 'vehicle', enabled: false, icon: 'bulb', title: 'Nuevo título', description: 'Nueva descripción', order: 3 });
});

test('responsive rules stack mobile cards and bound long content; no reference image or remote asset', () => {
  const css = fs.readFileSync('components/sections/WhyUs.module.css','utf8');
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /@media \(min-width: 1024px\)/);
  assert.match(css, /repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /overflow-wrap: anywhere/); assert.match(css, /min-width: 0/);
  assert.doesNotMatch(css, /url\(|100vw/);
  assert.doesNotMatch(render(), /https?:|\.png|\.jpg|<img/);
});

test('incremental SQL loads defaults, validates cards and preserves existing settings', async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE public.site_settings(id integer primary key, why_us_enabled boolean, why_us_section_title text, why_us_display_mode text, why_us_text text); INSERT INTO site_settings VALUES(1,false,'Existing title','text','Previous text');");
    await db.exec(fs.readFileSync('supabase/migrations/20261001010000_why_us_editable_cards.sql', 'utf8'));
    const row = (await db.query('SELECT * FROM site_settings')).rows[0];
    assert.deepEqual(row.why_us_cards, defaults()); assert.equal(row.why_us_enabled, false); assert.equal(row.why_us_section_title, 'Existing title'); assert.equal(row.why_us_text, 'Previous text');
    await assert.rejects(db.query('UPDATE site_settings SET why_us_cards=$1', [JSON.stringify([])]), /check constraint/);
    const bad = defaults(); bad[0].icon = 'script';
    await assert.rejects(db.query('UPDATE site_settings SET why_us_cards=$1', [JSON.stringify(bad)]), /check constraint/);
  } finally { await db.close(); }
});
