/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./load-ts.cjs');
const taxonomy = load('lib/product-taxonomy.ts');
const filters = load('lib/product-filters.ts', { '@/lib/product-taxonomy': taxonomy }, { URLSearchParams });
const plain = value => JSON.parse(JSON.stringify(value));
const product = (id, vehicleTypes = [], category = 'Accesorios') => ({ id, name: id, category, vehicleTypes, functions: [], active: true, showInCatalog: true, price: 100, image: '/original.webp', href: `/productos/${id}`, ctaText: 'Ver producto', description: '' });

test('three commercial categories retain fog but reject general high/low classification', () => {
  assert.deepEqual(plain(taxonomy.commercialCategories.map(x => x.label)), ['Iluminación frontal', 'Iluminación auxiliar', 'Accesorios']);
  assert.deepEqual(plain(taxonomy.productFunctions.map(x => x.id)), ['fog']);
  for (const functions of [['high'], ['low'], ['high', 'low']]) assert.throws(() => taxonomy.buildProductClassificationPatch({ functions }));
  assert.deepEqual(plain(taxonomy.normalizeCommercialClassification('Antiniebla', ['high'])), { category: 'Auxiliar', functions: ['fog'] });
  assert.deepEqual(plain(filters.parseProductFilters({ categoria: 'antiniebla' }).classification), { function: 'fog' });
  for (const funcion of ['high', 'low']) assert.equal(filters.parseProductFilters({ funcion }).invalid, true);
});

test('accessories include universal and matching multi-vehicle products without treating lighting as universal', () => {
  const products = [product('universal'), product('road', ['auto', 'camioneta', 'camion']), product('bike', ['moto']), product('unclassified', [], 'General')];
  const ids = params => plain(filters.filterCatalogProducts(products, filters.parseProductFilters({ categoria: 'accesorios', ...params })).map(x => x.id));
  assert.deepEqual(ids({}), ['universal', 'road', 'bike']);
  for (const vehiculo of ['auto', 'camioneta', 'camion']) assert.deepEqual(ids({ vehiculo }), ['universal', 'road']);
  assert.deepEqual(ids({ vehiculo: 'moto' }), ['universal', 'bike']);
  assert.equal(taxonomy.matchesProductClassification(products[3], { vehicleType: 'auto' }), false);
  assert.equal(taxonomy.accessoryVehicleLabel(products[0]), 'Uso universal');
  assert.equal(taxonomy.accessoryVehicleLabel(products[1]), 'Para Auto · Camioneta · Camión');
  assert.equal(taxonomy.accessoryVehicleLabel(products[2]), 'Para Moto');
  assert.equal(taxonomy.accessoryVehicleLabel(product('all', taxonomy.productVehicleTypes.map(x => x.id))), 'Uso universal');
  assert.equal(taxonomy.accessoryVehicleLabel(products[3]), undefined);
});

test('accessory cards show their destination in catalog and Premium', () => {
  const mocks = {
    '@/lib/product-taxonomy': taxonomy,
    'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    '@/components/ui/ManagedImage': { ManagedImage: () => null },
    '@/components/store/AddToCartButton': { AddToCartButton: () => null },
    '@/lib/whatsapp': { whatsappUrl: () => '#' },
  };
  const { ProductCard } = load('components/ui/ProductCard.tsx', mocks);
  const { PremiumProducts } = load('components/sections/PremiumProducts.tsx', mocks);
  for (const [p, label] of [[product('all'), 'Uso universal'], [product('auto', ['auto']), 'Para Auto'], [product('multi', ['auto', 'camioneta', 'camion']), 'Para Auto · Camioneta · Camión']]) {
    assert.ok(renderToStaticMarkup(React.createElement(ProductCard, p)).includes(label));
    assert.ok(renderToStaticMarkup(React.createElement(PremiumProducts, { products: [p] })).includes(label));
  }
});

