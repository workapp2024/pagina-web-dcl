/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./load-ts.cjs');
const images = load('lib/product-images.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
const settle = () => new Promise(resolve => setImmediate(resolve));
function hooks() {
  const states = [], refs = [], effects = []; let cursor = 0, refCursor = 0;
  return { refs, effects, reset() { cursor = 0; refCursor = 0; }, react: {
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], v => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useRef(initial) { const i = refCursor++; return refs[i] ||= { current: initial }; },
    useEffect(callback) { if (!effects.length) effects.push(callback); },
  } };
}

test('additional image contract caps at two, rejects transient/unsafe/duplicate references and preserves cover first', () => {
  for (const value of [[], ['/second.webp'], ['/second.webp', 'https://storage.example/third.webp']]) assert.deepEqual(plain(images.validateAdditionalProductImages(value, '/main.webp')), value);
  for (const value of [null, 'url', ['/1', '/2', '/3'], ['/same', '/same'], ['/main.webp'], ['blob:local'], ['data:image/png,x'], ['javascript:alert(1)'], ['//external/path'], [''], [null]]) assert.throws(() => images.validateAdditionalProductImages(value, '/main.webp'));
  assert.deepEqual(plain(images.productImageSources({ image: '/main.webp', images: ['/second.webp', '/third.webp'] })), ['/main.webp', '/second.webp', '/third.webp']);
  assert.deepEqual(plain(images.productImageSources({ image: 'http://old.example/cover.jpg' })), ['http://old.example/cover.jpg']);
});

function apiHarness(authenticated = true, error = null) {
  const writes = [];
  const db = { from: () => {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { id: 'p', category: 'General' }, error: null }),
      update: patch => { writes.push(plain(patch)); return chain; }, single: async () => ({ data: {}, error }) }; return chain;
  } };
  const api = load('app/api/admin/products/route.ts', {
    '@/lib/admin-auth': { isAdminAuthenticated: async () => authenticated },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => db },
    '@/lib/supabase/products': {}, '@/lib/product-images': images,
  });
  const save = additions => api.POST(new Request('https://test.invalid', { method: 'POST', body: JSON.stringify({ product: { id: 'p', name: 'Product', category: 'General', image: '/cover.webp', stock: 99, ...additions } }) }));
  return { writes, save };
}
test('product API saves/replaces/removes additions, preserves omitted images and never changes stock or classification', async () => {
  for (const value of [undefined, [], ['/a.webp'], ['/a.webp', '/b.webp']]) {
    const h = apiHarness(); assert.equal((await h.save(value === undefined ? {} : { images: value })).status, 200);
    assert.equal(h.writes[0].image_url, '/cover.webp');
    if (value === undefined) assert.equal(Object.hasOwn(h.writes[0], 'additional_image_urls'), false);
    else assert.deepEqual(h.writes[0].additional_image_urls, value);
    for (const key of ['stock', 'category', 'functions', 'vehicle_types']) assert.equal(Object.hasOwn(h.writes[0], key), false);
  }
  for (const [h, value, status] of [[apiHarness(false), [], 401], [apiHarness(), ['/1', '/2', '/3'], 400], [apiHarness(), ['/cover.webp'], 400]]) {
    assert.equal((await h.save({ images: value })).status, status); assert.equal(h.writes.length, 0);
  }
  assert.equal((await apiHarness(true, { message: 'column additional_image_urls does not exist' }).save({ images: ['/1'] })).status, 503);
});

