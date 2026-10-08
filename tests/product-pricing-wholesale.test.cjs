/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const React = require('react');
const load = require('./load-ts.cjs');
const math = load('lib/product-pricing.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const text = tree => typeof tree === 'string' ? tree : Array.isArray(tree) ? tree.map(text).join('') : text(tree?.props?.children || '');

test('markup and sales margin are distinct, reversible and undefined without a positive cost', () => {
  assert.equal(math.calculateMarginPercentage(100, 150), 50);
  assert.equal(math.pricingProfit(100, 150).margin, 33.33);
  assert.equal(math.calculateSalePrice(100, 50), 150);
  assert.equal(math.priceFromSalesMargin(100, 20), 125);
  assert.equal(math.priceFromSalesMargin(100, 100), undefined);
  for (const cost of [undefined, 0, -10]) assert.equal(math.pricingProfit(cost, 150), null);
  assert.equal(math.pricingProfit(100, 80).belowCost, true);
  assert.equal(math.pricingProfit(100, 80).gain, -20);
  assert.equal(math.parsePricingInput('10.300,50'), 10300.5);
});

test('inline editor changes both price tiers in both directions, preserves prices on cost changes and blocks invalid drafts', () => {
  let product = { id: 'p', price: 150, costPrice: 100, marginPercentage: 50, wholesalePrice: 120, previousPrice: 180, images: ['/existing.webp'] }, invalid;
  const states = []; let cursor = 0;
  const { ProductPricingFields } = load('components/admin/ProductPricingFields.tsx', { react: { ...React,
    useState: initial => { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], update => { states[index] = typeof update === 'function' ? update(states[index]) : update; }]; }, useEffect: fn => fn(),
  } });
  const render = () => { cursor = 0; return ProductPricingFields({ product, onChange: changes => { product = { ...product, ...changes }; }, onValidityChange: value => { invalid = value; } }); };
  const edit = (label, value, occurrence = 0) => { const field = nodes(render()).filter(n => n.type === 'label' && text(n).startsWith(label))[occurrence]; nodes(field).find(n => n.type === 'input').props.onChange({ target: { value } }); render(); };
  edit('Precio mayorista', '130'); assert.equal(product.wholesalePrice, 130); assert.equal(product.price, 150);
  edit('Recargo sobre costo', '40', 1); assert.equal(product.wholesalePrice, 140);
  edit('Margen sobre venta', '20', 1); assert.equal(product.wholesalePrice, 125);
  edit('Recargo sobre costo', '60'); assert.equal(product.price, 160); assert.equal(product.marginPercentage, 60);
  edit('Margen sobre venta', '20'); assert.equal(product.price, 125); assert.equal(product.marginPercentage, 25);
  edit('Precio de costo', '120'); assert.equal(product.price, 125); assert.equal(product.wholesalePrice, 125); assert.equal(product.marginPercentage, 4.17);
  assert.equal(product.previousPrice, 180); assert.deepEqual(product.images, ['/existing.webp']);
  edit('Precio mayorista', '0'); assert.equal(invalid, true); assert.equal(product.wholesalePrice, 125);
  edit('Precio mayorista', ''); assert.equal(invalid, false); assert.equal(product.wholesalePrice, null);
  edit('Precio de costo', ''); assert.equal(product.costPrice, undefined); assert.equal(product.marginPercentage, undefined);
  assert.match(text(render()), /Ingresá un costo mayor que cero/);
});

function apiHarness(error = null, authenticated = true) {
  const writes = [];
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { id: 'p', category: 'General' } }), update: patch => { writes.push(plain(patch)); return chain; }, single: async () => ({ data: {}, error }) };
  const { POST } = load('app/api/admin/products/route.ts', {
    '@/lib/admin-auth': { isAdminAuthenticated: async () => authenticated }, '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => ({ from: () => chain }) }, '@/lib/supabase/products': {},
  });
  return { writes, save: changes => POST(new Request('https://test.invalid', { method: 'POST', body: JSON.stringify({ product: { id: 'p', name: 'Existing', category: 'General', price: 150, costPrice: 100, previousPrice: 180, ...changes } }) })) };
}

test('admin persistence validates optional wholesale price and preserves retail/images/classification/stock contracts', async () => {
  for (const value of [undefined, null, 120.5]) {
    const h = apiHarness(); assert.equal((await h.save(value === undefined ? {} : { wholesalePrice: value })).status, 200);
    const saved = h.writes[0]; assert.equal(saved.price, 150); assert.equal(saved.cost_price, 100); assert.equal(saved.previous_price, 180);
    assert.equal(Object.hasOwn(saved, 'wholesale_price'), value !== undefined);
    if (value !== undefined) assert.equal(saved.wholesale_price, value);
    assert.equal(Object.hasOwn(saved, 'stock'), false); assert.equal(Object.hasOwn(saved, 'additional_image_urls'), false); assert.equal(Object.hasOwn(saved, 'category'), false);
  }
  for (const wholesalePrice of [-1, 0, 'bad', '120', 12.345, 10000000000]) { const h = apiHarness(); assert.equal((await h.save({ wholesalePrice })).status, 400); assert.equal(h.writes.length, 0); }
  const denied = apiHarness(null, false); assert.equal((await denied.save({ wholesalePrice: 120 })).status, 401); assert.equal(denied.writes.length, 0);
  const missing = apiHarness({ message: 'column wholesale_price does not exist' }); assert.equal((await missing.save({ wholesalePrice: 120 })).status, 503);
});

test('public product mapping and explicit selects never expose injected wholesale price; migration is additive and private', async () => {
  const reads = [], row = { id: 'p', name: 'Existing', price: 150, wholesale_price: 120, cost_price: 100, category: 'General', active: true, additional_image_urls: [] };
  const chain = { select: columns => { reads.push(columns); return chain; }, eq: () => chain, order: async () => ({ data: [row] }) };
  const products = load('lib/supabase/products.ts', { './client': {}, './server': { createServerClient: () => ({ from: () => chain }) }, './test-connection': { isSupabaseConfigured: () => true }, './storage': { sanitizeStoredImageUrl: () => '' } });
  const publicRows = await products.getSupabaseProducts();
  assert.equal(publicRows[0].price, 150); assert.equal(Object.hasOwn(publicRows[0], 'wholesalePrice'), false);
  assert.equal(products.mapAdminProductRow(row).wholesalePrice, 120);
  assert.ok(reads.every(columns => !columns.includes('wholesale_price') && columns !== '*'));
  const sql = fs.readFileSync('supabase/migrations/20261007010000_product_wholesale_price.sql', 'utf8');
  assert.match(sql, /ADD COLUMN wholesale_price NUMERIC\(12,2\)/); assert.match(sql, /FROM PUBLIC, anon, authenticated/); assert.match(sql, /has_column_privilege/);
  assert.doesNotMatch(sql, /\b(?:DELETE|INSERT INTO|UPDATE public|DROP|CREATE.*FUNCTION)\b/i);
});
