/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./load-ts.cjs');
const plain = value => JSON.parse(JSON.stringify(value));

const search = load('lib/wholesale-catalog-search.ts');
const selectionTools = load('lib/wholesale-order-selection.ts');
const product = (id, category, connectorType, wholesalePrice) => ({
  id, name: `Lámpara ${id}`, description: 'LED', imageUrl: '', category, connectorType,
  functions: [], vehicleTypes: [], wholesalePrice,
});
const products = [product('h7-led', 'Iluminación frontal', 'H7', 12000), product('fog-led', 'Auxiliar', 'H11', 18000)];

test('wholesale catalog view starts empty, reveals filtered results, and hides them again when cleared', () => {
  const initial = search.getWholesaleCatalogView(products, '', '', null);
  assert.deepEqual(plain(initial), { active: false, products: [] });

  const textResults = search.getWholesaleCatalogView(products, 'H7', '', null);
  assert.equal(textResults.active, true);
  assert.deepEqual(plain(textResults.products.map(item => item.id)), ['h7-led']);

  const categoryResults = search.getWholesaleCatalogView(products, '', 'Auxiliar', null);
  assert.equal(categoryResults.active, true);
  assert.deepEqual(plain(categoryResults.products.map(item => item.id)), ['fog-led']);

  const vehicleResults = search.getWholesaleCatalogView(products, '', '', [{ product: products[1], fitments: ['Fiat Uno · 2020 · Baja'] }]);
  assert.equal(vehicleResults.active, true);
  assert.deepEqual(plain(vehicleResults.products.map(item => item.id)), ['fog-led']);

  assert.deepEqual(plain(search.getWholesaleCatalogView(products, '', '', null)), { active: false, products: [] });
  const source = fs.readFileSync('components/wholesale/WholesaleCatalog.tsx', 'utf8');
  assert.match(source, /!loading && catalogLoaded && !vehicleLoading && hasActiveSearch/);
  assert.match(source, /!loading && catalogLoaded && !hasActiveSearch/);
  assert.match(source, /setAppliedQuery\(""\)/);
});

test('cart persistence stores only product IDs and quantities, then restores current catalog data', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const selection = { 'h7-led': { product: products[0], quantity: 3 } };

  selectionTools.persistWholesaleSelection(storage, selection);
  const serialized = values.get(selectionTools.WHOLESALE_SELECTION_STORAGE_KEY);
  assert.deepEqual(JSON.parse(serialized), [{ productId: 'h7-led', quantity: 3 }]);
  assert.doesNotMatch(serialized, /wholesalePrice|price|idempotency|token|code|cost/i);

  const currentProduct = { ...products[0], wholesalePrice: 13500 };
  const restored = selectionTools.restoreWholesaleSelectionFromStorage(storage, [currentProduct]);
  assert.equal(restored['h7-led'].quantity, 3);
  assert.equal(restored['h7-led'].product, currentProduct);
  assert.equal(restored['h7-led'].product.wholesalePrice, 13500);
  assert.equal(restored['fog-led'], undefined);

  const source = fs.readFileSync('components/wholesale/WholesaleCatalog.tsx', 'utf8');
  assert.match(source, /restoreWholesaleSelectionFromStorage\(window\.localStorage, catalog\)/);
  assert.match(source, /persistWholesaleSelection\(window\.localStorage, restored\)/);
  assert.match(source, /\/api\/wholesale\/orders\/attempts/);
  assert.doesNotMatch(source, /localStorage[^\n]*(?:attemptId|idempotencyKey|crypto\.randomUUID)/);
  assert.doesNotMatch(source, /crypto\.randomUUID|idempotencyKey|pendingRequest/);
});

test('cart persistence prunes ineligible products and clears only after successful order response', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  selectionTools.persistWholesaleSelection(storage, {
    'h7-led': { product: products[0], quantity: 2 },
    'fog-led': { product: products[1], quantity: 1 },
  });

  const restored = selectionTools.restoreWholesaleSelectionFromStorage(storage, [products[0]]);
  assert.deepEqual(Object.keys(restored), ['h7-led']);
  selectionTools.persistWholesaleSelection(storage, restored);
  assert.deepEqual(JSON.parse(values.get(selectionTools.WHOLESALE_SELECTION_STORAGE_KEY)), [{ productId: 'h7-led', quantity: 2 }]);
  selectionTools.persistWholesaleSelection(storage, {});
  assert.equal(values.has(selectionTools.WHOLESALE_SELECTION_STORAGE_KEY), false);

  const source = fs.readFileSync('components/wholesale/WholesaleCatalog.tsx', 'utf8');
  assert.match(source, /if \(!response\.ok \|\| !body\.ok\) throw/);
  assert.ok(source.indexOf('if (!response.ok || !body.ok) throw') < source.indexOf('clearSubmittedSelection(currentSelection)'));
});