test('public and admin reads carry additions, tolerate pending migration, and public reads exclude private fields', async () => {
  for (const missing of [false, true]) {
    const calls = []; const row = { id: 'p', category: 'General', image_url: '/main.webp', additional_image_urls: missing ? undefined : ['/a.webp', '/b.webp'], stock: 7, cost_price: 30, vehicle_types: [], functions: [] };
    const db = { from: () => { const call = { filters: [] }; calls.push(call); const chain = { select: cols => { call.cols = cols; return chain; }, eq: (...args) => { call.filters.push(args); return chain; }, order: async () => missing && calls.length === 1 ? { data: null, error: { code: '42703', message: 'column additional_image_urls missing' } } : { data: [row], error: null } }; return chain; } };
    const data = load('lib/supabase/products.ts', { './client': {}, './server': { createServerClient: () => db }, './storage': { sanitizeStoredImageUrl: v => v }, './test-connection': { isSupabaseConfigured: () => true } });
    const products = await data.getSupabaseProducts();
    assert.equal(products[0].image, '/main.webp'); assert.deepEqual(plain(products[0].images ?? []), missing ? [] : ['/a.webp', '/b.webp']);
    assert.equal(Object.hasOwn(products[0], 'stock'), false); assert.equal(Object.hasOwn(products[0], 'costPrice'), false);
    assert.equal(data.mapAdminProductRow(row).stock, 7);
    for (const call of calls) { assert.doesNotMatch(call.cols, /cost_price|stock|margin_percentage/); assert.deepEqual(plain(call.filters), [['active', true], ['show_in_catalog', true]]); }
    if (missing) assert.ok(!calls[1].cols.includes('additional_image_urls'));
  }
});

test('compact manager searches loaded products, opens one editor, cancels drafts and saves a new product only once', async () => {
  const h = hooks(), writes = []; let succeed = true;
  const originals = [{ id: 'a', name: 'Alpha', price: 150, stock: 4, active: true, image: '/main.webp', images: ['/second.webp'], category: 'General' }, { id: 'b', name: 'Beta', price: 90, stock: 2, active: false }];
  const Dialog = () => null, Classification = () => null;
  const { AdminProductsManager } = load('components/admin/EditorForms.tsx', {
    react: h.react, '@/components/admin/ProductEditorDialog': { ProductEditorDialog: Dialog }, '@/components/admin/ProductClassificationEditor': { ProductClassificationEditor: Classification },
    '@/components/providers/SiteContentProvider': {}, '@/components/ui/ManagedImage': { ManagedImage: () => null },
    '@/lib/supabase/storage': { validateImageFile: () => ({ valid: true }) },
    '@/lib/supabase/products': { getAdminSupabaseProducts: async () => ({ success: true, products: originals }), upsertSupabaseProduct: async p => { writes.push(plain(p)); await settle(); return { success: succeed, error: 'Save failed' }; } },
    '@/lib/supabase/promotions': {}, '@/lib/supabase/vehicle-categories': {}, '@/lib/supabase/site-settings': {}, '@/lib/site-settings-patch': {}, '@/lib/supabase/home-settings': {},
  }, { window: { confirm: () => true }, setTimeout: () => 0 });
  const render = () => { h.reset(); return AdminProductsManager(); };
  const button = label => nodes(render()).find(n => n.type === 'button' && text(n) === label);
  render(); h.effects[0](); await settle();
  assert.equal(nodes(render()).filter(n => n.type === Dialog).length, 0);
  assert.ok(text(render()).includes('Stock: 4')); assert.ok(text(render()).includes('Inactivo'));
  nodes(render()).find(n => n.type === 'input' && n.props.type === 'search').props.onChange({ target: { value: 'BETA' } });
  assert.equal(nodes(render()).filter(n => n.type === 'article').length, 1);
  button('Editar').props.onClick(); assert.equal(nodes(render()).filter(n => n.type === Dialog).length, 1);
  assert.deepEqual(nodes(render()).filter(n => n.type === 'summary').map(text), ['Información general', 'Clasificación', 'Especificaciones técnicas', 'Gestión interna']);
  nodes(render()).find(n => n.type === Classification).props.onPendingChange(true);
  button('Guardar producto').props.onClick(); await settle();
  assert.equal(writes.length, 0);
  assert.ok(text(render()).includes('Guardá primero los cambios de Clasificación'));
  nodes(render()).find(n => n.type === Classification).props.onBusyChange(true);
  nodes(render()).find(n => n.type === Dialog).props.onClose();
  assert.ok(nodes(render()).some(n => n.type === Dialog));
  nodes(render()).find(n => n.type === Classification).props.onBusyChange(false);
  nodes(render()).find(n => n.type === Dialog).props.onClose();
  button('+ Agregar producto').props.onClick();
  assert.equal(writes.length, 0); assert.equal(nodes(render()).find(n => n.type === Dialog).props.title, 'Nuevo producto');
  const nameInput = nodes(render()).find(n => n.type === 'input' && n.props.value === 'Nuevo producto'); nameInput.props.onChange({ target: { value: 'New lamp' } });
  const cls = nodes(render()).find(n => n.type === Classification); cls.props.onDraftChange({ category: 'Accesorios', functions: [], vehicleTypes: ['auto', 'camioneta'] });
  succeed = false; button('Guardar producto').props.onClick(); await settle(); await settle();
  assert.ok(nodes(render()).some(n => n.type === Dialog)); assert.equal(nodes(render()).filter(n => n.type === 'article').length, 1);
  succeed = true; const save = button('Guardar producto'); save.props.onClick(); save.props.onClick(); await settle(); await settle();
  assert.equal(writes.length, 2); assert.equal(writes[1].name, 'New lamp'); assert.deepEqual(writes[1].vehicleTypes, ['auto', 'camioneta']);
  assert.equal(nodes(render()).filter(n => n.type === Dialog).length, 0);
  assert.equal(nodes(render()).find(n => n.type === 'input' && n.props.type === 'search').props.value, '');
  nodes(render()).find(n => n.type === 'input' && n.props.type === 'search').props.onChange({ target: { value: '' } });
  assert.equal(nodes(render()).filter(n => n.type === 'article').length, 3);
  button('+ Agregar producto').props.onClick(); nodes(render()).find(n => n.type === Dialog).props.onClose();
  assert.equal(writes.length, 2);
});

