/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./load-ts.cjs');
const { ConnectorField } = load('components/public/ConnectorField.tsx');
const filters = load('lib/product-filters.ts', {}, { URLSearchParams });
const nodes = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.props?.children)];
const text = n => typeof n === 'string' ? n : !n ? '' : Array.isArray(n) ? n.map(text).join('') : text(n.props?.children);
const products = ['H7', 'H4', 'H11', '9005'].map(connectorType => ({ id: connectorType, name: connectorType, connectorType, category: 'Iluminación frontal', active: true, showInCatalog: true, functions: [] }));

function hooks() {
  const states = [], refs = [], deps = [], effects = [];
  let cursor = 0, refCursor = 0, effectCursor = 0;
  return {
    reset() { cursor = refCursor = effectCursor = 0; },
    async flush() { while (effects.length) effects.shift()(); await new Promise(resolve => setImmediate(resolve)); },
    react: { ...React,
      useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
      useRef(initial) { return refs[refCursor++] ||= { current: initial }; },
      useEffect(fn, next) { const i = effectCursor++; if (!deps[i] || next.some((v, j) => v !== deps[i][j])) { deps[i] = next; effects.push(fn); } },
    },
  };
}

test('Home reveals two paths, shares connector input, preserves vehicle context and offers catalog/back', () => {
  const h = hooks();
  const Categories = () => null, Finder = () => null;
  const { VehicleSelector } = load('components/sections/VehicleSelector.tsx', {
    react: h.react,
    '@/components/sections/VehicleCategories': { VehicleCategories: Categories },
    '@/components/public/VehicleFinder': { VehicleFinder: Finder },
    '@/components/public/ConnectorField': { ConnectorField },
    '@/components/providers/SiteContentProvider': { useSiteContent: () => ({ content: { products } }) },
  });
  const render = () => { h.reset(); return VehicleSelector(); };
  const click = label => nodes(render()).find(n => n.type === 'button' && text(n).includes(label)).props.onClick();
  const catalog = () => assert.ok(nodes(render()).some(n => n.props?.href === '/productos' && text(n) === 'Ver todos los productos'));
  assert.equal(nodes(render()).filter(n => n.type === 'form').length, 0); catalog();
  nodes(render()).find(n => n.type === Categories).props.onSelect('auto');
  assert.ok(text(render()).includes('No sé cuál lleva mi auto'));
  assert.ok(!nodes(render()).some(n => n.type === Categories));
  click('Ya sé'); catalog();
  const form = nodes(render()).find(n => n.type === 'form');
  assert.equal(form.props.action, '/productos'); assert.equal(form.props.method, 'get');
  const field = nodes(render()).find(n => n.type === ConnectorField);
  const html = renderToStaticMarkup(React.createElement(ConnectorField, field.props));
  assert.match(html, /name="conector"/); assert.match(html, /list="finder-connectors"/);
  assert.equal((html.match(/<input/g) || []).length, 1);
  for (const conector of ['H7', 'H4', 'H11', '9005']) assert.deepEqual(Array.from(filters.filterCatalogProducts(products, filters.parseProductFilters({ conector })), p => p.id), [conector]);
  assert.ok(!nodes(form).some(n => n.type === 'input' && ['vehiculo', 'marca', 'modelo', 'year'].includes(n.props.name)));
  click('Volver'); click('No sé'); catalog();
  assert.equal(nodes(render()).find(n => n.type === Finder).props.initialType, 'Auto');
  click('Volver'); click('Cambiar vehículo');
  for (const [id, label] of [['camioneta', 'camioneta'], ['moto', 'moto'], ['camion', 'camión']]) {
    nodes(render()).find(n => n.type === Categories).props.onSelect(id);
    assert.ok(text(render()).includes('No sé cuál lleva mi ' + label));
    click('Cambiar vehículo');
  }
});

