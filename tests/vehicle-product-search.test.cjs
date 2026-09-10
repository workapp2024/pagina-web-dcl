/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./load-ts.cjs');
const taxonomy = load('lib/product-taxonomy.ts');
const filters = load('lib/product-filters.ts', {}, { URLSearchParams });
const search = load('lib/vehicle-product-search.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const lamp = (id, connectorType, extra = {}) => ({ id, name: id, category: 'Iluminación frontal', active: true, showInCatalog: true, connectorType, functions: [], image: '/cover.webp', images: ['/extra.webp'], ...extra });
const fitment = extra => ({ id: 'row', brandName: 'Marca', modelName: 'Modelo', yearFrom: 2015, yearTo: 2018, connectorLow: null, connectorHigh: null, connectorFog: null, connectorAux: null, combinedHighLow: false, ...extra });

test('integrated beams are an explicit boolean, never inferred from H4 or old high/low tags', () => {
  for (const integratedHighLow of [true, false]) assert.deepEqual(plain(taxonomy.buildProductClassificationPatch({ integratedHighLow })), { integrated_high_low: integratedHighLow });
  for (const integratedHighLow of ['true', 1, null]) assert.throws(() => taxonomy.buildProductClassificationPatch({ integratedHighLow }));
  const { mapAdminProductRow } = load('lib/supabase/products.ts', { './client': {}, './server': {}, './storage': { sanitizeStoredImageUrl: x => x }, './test-connection': {} });
  for (const connector_type of ['H4', 'H7']) {
    const old = mapAdminProductRow({ category: 'Iluminación frontal', connector_type, functions: ['high', 'low', 'fog'], image_url: '/cover.webp', additional_image_urls: ['/extra.webp'] });
    assert.equal(old.integratedHighLow, false);
    assert.deepEqual(plain(old.functions), ['fog']);
    assert.equal(old.image, '/cover.webp'); assert.deepEqual(plain(old.images), ['/extra.webp']);
  }
});

test('direct connector search is exact and needs no vehicle; free high/low URLs cannot return products', () => {
  const products = [lamp('H7', 'H7'), lamp('H4 compatible con nombre H7', 'H4'), lamp('H7 otro', 'H7')];
  for (const conector of ['H7', 'H4']) {
    for (const params of [{ conector }, { q: conector }]) {
      const result = filters.filterCatalogProducts(products, filters.parseProductFilters(params));
      assert.ok(result.length > 0);
      assert.ok(result.every(p => p.connectorType === conector));
    }
  }
  for (const funcion of ['high', 'low']) assert.equal(filters.filterCatalogProducts(products, filters.parseProductFilters({ vehiculo: 'auto', funcion })).length, 0);
  assert.ok(taxonomy.productNeeds.every(item => !['high', 'low'].includes(item.filters.function)));
});

test('vehicle results use the existing per-position/year fitment, independent of commercial tags', () => {
  const products = [lamp('seven', 'H7', { functions: ['low'] }), lamp('four', 'H4'), lamp('hidden', 'H7', { active: false })];
  for (const [position, field] of [['low', 'connectorLow'], ['high', 'connectorHigh'], ['fog', 'connectorFog']]) {
    const rows = [fitment({ [field]: 'H7' })];
    assert.deepEqual(plain(search.vehicleProductMatches(products, rows, '2016', position).map(x => x.product.id)), ['seven']);
    assert.equal(search.vehicleProductMatches(products, rows, '2020', position).length, 0);
    assert.equal(search.vehicleProductMatches(products, rows, '', position).length, 0);
  }
  assert.equal(search.vehicleProductMatches(products, [], '2016', 'low').length, 0);
});

test('reference search and centralized WhatsApp carry the entered vehicle/year/position safely', () => {
  const context = { type: 'Auto', brand: 'Marca & Más', model: 'Modelo X', year: '2016', position: 'low' };
  const links = search.vehicleReferenceLinks(context);
  const query = new URL(links.google).searchParams.get('q');
  for (const part of ['Marca & Más', 'Modelo X', '2016', 'baja']) { assert.ok(query.includes(part)); assert.ok(links.whatsappMessage.includes(part)); }
  const { whatsappUrl, DCL_WHATSAPP_NUMBER } = load('lib/whatsapp.ts');
  const whatsapp = new URL(whatsappUrl(links.whatsappMessage));
  assert.equal(whatsapp.pathname, '/' + DCL_WHATSAPP_NUMBER);
  assert.equal(whatsapp.searchParams.get('text'), links.whatsappMessage);
});

test('vehicle UI queries loaded compatibility IDs, accepts unknown vehicles and offers contextual exits', async () => {
  const states = [], refs = [], deps = [], effects = []; let cursor = 0, refCursor = 0, effectCursor = 0;
  const calls = [];
  const react = {
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef(initial) { const i = refCursor++; return refs[i] ||= { current: initial }; },
    useEffect(fn, next) { const i = effectCursor++; if (!deps[i] || next.some((v, j) => v !== deps[i][j])) { deps[i] = next; effects.push(fn); } },
  };
  const WhatsApp = () => null;
  const { VehicleFinder } = load('components/public/VehicleFinder.tsx', {
    react, '@/components/providers/SiteContentProvider': { useSiteContent: () => ({ content: { products: [lamp('seven', 'H7')] } }) },
    '@/components/ui/WhatsAppButton': { WhatsAppButton: WhatsApp }, '@/components/ui/ManagedImage': {}, '@/components/store/ProductPurchaseActions': {},
    '@/lib/analytics': { analyticsEvents: {}, capture() {} },
    '@/lib/supabase/vehicle-compatibility': { VEHICLE_TYPES: ['Auto'], getPublicVehicleBrands: async () => [{ id: 'brand', name: 'Marca' }], getPublicVehicleModels: async () => [{ id: 'model', name: 'Modelo' }], searchPublicVehicleCompatibilities: async (...args) => { calls.push(args); return [fitment({ connectorHigh: 'H7' })]; } },
  });
  const nodes = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.props?.children)];
  const render = () => { cursor = refCursor = effectCursor = 0; return VehicleFinder(); };
  const flush = async () => { render(); while (effects.length) effects.shift()(); await new Promise(r => setImmediate(r)); render(); };
  const change = async (type, index, value) => { nodes(render()).filter(n => n.type === type)[index].props.onChange({ target: { value } }); await flush(); };
  assert.ok(!nodes(render()).some(n => n.type === 'option' && n.props.value === 'high'));
  await change('select', 0, 'Auto'); await change('input', 0, 'Marca'); await change('input', 1, 'Modelo'); await change('input', 2, '2016'); await change('select', 1, 'high');
  nodes(render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await flush();
  assert.deepEqual(calls, [['Auto', 'brand', 'model']]);
  assert.ok(nodes(render()).some(n => n.props?.href?.includes('position=high&year=2016')));
  await change('input', 1, 'Desconocido'); await change('input', 2, '2016'); await change('select', 1, 'low');
  nodes(render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await flush();
  assert.equal(calls.length, 1);
  const google = nodes(render()).find(n => n.type === 'a');
  assert.equal(google.props.target, '_blank'); assert.ok(new URL(google.props.href).searchParams.get('q').includes('Desconocido 2016 para luz baja'));
  assert.ok(nodes(render()).find(n => n.type === WhatsApp).props.message.includes('Desconocido 2016 para luz baja'));
});

test('pending migration only changes product characteristic data, and detail preserves gallery and purchase actions', () => {
  const sql = fs.readFileSync('supabase/migrations/20260909010000_product_integrated_beam.sql', 'utf8');
  assert.match(sql, /ADD COLUMN integrated_high_low BOOLEAN NOT NULL DEFAULT false/);
  assert.match(sql, /array_remove\(array_remove\(functions, 'high'\), 'low'\)/);
  assert.doesNotMatch(sql, /(?:ALTER TABLE|UPDATE)\s+public\.vehicle_/);
  assert.doesNotMatch(sql, /\b(?:DELETE|TRUNCATE)\b/);
  const detail = fs.readFileSync('app/productos/[slug]/page.tsx', 'utf8');
  for (const marker of ['product.integratedHighLow', 'Alta + Baja integradas', '<ProductImageGallery', '<ProductPurchaseActions']) assert.ok(detail.includes(marker));
});
