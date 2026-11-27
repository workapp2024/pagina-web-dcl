/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./load-ts.cjs');

const taxonomy = load('lib/product-taxonomy.ts');
const filters = load('lib/product-filters.ts', { '@/lib/product-taxonomy': taxonomy }, { URLSearchParams });
const Link = ({ href, children, ...other }) => React.createElement('a', { href, ...other }, children);
const Finder = ({ initialType }) => React.createElement('div', { 'data-vehicle-finder': initialType });
const SmartProductSearch = load('components/public/SmartProductSearch.tsx', {
  'next/link': { __esModule: true, default: Link },
  '@/components/public/VehicleFinder': { VehicleFinder: Finder },
  '@/lib/product-filters': filters,
  '@/lib/product-taxonomy': taxonomy,
}).SmartProductSearch;

const product = (id, connectorType, overrides = {}) => ({
  id, name: id, connectorType, active: true, showInCatalog: true, ...overrides,
});
const products = [
  product('p1', 'H7'), product('p2', 'h4'),
  product('hidden', '9005', { showInCatalog: false }),
  product('inactive', '9006', { active: false }),
];

test('search renders the approved two-mode design and submits connector parameter', () => {
  const html = renderToStaticMarkup(React.createElement(SmartProductSearch, { products }));
  for (const title of ['Encontrá tu LED ideal', 'Elegí cómo querés buscar tu iluminación.', 'Por conector', 'Por vehículo', 'Buscar productos']) {
    assert.ok(html.includes(title), title);
  }
  assert.match(html, /action="\/productos"/);
  assert.match(html, /name="conector"/);
  assert.match(html, /type="search"/);
  assert.match(html, /H7/);
  assert.match(html, /H4/);
  assert.ok(!html.includes('9005'), 'unpublished connectors must not be suggested');
  assert.ok(!html.includes('9006'), 'inactive connectors must not be suggested');
});

test('popular connector suggestion opens canonical catalog filter, not free text', () => {
  const html = renderToStaticMarkup(React.createElement(SmartProductSearch, { products }));
  assert.ok(html.includes(filters.productCatalogHref({ connectorType: 'H7' }).replaceAll('&', '&amp;')));
  const matched = filters.filterCatalogProducts(products, filters.parseProductFilters({ conector: 'h7' }));
  assert.deepEqual(Array.from(matched, p => p.id), ['p1']);
});

test('vehicle search uses the existing compatibility engine and does not infer it from product tags', () => {
  const html = renderToStaticMarkup(React.createElement(SmartProductSearch, {
    products, initialVehicle: 'moto',
  }));
  assert.ok(html.includes('Tipo de vehículo'));
  for (const label of ['Auto', 'Camioneta', 'Moto', 'Camión']) assert.ok(html.includes(label));
  assert.ok(html.includes('data-vehicle-finder="Moto"'));
  assert.ok(!html.includes('Buscar productos'), 'vehicle mode must not show an extra connector form');
});

test('catalog and pages retain the approved shared search and secondary filters', () => {
  const catalog = fs.readFileSync('components/public/ProductCatalog.tsx', 'utf8');
  const vehicles = fs.readFileSync('components/sections/VehicleSelector.tsx', 'utf8');
  const home = fs.readFileSync('app/page.tsx', 'utf8');
  const vehiclePage = fs.readFileSync('app/vehiculos/page.tsx', 'utf8');
  const header = fs.readFileSync('components/layout/Header.tsx', 'utf8');
  assert.match(catalog, /<SmartProductSearch/);
  assert.match(catalog, /<details[\s\S]*Más filtros/);
  assert.match(vehicles, /<SmartProductSearch/);
  assert.match(home, /<VehicleSelector/);
  assert.match(vehiclePage, /<VehicleSelector/);
  assert.match(header, /<CartLink/);
  assert.match(header, /DCL Cree LED/);
  assert.ok(!header.includes('Mundo Cree LED'));
});
