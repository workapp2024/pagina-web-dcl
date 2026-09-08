/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./load-ts.cjs');
const taxonomy = load('lib/product-taxonomy.ts', {}, { Error });
const plain = value => JSON.parse(JSON.stringify(value));
const patch = taxonomy.buildProductClassificationPatch;

test('classification PostgreSQL constraints accept the contract and reject unknown values in an isolated database', async () => {
  const db = new (require('@electric-sql/pglite').PGlite)();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE TABLE products(id TEXT PRIMARY KEY, name TEXT, slug TEXT);');
    await db.exec(fs.readFileSync('supabase/migrations/20260906020000_product_classification.sql', 'utf8'));
    await db.query("INSERT INTO products(id,name,slug) VALUES('taxonomy-test','Test','taxonomy-test')");
    for (const values of [[], ['auto'], ['auto', 'camioneta'], ['auto', 'camioneta', 'moto', 'camion'], null]) {
      await db.query('UPDATE products SET vehicle_types=$1::text[] WHERE id=$2', [values, 'taxonomy-test']);
    }
    for (const values of [[], ['high'], ['low'], ['high', 'low'], ['fog'], null]) {
      await db.query('UPDATE products SET functions=$1::text[] WHERE id=$2', [values, 'taxonomy-test']);
    }
    for (const values of [['avion'], ['colectivo'], ['auto', null]]) {
      await assert.rejects(db.query('UPDATE products SET vehicle_types=$1::text[] WHERE id=$2', [values, 'taxonomy-test']), error => error.code === '23514');
    }
    for (const values of [['xenon'], ['alta'], ['high', null]]) {
      await assert.rejects(db.query('UPDATE products SET functions=$1::text[] WHERE id=$2', [values, 'taxonomy-test']), error => error.code === '23514');
    }
  } finally { await db.close(); }
});

test('controlled categories, legacy retention, optional functions and canonical multiple selections', () => {
  for (const { id } of taxonomy.productCategories) assert.equal(patch({ category: id }).category, id);
  for (const id of taxonomy.legacyProductCategories) {
    assert.equal(patch({ category: id }, id).category, id);
    assert.throws(() => patch({ category: id }));
  }
  assert.deepEqual(plain(patch({ category: 'Accesorios', functions: [], vehicleTypes: [] })), { category: 'Accesorios', functions: [], vehicle_types: [] });
  assert.deepEqual(plain(patch({ vehicleTypes: ['camioneta', 'auto', 'auto'], functions: ['low', 'high', 'low'] })), { vehicle_types: ['auto', 'camioneta'], functions: ['high', 'low'] });
  assert.equal(taxonomy.normalizeVehicleTypes(['auto', 'camioneta', 'moto', 'camion']).length, 4);
  for (const value of [{ category: 'inventada' }, { vehicleTypes: ['avion'] }, { functions: ['xenon'] }, { functions: null }, { vehicleTypes: 'auto' }, { stock: 0 }, {}, []]) assert.throws(() => patch(value));
});

test('shared filters combine independent dimensions without treating unclassified as universal', () => {
  const old = { category: 'General' };
  assert.equal(taxonomy.matchesProductClassification(old, {}), true);
  assert.equal(taxonomy.matchesProductClassification(old, { vehicleType: 'auto' }), false);
  const product = { category: 'Iluminación frontal', vehicleTypes: ['auto', 'camioneta'], functions: ['high', 'low'], connectorType: 'H4' };
  assert.equal(taxonomy.matchesProductClassification(product, { category: product.category, vehicleType: 'camioneta', function: 'low', connectorType: 'h4' }), true);
  for (const filters of [{ vehicleType: 'moto' }, { function: 'fog' }, { category: 'Auxiliar' }, { connectorType: 'H7' }, { connectorType: '---' }]) assert.equal(taxonomy.matchesProductClassification(product, filters), false);
});

function apiHarness({ current = { id: 'p1', category: 'General' }, authenticated = true, result = {}, error = null } = {}) {
  const writes = [];
  const db = { from: () => {
    let writing = false;
    const chain = {
      select: () => chain, eq: () => chain,
      update: value => { writing = true; writes.push({ method: 'update', value: plain(value) }); return chain; },
      insert: value => { writing = true; writes.push({ method: 'insert', value: plain(value) }); return chain; },
      maybeSingle: async () => ({ data: writing ? result : current, error: writing ? error : null }),
      single: async () => ({ data: result, error }),
    }; return chain;
  } };
  const api = load('app/api/admin/products/route.ts', {
    '@/lib/admin-auth': { isAdminAuthenticated: async () => authenticated },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => db },
    '@/lib/supabase/products': { mapAdminProductRow: value => value },
    '@/lib/product-taxonomy': taxonomy,
  }, { Error });
  return { api, writes };
}
const request = body => new Request('https://test.invalid/api/admin/products', { method: 'PATCH', body: JSON.stringify(body) });

test('PATCH writes only changed classification, preserving all unrelated product columns', async () => {
  const { api, writes } = apiHarness();
  assert.equal((await api.PATCH(request({ id: 'p1', classification: { vehicleTypes: ['auto', 'camioneta'] } }))).status, 200);
  assert.deepEqual(writes, [{ method: 'update', value: { vehicle_types: ['auto', 'camioneta'] } }]);
});

