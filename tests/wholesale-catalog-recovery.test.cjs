/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');
const selectionTools = load('lib/wholesale-order-selection.ts');

function createHarness(fetchImpl, storage = new Map()) {
  const slots = [];
  const effects = [];
  let cursor = 0;
  let tree;
  const sameDeps = (left, right) => left && right && left.length === right.length && left.every((value, index) => value === right[index]);
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo(factory, deps) {
      const index = cursor++;
      const prior = slots[index];
      if (!prior || !sameDeps(prior.deps, deps)) slots[index] = { deps, value: factory() };
      return slots[index].value;
    },
    useCallback(callback, deps) {
      const index = cursor++;
      const prior = slots[index];
      if (!prior || !sameDeps(prior.deps, deps)) slots[index] = { deps, value: callback };
      return slots[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const prior = effects[index];
      if (!prior || !sameDeps(prior.deps, deps)) effects[index] = { effect, deps, changed: true, cleanup: prior?.cleanup };
      else effects[index] = { ...prior, changed: false };
    },
  };
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  const listeners = new Map();
  const router = { replace() {}, refresh() {} };
  const window = {
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name),
  };
  const mocks = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: Symbol('Fragment') },
    'next/navigation': { useRouter: () => router },
    '@/components/public/VehicleFinder': { VehicleFinder: () => null },
    '@/components/wholesale/WholesaleCartDrawer': { WholesaleCartDrawer: 'cart-drawer' },
    '@/components/wholesale/WholesaleProductDetails': { WholesaleProductDetails: 'product-details' },
    '@/components/wholesale/WholesaleProductCard': { WholesaleProductCard: props => jsx('product-card', props) },
    '@/lib/wholesale-catalog-search': {
      uniqueWholesaleCatalogProducts: rows => rows,
      getWholesaleCatalogView: () => ({ active: false, products: [] }),
      filterWholesaleCatalogProducts: () => [],
      findWholesaleVehicleMatches: () => [],
      productFromWholesaleItem: item => item,
    },
    '@/lib/supabase/vehicle-compatibility': { getPublicVehicleTypes: async () => [], searchPublicVehicleCompatibilities: async () => [] },
    '@/lib/wholesale-order-selection': selectionTools,
  };
  const { WholesaleCatalog } = load('components/wholesale/WholesaleCatalog.tsx', mocks, { fetch: fetchImpl, window, Error });

  async function render() {
    cursor = 0;
    tree = WholesaleCatalog();
    for (const entry of effects) {
      if (!entry?.changed) continue;
      entry.cleanup?.();
      entry.cleanup = entry.effect();
      entry.changed = false;
    }
    await Promise.resolve();
    return tree;
  }
  return { render, get tree() { return tree; }, get slots() { return slots; } };
}

const response = (body, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const product = id => ({ id, name: `Producto ${id}`, description: '', imageUrl: '', category: 'LED', connectorType: 'H7', functions: [], vehicleTypes: [], wholesalePrice: 10 });
function findNode(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  const children = node.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}
function textContent(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || typeof node !== 'object') return '';
  const children = node.props?.children;
  return (Array.isArray(children) ? children : [children]).map(textContent).join(' ');
}
async function settle(harness) {
  await new Promise(resolve => setTimeout(resolve, 0));
  await harness.render();
}

test('catalog failure still displays recovered attempts and order history', async () => {
  const calls = [];
  const harness = createHarness(async url => {
    calls.push(url);
    if (url === '/api/wholesale/catalog') throw new Error('catalog offline');
    if (url === '/api/wholesale/orders/attempts') return response({ ok: true, data: [{ attemptId: 'attempt-1', status: 'open', createdAt: '', items: [{ productId: 'p1', quantity: 2 }], order: null }] });
    return response({ ok: true, data: [{ id: 'order-1', order_number: 'MW-000001', status: 'received', created_at: '', confirmed_at: null, total_amount: 20, currency: 'ARS', items: [{ productId: 'p1', name: 'Producto p1', quantity: 2, unitPrice: 10, lineTotal: 20, currency: 'ARS' }] }] });
  });
  await harness.render();
  await settle(harness);
  assert.ok(calls.includes('/api/wholesale/orders/attempts'), JSON.stringify(calls));
  assert.equal(harness.slots[14].length, 1, JSON.stringify(harness.slots[14]));
  assert.equal(harness.slots[14][0].status, 'open');
  assert.ok(JSON.stringify(harness.tree).includes('attempt-1'));
  const text = textContent(harness.tree);
  assert.match(text, /catalog offline/);
  assert.match(text, /MW-000001/);
  assert.ok(calls.includes('/api/wholesale/orders/attempts'));
  assert.ok(calls.includes('/api/wholesale/orders?limit=25'));
});

test('history failure leaves catalog usable and offers an isolated history retry', async () => {
  const calls = [];
  const harness = createHarness(async url => {
    calls.push(url);
    if (url === '/api/wholesale/catalog') return response({ ok: true, data: [product('p1')] });
    if (url === '/api/wholesale/orders/attempts') return response({ ok: true, data: [] });
    return response({ ok: false, error: 'history unavailable' }, 503);
  });
  await harness.render();
  await settle(harness);
  const retry = findNode(harness.tree, node => node.type === 'button' && node.props.children === 'Reintentar historial');
  assert.ok(retry);
  assert.match(textContent(harness.tree), /history unavailable/);
  assert.match(textContent(harness.tree), /Buscá por producto/);
  const catalogCalls = calls.filter(url => url === '/api/wholesale/catalog').length;
  await retry.props.onClick();
  await settle(harness);
  assert.equal(calls.filter(url => url === '/api/wholesale/catalog').length, catalogCalls);
  assert.equal(calls.filter(url => url === '/api/wholesale/orders/attempts').length, 1);
  assert.equal(calls.filter(url => url === '/api/wholesale/orders?limit=25').length, 2);
  assert.ok(calls.every(url => !String(url).includes('submit')));
});

test('a delayed catalog response uses the latest persisted selection and recovery errors do not erase it', async () => {
  const values = new Map();
  const firstSelection = { p1: { product: product('p1'), quantity: 2 } };
  const latestSelection = { p2: { product: product('p2'), quantity: 4 } };
  selectionTools.persistWholesaleSelection({ setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }, firstSelection);
  let resolveCatalog;
  const harness = createHarness(url => {
    if (url === '/api/wholesale/catalog') return new Promise(resolve => { resolveCatalog = resolve; });
    if (url === '/api/wholesale/orders/attempts') return Promise.reject(new Error('attempt recovery failed'));
    return Promise.reject(new Error('history recovery failed'));
  }, values);
  await harness.render();
  await Promise.resolve();
  selectionTools.persistWholesaleSelection({ setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }, latestSelection);
  resolveCatalog(response({ ok: true, data: [product('p1'), product('p2')] }));
  await settle(harness);
  const drawer = findNode(harness.tree, node => node.type === 'cart-drawer');
  assert.equal(drawer.props.selection.p1, undefined);
  assert.equal(drawer.props.selection.p2.quantity, 4);
  assert.match(textContent(harness.tree), /attempt recovery failed/);
  assert.match(textContent(harness.tree), /history recovery failed/);
});
