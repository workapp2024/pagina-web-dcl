/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./load-ts.cjs');
const taxonomy = load('lib/product-taxonomy.ts');
const filtersModule = load('lib/product-filters.ts', { '@/lib/product-taxonomy': taxonomy }, { URLSearchParams });
const { parseProductFilters: parse, filterCatalogProducts: filter, productCatalogHref: href } = filtersModule;
const plain = value => JSON.parse(JSON.stringify(value));
const product = (id, fields = {}) => ({ id, name: id, description: '', category: 'Iluminación frontal', active: true, showInCatalog: true, vehicleTypes: [], functions: [], ...fields });
const products = [
  product('dual', { vehicleTypes: ['auto', 'camioneta'], functions: ['fog'], integratedHighLow: true, connectorType: 'H4', featured: true, order: 7 }),
  product('moto', { vehicleTypes: ['moto'], functions: [], connectorType: 'H7' }),
  product('truck', { vehicleTypes: ['camion'], category: 'Auxiliar' }),
  product('legacy', { category: 'Ópticas', vehicleTypes: undefined, functions: undefined }),
  product('general', { category: 'General' }),
  product('hidden', { showInCatalog: false, vehicleTypes: ['auto'] }),
  product('inactive', { active: false, vehicleTypes: ['auto'] }),
];
const ids = params => plain(filter(products, parse(params)).map(p => p.id));

test('general catalog preserves all active/visible products and their ordering without classifying legacy records', () => {
  assert.deepEqual(ids({}), ['dual', 'moto', 'truck', 'legacy', 'general']);
  const before = JSON.stringify(products);
  filter(products, parse({ vehiculo: 'auto' }));
  assert.equal(JSON.stringify(products), before);
  assert.equal(products[0].featured, true);
});

test('vehicle filters match explicit types while high/low free filters fail closed', () => {
  for (const [vehiculo, expected] of [['auto', ['dual']], ['camioneta', ['dual']], ['moto', ['moto']], ['camion', ['truck']]]) assert.deepEqual(ids({ vehiculo }), expected);
  assert.deepEqual(ids({ funcion: 'high' }), []);
  assert.deepEqual(ids({ funcion: 'low' }), []);
  assert.deepEqual(ids({ funcion: 'fog' }), ['dual']);
});

test('category, connector, search and multiple filters intersect; no compatibility is inferred', () => {
  assert.deepEqual(ids({ categoria: 'iluminacion-frontal' }), ['dual', 'moto']);
  assert.deepEqual(ids({ categoria: 'Iluminación frontal' }), ['dual', 'moto']);
  assert.deepEqual(ids({ categoria: 'Ópticas' }), ['legacy']);
  assert.deepEqual(ids({ categoria: 'general' }), ['general']);
  assert.deepEqual(ids({ vehiculo: 'auto', categoria: 'iluminacion-frontal' }), ['dual']);
  assert.deepEqual(ids({ vehiculo: 'camioneta', funcion: 'fog' }), ['dual']);
  assert.deepEqual(ids({ vehiculo: 'auto', categoria: 'iluminacion-frontal', funcion: 'fog', conector: 'h4', q: 'DUAL' }), ['dual']);
  assert.deepEqual(ids({ vehiculo: 'moto', funcion: 'high' }), []);
  assert.deepEqual(ids({ conector: 'H4' }), ['dual']);
  assert.deepEqual(ids({ vehiculo: 'camion', funcion: 'low' }), []);
  assert.equal(Object.hasOwn(filter(products, parse({ vehiculo: 'auto' }))[0], 'compatible'), false);
});

test('invalid or duplicate recognized params fail closed, and unrelated params do not become filters', () => {
  for (const params of [{ vehiculo: 'avion' }, { vehiculo: ['auto', 'moto'] }, { funcion: 'alta' }, { categoria: 'unknown' }, { conector: '<script>' }, { q: ['a', 'b'] }, { q: 'x'.repeat(121) }]) {
    assert.equal(parse(params).invalid, true);
    assert.deepEqual(ids(params), []);
  }
  assert.deepEqual(ids({ fitment: 'fake', year: '2015', marca: 'Peugeot' }), ids({}));
});