test('progressive fitment fields reuse selected type, clear dependent values and retain fallback context', async () => {
  const h = hooks(), calls = [];
  const WhatsApp = () => null;
  const { VehicleFinder } = load('components/public/VehicleFinder.tsx', {
    react: h.react,
    '@/components/providers/SiteContentProvider': { useSiteContent: () => ({ content: { products } }) },
    '@/components/ui/WhatsAppButton': { WhatsAppButton: WhatsApp },
    '@/components/ui/ManagedImage': { ManagedImage: () => null },
    '@/components/store/ProductPurchaseActions': { ProductPurchaseActions: () => null },
    '@/lib/analytics': { analyticsEvents: {}, capture() {} },
    '@/lib/supabase/vehicle-compatibility': {
      VEHICLE_TYPES: ['Auto', 'Camioneta', 'Moto', 'Camión'],
      getPublicVehicleBrands: async type => { calls.push(type); return [{ id: 'vw', name: 'Volkswagen' }]; },
      getPublicVehicleModels: async () => [{ id: 'bora', name: 'Bora' }],
      searchPublicVehicleCompatibilities: async (...args) => { calls.push(args); return [{ id: 'fitment', brandName: 'Volkswagen', modelName: 'Bora', yearFrom: 2015, yearTo: 2018, connectorHigh: 'H7' }]; },
    },
  });
  const render = () => { h.reset(); return VehicleFinder({ initialType: 'Auto' }); };
  const flush = async () => { render(); await h.flush(); render(); };
  const inputs = () => nodes(render()).filter(n => n.type === 'input');
  const change = async (index, value) => { inputs()[index].props.onChange({ target: { value } }); await flush(); };
  await flush();
  assert.deepEqual(calls, ['Auto']); assert.equal(inputs().length, 1);
  assert.ok(!nodes(render()).some(n => n.type === 'select'));
  assert.ok(!nodes(render()).some(n => n.type === 'a' || n.type === WhatsApp));
  await change(0, 'Volkswagen'); assert.equal(inputs().length, 2);
  await change(1, 'Bora'); assert.equal(inputs().length, 3);
  await change(2, '201'); assert.ok(!nodes(render()).some(n => n.type === 'select'));
  await change(2, '2016');
  const position = nodes(render()).find(n => n.type === 'select');
  assert.ok(text(position).includes('Alta')); assert.ok(text(position).includes('Baja')); assert.ok(text(position).includes('Antiniebla'));
  position.props.onChange({ target: { value: 'high' } });
  nodes(render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await flush();
  assert.deepEqual(calls[1], ['Auto', 'vw', 'bora']);
  assert.equal(nodes(render()).find(n => n.type === 'details').props.open, false);
  assert.ok(text(render()).includes('Volkswagen Bora 2016 · Alta'));
  assert.ok(text(render()).includes('Conector compatible: H7'));
  assert.ok(nodes(render()).some(n => n.type === 'summary' && text(n) === 'Modificar búsqueda'));
  assert.ok(nodes(render()).some(n => n.props?.href === '/productos' && n.props['aria-label'] === 'Quitar contexto y ver todos los productos'));
  assert.ok(nodes(render()).some(n => n.props?.href?.includes('position=high&year=2016')));
  await change(1, 'Desconocido'); assert.equal(inputs()[2].props.value, '');
  assert.equal(nodes(render()).find(n => n.type === 'details').props.open, true);
  assert.ok(!nodes(render()).some(n => n.type === 'select'));
  await change(2, '2016');
  nodes(render()).find(n => n.type === 'select').props.onChange({ target: { value: 'low' } });
  nodes(render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await flush();
  assert.ok(text(render()).includes('No encontramos esta referencia todavía.'));
  const google = nodes(render()).find(n => n.type === 'a');
  const message = nodes(render()).find(n => n.type === WhatsApp).props.message;
  for (const value of ['Volkswagen', 'Desconocido', '2016', 'baja']) {
    assert.ok(new URL(google.props.href).searchParams.get('q').includes(value)); assert.ok(message.includes(value));
  }
  await change(0, ''); assert.equal(inputs().length, 1);
});

test('vehicle URL context reaches the shared flow without repeating the type question', async () => {
  const Selector = () => null;
  const { default: Page } = load('app/vehiculos/page.tsx', {
    '@/components/layout/Header': { Header: () => null }, '@/components/layout/Footer': { Footer: () => null },
    '@/components/ui/WhatsAppButton': { WhatsAppButton: () => null },
    '@/components/providers/SiteContentProvider': { SiteContentProvider: () => null },
    '@/components/sections/VehicleSelector': { VehicleSelector: Selector },
    '@/lib/supabase/products': { getSupabaseProducts: async () => [] },
  }, { URLSearchParams });
  for (const vehicle of ['auto', 'camioneta', 'moto', 'camion']) {
    const tree = await Page({ searchParams: Promise.resolve({ vehiculo: vehicle }) });
    assert.equal(nodes(tree).find(n => n.type === Selector).props.initialVehicle, vehicle);
  }
});