test('quantity controls accept only integer drafts from 1 to 100 and restore invalid values', () => {
  assert.equal(selectionTools.parseWholesaleQuantityDraft('2'), 2);
  assert.equal(selectionTools.parseWholesaleQuantityDraft('12'), 12);
  for (const value of ['', '0', '101', '-1', '1.5', 'NaN', ' 2']) {
    assert.equal(selectionTools.parseWholesaleQuantityDraft(value), null, value);
  }

  const drawer = fs.readFileSync('components/wholesale/WholesaleCartDrawer.tsx', 'utf8');
  assert.match(drawer, /type="text"[\s\S]*inputMode="numeric"/);
  assert.match(drawer, /value=\{draft\}/);
  assert.match(drawer, /onChange=\{event => setEdit\(\{ quantity, draft: event\.target\.value, invalid: false \}\)\}/);
  assert.match(drawer, /onBlur=\{commitDraft\}/);
  assert.match(drawer, /if \(parsed === null\) \{\s*setEdit\(\{ quantity, draft: String\(quantity\), invalid: true \}\)/);
  assert.match(drawer, /onQuantityChange\(product\.id, 0\)/);
});

test('add increments an existing product once, quantity updates reject invalid values, and totals stay aligned', () => {
  const selection = { 'h7-led': { product: products[0], quantity: 2 } };
  const incremented = selectionTools.addWholesaleProduct(selection, products[0]);
  assert.equal(incremented.changed, true);
  assert.equal(incremented.selection['h7-led'].quantity, 3);

  const sameQuantity = selectionTools.setWholesaleQuantity(selection, 'h7-led', 2);
  assert.equal(sameQuantity.changed, false);
  assert.equal(sameQuantity.selection, selection);

  const changedQuantity = selectionTools.setWholesaleQuantity(selection, 'h7-led', 3);
  assert.equal(changedQuantity.changed, true);
  assert.equal(changedQuantity.selection['h7-led'].quantity, 3);

  const addedProduct = selectionTools.addWholesaleProduct(selection, products[1]);
  assert.equal(addedProduct.changed, true);
  assert.equal(addedProduct.selection['fog-led'].quantity, 1);

  for (const invalid of [-1, 1.5, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
    const rejected = selectionTools.setWholesaleQuantity(selection, 'h7-led', invalid);
    assert.equal(rejected.changed, false);
    assert.equal(rejected.selection, selection);
  }

  const totals = selectionTools.getWholesaleSelectionTotals({
    'h7-led': { product: products[0], quantity: 2 },
    'fog-led': { product: products[1], quantity: 3 },
  });
  assert.deepEqual(plain(totals), { totalUnits: 5, indicativeTotal: 78000 });
  assert.equal(selectionTools.addWholesaleProduct({ 'h7-led': { product: products[0], quantity: 100 } }, products[0]).changed, false);

  const removedProduct = selectionTools.setWholesaleQuantity(selection, 'h7-led', 0);
  assert.equal(removedProduct.changed, true);
  assert.equal(removedProduct.selection['h7-led'], undefined);
  const source = fs.readFileSync('components/wholesale/WholesaleCatalog.tsx', 'utf8');
  assert.match(source, /setWholesaleQuantity\(selectionRef\.current, productId, quantity\)/);
  assert.match(source, /El carrito actual se mantiene aparte/);
  assert.match(source, /window\.addEventListener\("storage", syncSelection\)/);
  assert.match(source, /savedSelection !== serializeWholesaleSelection\(submitted\)/);
  assert.match(source, /cartFeedback/);
  assert.match(source, /selectedQuantity=\{selection\[product\.id\]\?\.quantity\}/);
});

test('top cart uses one drawer for quantity edits and order submission', () => {
  const catalog = fs.readFileSync('components/wholesale/WholesaleCatalog.tsx', 'utf8');
  const drawer = fs.readFileSync('components/wholesale/WholesaleCartDrawer.tsx', 'utf8');
  assert.match(catalog, /aria-haspopup="dialog"/);
  assert.match(catalog, /aria-label=\{`\$\{totalUnits\} unidades`\}/);
  assert.match(catalog, /<WholesaleCartDrawer[\s\S]*onQuantityChange=\{updateQuantity\}[\s\S]*onSubmit=\{\(\) => void submitOrder\(\)\}/);
  assert.match(drawer, /<dialog[\s\S]*aria-labelledby="wholesale-cart-title"/);
  assert.match(drawer, /onQuantityChange\(product\.id, 0\)/);
  assert.match(drawer, /onClick=\{onSubmit\}/);
});

test('catalog failure does not gate independent recovery and history requests', () => {
  const source = fs.readFileSync('components/wholesale/WholesaleCatalog.tsx', 'utf8');
  const catalogEffectStart = source.lastIndexOf('useEffect(() => {', source.indexOf('void fetch("/api/wholesale/catalog"'));
  const catalogEffectEnd = source.indexOf('}, [catalogRetry, router]);', catalogEffectStart);
  const catalogEffect = source.slice(catalogEffectStart, catalogEffectEnd);
  assert.doesNotMatch(catalogEffect, /refreshAttempts|refreshOrders/);
  assert.match(source, /useEffect\(\(\) => \{\s*const controller = new AbortController\(\);\s*void Promise\.resolve\(\)\.then\(\(\) => refreshAttempts\(controller\.signal\)\)/);
  assert.match(source, /useEffect\(\(\) => \{\s*const controller = new AbortController\(\);\s*void Promise\.resolve\(\)\.then\(\(\) => refreshOrders\(controller\.signal\)\)/);
  assert.match(source, /aria-label="Solicitudes recuperables"/);
  assert.match(source, /aria-label="Estado del historial"/);
});

test('history and attempts show separate retryable errors without clearing recovered data or the cart', () => {
  const source = fs.readFileSync('components/wholesale/WholesaleCatalog.tsx', 'utf8');
  const attemptsLoader = source.slice(source.indexOf('const refreshAttempts'), source.indexOf('const refreshOrders'));
  const ordersLoader = source.slice(source.indexOf('const refreshOrders'), source.indexOf('useEffect(() => {'));
  assert.match(attemptsLoader, /setAttempts\(body\.data/);
  assert.match(attemptsLoader, /setAttemptsError\(/);
  assert.doesNotMatch(attemptsLoader, /setAttempts\(\[\]\)|setSelection|persistWholesaleSelection/);
  assert.match(ordersLoader, /setOrders\(body\.data\)/);
  assert.match(ordersLoader, /setOrdersError\(/);
  assert.doesNotMatch(ordersLoader, /setOrders\(\[\]\)|setSelection|persistWholesaleSelection/);
  assert.match(source, /onClick=\{\(\) => void refreshAttempts\(\)\}[^>]*>Reintentar intentos/);
  assert.match(source, /onClick=\{\(\) => void refreshOrders\(\)\}[^>]*>Reintentar historial/);
  assert.match(attemptsLoader, /fetch\("\/api\/wholesale\/orders\/attempts"/);
  assert.match(ordersLoader, /fetch\("\/api\/wholesale\/orders\?limit=25"/);
  assert.doesNotMatch(attemptsLoader + ordersLoader, /start_wholesale_order_attempt|submit_wholesale_order_attempt/);
});

test('late catalog responses rebind the newest local selection instead of replacing it', () => {
  const source = fs.readFileSync('components/wholesale/WholesaleCatalog.tsx', 'utf8');
  assert.match(source, /const selectionVersion = selectionVersionRef\.current/);
  assert.match(source, /selectionVersion === selectionVersionRef\.current\s*\?\s*restoreWholesaleSelectionFromStorage/);
  assert.match(source, /restoreWholesaleSelection\(serializeWholesaleSelection\(selectionRef\.current\), catalog\)/);
  assert.match(source, /selectionVersionRef\.current \+= 1;\s*selectionRef\.current = next/);
  assert.match(source, /requestId !== catalogRequestRef\.current/);
});

test('catalog retry is isolated and recovery failures leave the persisted cart untouched', () => {
  const source = fs.readFileSync('components/wholesale/WholesaleCatalog.tsx', 'utf8');
  assert.match(source, /onClick=\{\(\) => \{ setError\(""\); setLoading\(true\); setCatalogRetry/);
  assert.match(source, /onClick=\{\(\) => void refreshAttempts\(\)\}/);
  assert.match(source, /onClick=\{\(\) => void refreshOrders\(\)\}/);
  const recoveryLoaders = source.slice(source.indexOf('const refreshAttempts'), source.indexOf('useEffect(() => {'));
  assert.doesNotMatch(recoveryLoaders, /persistWholesaleSelection|removeItem|clearSubmittedSelection/);
  assert.match(source, /function saveSelection\(next: WholesaleOrderSelection\)/);
});
