const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');
const fs = require('node:fs');

function harness(file, name, extra = {}) {
  const states = []; let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const component = load(file, {
    react: { useState: initial => { const index = cursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; }, useId: () => 'test-id', useRef: value => ({ current: value }), useEffect() {}, useCallback: fn => fn, useMemo: fn => fn() },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/admin/AdminIdentityProvider': { useIsOwner: () => true },
    ...extra,
  });
  const render = props => { cursor = 0; return component[name](props); };
  render.states = states;
  return render;
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (!tree || typeof tree !== 'object') return String(tree ?? '');
  return text(tree.props?.children);
}

test('retail list starts hidden and can be opened, hidden and searched without wholesale actions', () => {
  const render = harness('components/admin/OrdersManager.tsx', 'OrdersManager');
  let tree = render();
  assert.match(text(tree), /Pedidos minoristas/);
  assert.equal(nodes(tree).some(node => node.props?.['aria-label'] === 'Paginación'), false);
  nodes(tree).find(node => node.type === 'button' && text(node) === 'Ver pedidos').props.onClick();
  tree = render();
  assert.ok(nodes(tree).some(node => node.props?.['aria-label'] === 'Paginación'));
  nodes(tree).find(node => node.type === 'button' && text(node) === 'Ocultar pedidos').props.onClick();
  tree = render();
  nodes(tree).find(node => node.type === 'input').props.onChange({ target: { value: 'DCL-000001' } });
  assert.ok(nodes(render()).some(node => node.props?.['aria-label'] === 'Paginación'));
  const retail = fs.readFileSync('components/admin/OrdersManager.tsx', 'utf8');
  const wholesale = fs.readFileSync('components/admin/WholesaleOrdersManager.tsx', 'utf8');
  for (const section of ['Resumen', 'Seguimiento', 'Cobros y entregas', 'Historial']) { assert.ok(retail.includes(section)); assert.ok(wholesale.includes(section)); }
  assert.doesNotMatch(retail, /\/api\/admin\/wholesale|record_wholesale|reserve_wholesale/);
  assert.match(retail, /\/api\/admin\/orders/);
});

test('approved wholesale panel retains its own title and the same hidden-list navigation', () => {
  const render = harness('components/admin/WholesaleOrdersManager.tsx', 'WholesaleOrdersManager', {
    '@/components/wholesale/useWholesaleOrderVisibility': { useWholesaleOrderVisibility: () => ({ ids: [], available: false, error: '' }) },
  });
  let tree = render({ products: [] });
  assert.match(text(tree), /Pedidos mayoristas/);
  assert.equal(nodes(tree).some(node => node.props?.['aria-label'] === 'Solicitudes'), false);
  nodes(tree).find(node => node.type === 'button' && text(node) === 'Ver pedidos').props.onClick();
  tree = render({ products: [] });
  assert.match(text(tree), /Cargando solicitudes/);
  nodes(tree).find(node => node.type === 'button' && text(node) === 'Ocultar pedidos').props.onClick();
  assert.doesNotMatch(text(render({ products: [] })), /Cargando solicitudes/);
});

test('inventory search requires explicit selection and clears stale selection while typing', () => {
  const changes = [];
  const render = harness('components/admin/InventoryProductSearch.tsx', 'InventoryProductSearch');
  const products = [{ id: 'A', name: 'DAKAR', stock: 3, connectorType: 'H7' }, { id: 'B', name: 'DAKAR', stock: 0, connectorType: 'H4' }];
  let props = { products, value: '', onChange: id => changes.push(id) };
  let tree = render(props);
  nodes(tree).find(node => node.type === 'input').props.onChange({ target: { value: 'H7' } });
  tree = render(props);
  const buttons = nodes(tree).filter(node => node.type === 'button');
  assert.equal(buttons.length, 1);
  assert.match(text(buttons[0]), /Código: A.*Stock del sector: 3/);
  buttons[0].props.onClick();
  assert.deepEqual(changes, ['', 'A']);
  props = { ...props, value: 'A' }; tree = render(props);
  nodes(tree).find(node => node.type === 'input').props.onChange({ target: { value: 'DAKAR' } });
  assert.equal(changes.at(-1), '');
});

test('retail detail navigates inline through the four sections and returns to the list', () => {
  const render = harness('components/admin/OrdersManager.tsx', 'OrdersManager');
  render();
  render.states[0] = [{ id: 'retail', order_number: 'DCL-000001', total: 100, created_at: '2026-10-17T12:00:00Z', payment_method: 'transfer', fulfillment_method: 'pickup', customer: { full_name: 'Cliente minorista' }, items: [], internalNotes: [], operationalHistory: [], resolutions: [], status: 'pending_payment', operational_status: 'received', payment: null, archive_block_reason: 'pending_payment' }];
  let tree = render();
  nodes(tree).find(node => node.type === 'button' && text(node) === 'Ver pedidos').props.onClick();
  tree = render();
  nodes(tree).find(node => node.type === 'button' && text(node).includes('DCL-000001')).props.onClick();
  for (const label of ['Resumen', 'Seguimiento', 'Cobros y entregas', 'Historial']) {
    tree = render();
    const nav = nodes(tree).find(node => node.props?.['aria-label'] === 'Secciones del pedido');
    nodes(nav).find(node => node.type === 'button' && text(node) === label).props.onClick();
    tree = render();
    assert.ok(nodes(tree).some(node => node.type === 'button' && text(node) === label && node.props['aria-pressed']));
    assert.equal(nodes(tree).some(node => node.props?.['aria-modal']), false);
  }
  nodes(tree).find(node => node.type === 'button' && text(node).includes('Volver a pedidos')).props.onClick();
  assert.ok(nodes(render()).some(node => node.props?.['aria-label'] === 'Paginación'));
});

test('sector customer filters run before pagination and wholesale creation uses one atomic RPC', async () => {
  const calls = [];
  const query = {};
  for (const method of ['select', 'order', 'range', 'is', 'not', 'or', 'eq', 'in']) query[method] = (...args) => { calls.push([method, ...args]); return query; };
  query.then = resolve => Promise.resolve({ data: [], count: 0, error: null }).then(resolve);
  const route = load('app/api/admin/customers/route.ts', {
    '@/lib/admin-auth': { isAdminAuthenticated: async () => true },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => ({ from: () => query, rpc: async (name) => { calls.push(['rpc', name]); return { data: null, error: { code: 'PGRST202', message: 'missing' } }; } }) },
  });
  assert.equal((await route.GET(new Request('https://test.invalid?sector=wholesale'))).status, 200);
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'wholesale_enabled' && call[2] === true));
  calls.length = 0;
  assert.equal((await route.GET(new Request('https://test.invalid?sector=retail'))).status, 200);
  assert.ok(calls.some(call => call[0] === 'or' && call[1].includes('retail_orders.not.is.null')));
  const response = await route.POST(new Request('https://test.invalid', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'create', sector: 'wholesale', fullName: 'Test' }) }));
  assert.equal(response.status, 503);
  assert.deepEqual(calls.filter(call => call[0] === 'rpc'), [['rpc', 'admin_create_wholesale_customer']]);
});