test('public gallery supports thumbnails, arrows, zoom and horizontal touch without treating vertical scrolling as navigation', () => {
  const h = hooks(), doc = { body: { style: { overflow: 'auto' } } };
  const { ProductImageGallery } = load('components/public/ProductImageGallery.tsx', { react: h.react, '@/components/ui/ManagedImage': { ManagedImage: () => null }, '@/lib/product-images': images }, { document: doc });
  const render = extra => { h.reset(); return ProductImageGallery({ name: 'Lamp', image: '/main.webp', images: extra ?? ['/a.webp', '/b.webp'] }); };
  const button = label => nodes(render()).find(n => n.type === 'button' && n.props['aria-label'] === label);
  assert.equal(nodes(render([])).filter(n => n.type === 'button' && n.props['aria-label'] === 'Imagen siguiente').length, 0);
  button('Ver imagen 3').props.onClick(); assert.equal(button('Ver imagen 3').props['aria-pressed'], true);
  button('Imagen siguiente').props.onClick(); assert.equal(button('Ver imagen 1 (principal)').props['aria-pressed'], true);
  const main = button('Ampliar imagen de Lamp');
  main.props.onTouchStart({ touches: [{ clientX: 200, clientY: 30 }] }); main.props.onTouchEnd({ changedTouches: [{ clientX: 40, clientY: 35 }] });
  assert.equal(button('Ver imagen 2').props['aria-pressed'], true);
  main.props.onTouchStart({ touches: [{ clientX: 200, clientY: 30 }] }); main.props.onTouchEnd({ changedTouches: [{ clientX: 180, clientY: 200 }] });
  assert.equal(button('Ver imagen 2').props['aria-pressed'], true);
  let opened = 0, closed = 0; h.refs[0].current = { showModal() { opened++; }, close() { closed++; } };
  button('Ampliar imagen de Lamp').props.onClick(); assert.equal(opened, 1); assert.equal(doc.body.style.overflow, 'hidden');
  nodes(render()).find(n => n.type === 'button' && text(n) === 'Cerrar imágenes').props.onClick(); assert.equal(closed, 1); assert.equal(doc.body.style.overflow, 'auto');
});

test('new migration only adds an optional-use array, caps additions and preserves all cover data (static only)', () => {
  const sql = fs.readFileSync('supabase/migrations/20260908020000_product_additional_images.sql', 'utf8');
  assert.match(sql, /ADD COLUMN additional_image_urls TEXT\[\] NOT NULL DEFAULT '\{\}'/);
  assert.match(sql, /cardinality\(additional_image_urls\) <= 2/);
  assert.match(sql, /GRANT SELECT \(additional_image_urls\)/);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|DROP|INSERT|TRUNCATE)\b/i);
});