test('PATCH rejects invalid values and unauthorized requests without writes; missing/concurrent rows are not inserted', async () => {
  for (const classification of [{ category: 'bad' }, { vehicleTypes: ['avion'] }, { functions: ['xenon'] }, { image: '' }, { stock: 0 }]) {
    const { api, writes } = apiHarness();
    assert.equal((await api.PATCH(request({ id: 'p1', classification }))).status, 400);
    assert.equal(writes.length, 0);
  }
  for (const [options, status] of [[{ authenticated: false }, 401], [{ current: null }, 404], [{ result: null }, 409], [{ error: { message: 'column vehicle_types does not exist' } }, 500]]) {
    const { api, writes } = apiHarness(options);
    assert.equal((await api.PATCH(request({ id: 'p1', classification: { functions: [] } }))).status, status);
    assert.ok(writes.every(write => write.method !== 'insert'));
  }
});

test('ordinary existing-product saves cannot roll back classification; new products receive validated classification', async () => {
  const product = { id: 'p1', name: 'Example', category: 'General', vehicleTypes: [], functions: [] };
  const existing = apiHarness();
  assert.equal((await existing.api.POST(request({ product }))).status, 200);
  for (const field of ['category', 'vehicle_types', 'functions', 'stock']) assert.equal(Object.hasOwn(existing.writes[0].value, field), false);
  const fresh = apiHarness({ current: null });
  assert.equal((await fresh.api.POST(request({ product: { ...product, vehicleTypes: ['auto', 'camioneta'], functions: ['high', 'low'] } }))).status, 200);
  assert.equal(fresh.writes[0].method, 'insert');
  assert.deepEqual(fresh.writes[0].value.functions, ['high', 'low']);
  const invalid = apiHarness({ current: null });
  assert.equal((await invalid.api.POST(request({ product: { ...product, functions: ['xenon'] } }))).status, 400);
  assert.equal(invalid.writes.length, 0);
});

test('public mapping and pre-migration fallback preserve visibility filters and exclude private fields', async () => {
  for (const missing of [false, true]) {
    const queries = [];
    const row = { id: 'p1', category: 'General', vehicle_types: missing ? undefined : ['auto', 'camioneta'], functions: missing ? null : ['high', 'low'], cost_price: 100, stock: 9, connector_type: 'H4' };
    const db = { from: () => {
      const query = { filters: [] }; queries.push(query);
      const chain = { select: columns => { query.columns = columns; return chain; }, eq: (...args) => { query.filters.push(args); return chain; }, order: async () => missing && queries.length === 1 ? { data: null, error: { code: '42703', message: 'column vehicle_types does not exist' } } : { data: [row], error: null } }; return chain;
    } };
    const productsModule = load('lib/supabase/products.ts', {
      './client': {}, './server': { createServerClient: () => db }, './test-connection': { isSupabaseConfigured: () => true }, './storage': { sanitizeStoredImageUrl: value => value }, '@/lib/product-taxonomy': taxonomy,
    });
    const products = await productsModule.getSupabaseProducts();
    assert.deepEqual(plain(products[0].vehicleTypes), missing ? [] : ['auto', 'camioneta']);
    assert.deepEqual(plain(products[0].functions), missing ? [] : ['high', 'low']);
    assert.equal(products[0].connectorType, 'H4');
    assert.equal(Object.hasOwn(products[0], 'stock'), false);
    assert.equal(Object.hasOwn(products[0], 'costPrice'), false);
    for (const query of queries) {
      assert.deepEqual(plain(query.filters), [['active', true], ['show_in_catalog', true]]);
      assert.ok(!/cost_price|margin_percentage|stock/.test(query.columns));
    }
    assert.equal(productsModule.mapAdminProductRow(row).stock, 9);
  }
});

test('Admin loads legacy and multiple selections and sends only the edited classification', async () => {
  const states = []; let cursor = 0; let sent; let saved;
  const React = require('react');
  const { ProductClassificationEditor } = load('components/admin/ProductClassificationEditor.tsx', {
    react: { ...React, useState: initial => { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; } },
    '@/lib/product-taxonomy': taxonomy,
  }, { fetch: async (url, options) => { sent = { url, ...options, body: JSON.parse(options.body) }; return Response.json({ ok: true, data: { category: 'Ópticas', vehicle_types: ['auto', 'camioneta'], functions: ['high'] } }); }, Error });
  const render = () => { cursor = 0; return ProductClassificationEditor({ product: { id: 'p1', category: 'Ópticas', vehicleTypes: ['auto', 'camioneta'], functions: ['high', 'low'], image: 'keep.jpg', stock: 7 }, onSaved: value => { saved = value; } }); };
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  let tree = nodes(render());
  assert.ok(tree.some(node => node.type === 'option' && node.props.value === 'Ópticas'));
  const checkboxes = tree.filter(node => node.type === 'input');
  assert.deepEqual(checkboxes.map(node => node.props.checked), [true, true, false, true, true, false, false]);
  checkboxes[1].props.onChange({ target: { checked: false } });
  tree = nodes(render());
  tree.find(node => node.type === 'button').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.method, 'PATCH');
  assert.deepEqual(sent.body, { id: 'p1', classification: { functions: ['high'] } });
  assert.deepEqual(plain(saved.functions), ['high']);
});

test('migration statically agrees with shared domains and contains no data rewrite or inventory changes', () => {
  const sql = fs.readFileSync('supabase/migrations/20260906020000_product_classification.sql', 'utf8');
  for (const options of [taxonomy.productVehicleTypes, taxonomy.productFunctions]) for (const { id } of options) assert.ok(sql.includes(`'${id}'`));
  assert.ok(!/\b(UPDATE|INSERT|DELETE|DROP|TRUNCATE)\b/i.test(sql));
  assert.ok(!/\b(stock|orders|payments|vehicle_compatibilities)\b/i.test(sql));
  assert.match(sql, /GRANT SELECT \(vehicle_types, functions\)/);
});