test('Admin saves and reloads optional accessory vehicle selections and independent multiple functions', async () => {
  const states = []; let cursor = 0; let savedProduct = product('accessory'); let sent;
  const { ProductClassificationEditor } = load('components/admin/ProductClassificationEditor.tsx', {
    '@/lib/product-taxonomy': taxonomy,
    react: { useState: initial => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], v => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; } },
  }, { fetch: async (_url, options) => {
    sent = JSON.parse(options.body);
    const patch = taxonomy.buildProductClassificationPatch(sent.classification, savedProduct.category);
    return Response.json({ ok: true, data: { category: savedProduct.category, vehicle_types: patch.vehicle_types ?? savedProduct.vehicleTypes, functions: patch.functions ?? savedProduct.functions, integrated_high_low: patch.integrated_high_low ?? savedProduct.integratedHighLow } });
  } });
  const render = () => { cursor = 0; return ProductClassificationEditor({ product: savedProduct, onSaved: value => { savedProduct = { ...savedProduct, ...value }; } }); };
  const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
  const check = (label, checked) => nodes(render()).find(n => n.type === 'label' && text(n) === label).props.children[0].props.onChange({ target: { checked } });
  assert.ok(text(render()).includes('Universal / Todos los vehículos'));
  assert.ok(!text(render()).includes('Sin clasificar o pendiente'));
  for (const label of ['Auto', 'Camioneta', 'Camión', 'Antiniebla', 'Alta y baja integradas']) check(label, true);
  nodes(render()).find(n => n.type === 'button').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent.classification, { vehicleTypes: ['auto', 'camioneta', 'camion'], functions: ['fog'], integratedHighLow: true });
  states.length = 0;
  assert.equal(nodes(render()).filter(n => n.type === 'input' && n.props.checked).length, 5);
  check('Universal / Todos los vehículos', true);
  nodes(render()).find(n => n.type === 'button').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent.classification, { vehicleTypes: [] });
  assert.deepEqual(savedProduct.functions, ['fog']);
});

test('H7 fitment uses the selected vehicle position, never a global function mapping', () => {
  const { assessFitment } = load('lib/store/fitment.ts');
  for (const [position, field] of [['low', 'connectorLow'], ['high', 'connectorHigh'], ['fog', 'connectorFog']]) {
    const vehicle = { yearFrom: 2020, yearTo: 2026, connectorLow: null, connectorHigh: null, connectorFog: null, connectorAux: null, combinedHighLow: false, [field]: 'H7' };
    assert.equal(assessFitment(vehicle, 'H7', position, '2024').state, 'confirmed');
    assert.equal(assessFitment(vehicle, 'H7', position === 'low' ? 'high' : 'low', '2024').state, 'invalid');
  }
});

test('Home retains Premium and both existing entries, removes featured configuration, and CTA opens all products', () => {
  const home = fs.readFileSync('app/page.tsx', 'utf8');
  for (const component of ['PremiumProducts', 'VehicleSelector', 'NeedCategories']) assert.ok(home.includes(`<${component}`));
  assert.ok(!home.includes('FeaturedProducts'));
  assert.ok(!fs.readFileSync('components/admin/EditorForms.tsx', 'utf8').includes('checked={product.featured}'));
  assert.ok(!fs.readFileSync('components/sections/Hero.tsx', 'utf8').includes('href="#productos"'));
  const { FinalCTA } = load('components/sections/FinalCTA.tsx', { 'next/link': ({ children, ...props }) => React.createElement('a', props, children), '@/components/ui/WhatsAppButton': { WhatsAppButton: () => null } });
  assert.ok(renderToStaticMarkup(React.createElement(FinalCTA)).includes('href="/productos"'));
});

test('pending data migration only normalizes the obsolete category and preserves functions (static, not executed)', () => {
  const sql = fs.readFileSync('supabase/migrations/20260908010000_normalize_fog_category.sql', 'utf8');
  assert.match(sql, /WHERE category = 'Antiniebla'/);
  assert.match(sql, /SET category = 'Auxiliar'/);
  assert.match(sql, /WHEN 'fog' = ANY/);
  assert.match(sql, /array_append\(COALESCE\(functions/);
  assert.doesNotMatch(sql, /\b(?:DROP|DELETE|TRUNCATE|ALTER|INSERT)\b/i);
});