test('canonical URLs round trip all filters, remain shareable and clear to the full catalog', () => {
  const classification = { vehicleType: 'auto', category: 'Iluminación frontal', function: 'fog', connectorType: 'H4' };
  const url = href(classification, 'LED blanco');
  assert.ok(url.startsWith('/productos?vehiculo=auto&categoria=iluminacion-frontal&funcion=fog'));
  const params = Object.fromEntries(new URL(url, 'https://test.invalid').searchParams);
  assert.deepEqual(plain(parse(params).classification), classification);
  assert.equal(parse(params).query, 'LED blanco');
  assert.equal(href(), '/productos');
  assert.deepEqual(ids(Object.fromEntries(new URL(href(), 'https://test.invalid').searchParams)), ids({}));
});

const mocks = {
  '@/components/public/ConnectorField': load('components/public/ConnectorField.tsx'),
  'next/link': ({ children, ...props }) => React.createElement('a', props, children),
  '@/lib/product-taxonomy': taxonomy, '@/lib/product-filters': filtersModule,
  '@/lib/analytics': { analyticsEvents: {}, capture: () => {} },
  '@/components/ui/ProductCard': { ProductCard: p => React.createElement('article', { 'data-product': p.id }, p.name) },
};
test('catalog renders URL-backed accessible controls, context, legacy options and a recoverable empty state', () => {
  const { ProductCatalog } = load('components/public/ProductCatalog.tsx', mocks);
  const render = params => renderToStaticMarkup(React.createElement(ProductCatalog, { products, filters: parse(params) }));
  const html = render({ vehiculo: 'auto', funcion: 'fog', conector: 'H4' });
  assert.match(html, /action="\/productos"/);
  assert.match(html, /method="get"/);
  for (const name of ['vehiculo', 'categoria', 'funcion', 'q', 'conector']) assert.ok(html.includes(`name="${name}"`));
  assert.ok(html.includes('Auto · Antiniebla · Conector H4'));
  assert.ok(html.includes('data-product="dual"'));
  assert.ok(!html.includes('data-product="legacy"'));
  assert.ok(html.includes('no confirman compatibilidad'));
  const empty = render({ vehiculo: 'camion', funcion: 'fog' });
  assert.ok(empty.includes('No encontramos productos clasificados'));
  assert.ok(empty.includes('Ver catálogo completo'));
  assert.ok(empty.includes('href="/productos"'));
  assert.ok(render({ vehiculo: 'unknown' }).includes('filtros no válidos'));
});

test('both Home entries link to the same URL contract and share taxonomy options', () => {
  const { VehicleCategories } = load('components/sections/VehicleCategories.tsx', { ...mocks,
    '@/components/providers/SiteContentProvider': { useSiteContent: () => ({ content: { vehicleCategories: [] } }) },
    '@/components/ui/ManagedImage': { ManagedImage: () => null },
  });
  const { NeedCategories } = load('components/sections/NeedCategories.tsx', mocks);
  const vehicles = renderToStaticMarkup(React.createElement(VehicleCategories));
  const needs = renderToStaticMarkup(React.createElement(NeedCategories));
  for (const option of taxonomy.productVehicleTypes) assert.ok(vehicles.includes(`href="/vehiculos?vehiculo=${option.id}"`));
  for (const need of taxonomy.productNeeds) assert.ok(needs.includes(`href="${href(need.filters)}"`));
  assert.ok(!vehicles.includes('id="vehiculos"'));
});

test('commercial analytics allow only controlled classification and exclude free text, URLs and personal data', () => {
  const { sanitizeStoreEvent } = load('lib/store/analytics-privacy.ts', { '@/lib/product-filters': filtersModule });
  for (const event of ['home_vehicle_selected', 'home_need_selected', 'product_filter_applied', 'product_filters_cleared']) {
    const safe = sanitizeStoreEvent(event, { vehicle_type: 'auto', category: 'iluminacion-frontal', function: 'fog', q: 'secret', name: 'Name', phone: '123', product_id: 'id', $current_url: 'https://private.invalid', conector: 'H4' });
    assert.equal(safe.vehicle_type, 'auto');
    assert.equal(safe.category, 'iluminacion-frontal');
    assert.equal(safe.function, 'fog');
    for (const key of ['q', 'name', 'phone', 'product_id', '$current_url', 'conector']) assert.equal(Object.hasOwn(safe, key), false);
    const invalid = sanitizeStoreEvent(event, { vehicle_type: 'personal data', function: 'xenon', category: 'unknown' });
    for (const key of ['vehicle_type', 'category', 'function']) assert.equal(Object.hasOwn(invalid, key), false);
  }
});
