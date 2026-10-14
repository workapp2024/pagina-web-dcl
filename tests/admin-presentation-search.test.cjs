const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
function hooks() {
  const values = []; let index = 0; let effect;
  return { reset: () => { index = 0; }, effect: () => effect?.(), react: {
    useState: initial => { const slot = index++; if (!(slot in values)) values[slot] = typeof initial === 'function' ? initial() : initial; return [values[slot], next => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }]; },
    useEffect: callback => { effect = callback; }, useId: () => 'list-test',
  } };
}
function listHarness(props) {
  const h = hooks();
  const { SearchableList } = load('components/admin/SearchableList.tsx', { react: h.react });
  const render = () => { h.reset(); return SearchableList(props); };
  const button = label => nodes(render()).find(node => node.type === 'button' && text(node) === label);
  const search = value => nodes(render()).find(node => node.type === 'input' && node.props.type === 'search').props.onChange({ target: { value } });
  return { render, button, search };
}

test('lists begin closed, search finds zero-stock products without expansion, and pagination preserves every record', () => {
  const rows = Array.from({ length: 61 }, (_, index) => ({ id: `LED-${index}`, name: index === 60 ? 'Lámpara especial H4' : `Producto ${index}`, stock: index === 60 ? 0 : 2 }));
  const original = JSON.stringify(rows); const shown = [];
  const h = listHarness({ rows, label: 'Productos', placeholder: 'Nombre o código', stock: row => row.stock, searchText: row => [row.id, row.name], children: page => { shown.push(page.map(row => row.id)); return page.map(row => row.id).join(','); } });
  assert.doesNotMatch(text(h.render()), /LED-/); assert.equal(shown.length, 0);
  h.search('lampara H4'); assert.match(text(h.render()), /LED-60/);
  assert.equal(h.button('Ver todos los productos').props['aria-expanded'], false);
  h.search(''); assert.doesNotMatch(text(h.render()), /LED-/);
  h.button('Ver todos los productos').props.onClick(); h.render(); assert.equal(shown.at(-1).length, 25);
  const seen = new Set(shown.at(-1));
  h.button('Siguiente').props.onClick(); h.render(); shown.at(-1).forEach(id => seen.add(id));
  h.button('Siguiente').props.onClick(); h.render(); shown.at(-1).forEach(id => seen.add(id));
  assert.equal(seen.size, 60); assert.equal(seen.has('LED-60'), false);
  nodes(h.render()).find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } });
  h.button('Siguiente').props.onClick(); h.button('Siguiente').props.onClick();
  assert.match(text(h.render()), /LED-60/);
  h.button('Ocultar productos').props.onClick(); assert.doesNotMatch(text(h.render()), /LED-/);
  assert.equal(JSON.stringify(rows), original);
});

test('movement searches and date/type filters keep the original history intact', () => {
  const rows = [{ id: 'receipt-1', type: 'receipt', date: '2026-10-10T12:00:00Z', name: 'H4', reason: 'Reposición' }, { id: 'adjustment-2', type: 'adjustment', date: '2026-10-11T12:00:00Z', name: 'H4', reason: 'Conteo' }];
  const snapshot = JSON.stringify(rows);
  const h = listHarness({ rows, label: 'Movimientos', placeholder: 'Buscar', movement: { date: row => row.date, type: row => row.type, labels: { receipt: 'Entrada', adjustment: 'Ajuste' } }, searchText: row => [row.id, row.date, row.name, row.reason], children: page => page.map(row => row.id).join(',') });
  assert.doesNotMatch(text(h.render()), /receipt-1/);
  h.search('reposicion'); assert.match(text(h.render()), /receipt-1/); assert.doesNotMatch(text(h.render()), /adjustment-2/);
  h.search(''); h.button('Ver movimientos').props.onClick();
  nodes(h.render()).find(node => node.type === 'select').props.onChange({ target: { value: 'adjustment' } });
  assert.match(text(h.render()), /adjustment-2/); assert.doesNotMatch(text(h.render()), /receipt-1/);
  nodes(h.render()).filter(node => node.type === 'input' && node.props.type === 'date')[1].props.onChange({ target: { value: '2026-10-10' } });
  assert.match(text(h.render()), /No se encontraron coincidencias/);
  assert.equal(JSON.stringify(rows), snapshot);
});

test('customer list makes no initial request, searches through the paginated API, and keeps creation and editing available', async () => {
  const h = hooks(); const requests = [];
  const customer = { id: 'customer', full_name: 'Lucía', phone: '1234', email: 'lucia@example.test', document_number: '4321', sales: [], vehicles: [], warranties: [], total: 0 };
  const { CustomersManager } = load('components/admin/CustomersManager.tsx', { react: h.react, '@/components/admin/AdminIdentityProvider': { useIsOwner: () => true } }, {
    URLSearchParams,
    setTimeout: callback => setTimeout(callback, 0), fetch: async (url, init) => { requests.push({ url, init }); return Response.json({ ok: true, data: [customer], pagination: { total: 21 } }); },
  });
  const render = () => { h.reset(); return CustomersManager(); };
  const button = label => nodes(render()).find(node => node.type === 'button' && text(node) === label);
  render(); h.effect(); await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(requests.length, 0); assert.ok(button('Crear cliente')); assert.ok(button('Ver todos los clientes'));
  nodes(render()).find(node => node.type === 'input' && node.props.type === 'search').props.onChange({ target: { value: '4321' } });
  render(); const cleanup = h.effect(); await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(new URL('https://test.invalid' + requests[0].url).searchParams.get('q'), '4321');
  assert.equal(button('Ver todos los clientes').props['aria-expanded'], false);
  assert.match(text(render()), /Lucía/); assert.ok(button('Siguiente'));
  nodes(render()).find(node => node.type === 'button' && text(node).startsWith('Lucía')).props.onClick();
  assert.ok(button('Editar')); button('Editar').props.onClick(); assert.ok(button('Guardar'));
  assert.ok(requests.every(request => !request.init?.method)); cleanup();
});

test('navigation retains desktop groups and mobile sector shortcuts with existing role restrictions', () => {
  const React = require('react'); const { renderToStaticMarkup } = require('react-dom/server');
  const permissions = load('lib/admin-permissions.ts');
  for (const role of ['ADMIN', 'VENDEDOR']) {
    const { AdminSidebar } = load('components/admin/AdminSidebar.tsx', {
      react: { useState: initial => [initial, () => {}], useEffect: () => {}, useCallback: callback => callback, useRef: () => ({ current: null }) },
      'next/link': ({ children, ...props }) => React.createElement('a', props, children),
      'next/navigation': { usePathname: () => '/admin/minoristas/pedidos', useRouter: () => ({}) },
      '@/components/admin/AdminIdentityProvider': { useAdminIdentity: () => ({ role, name: 'DCL' }) },
      '@/lib/admin-permissions': permissions,
    });
    const html = renderToStaticMarkup(React.createElement(AdminSidebar));
    assert.match(html, /hidden w-72[^\"]*lg:block/);
    assert.match(html, /aria-label="Accesos rápidos administrativos"[^>]*lg:hidden/);
    for (const route of ['/admin/minoristas', '/admin/minoristas/pedidos', '/admin/minoristas/clientes']) assert.ok(html.includes(`href="${route}"`));
    assert.match(html, /aria-haspopup="dialog" aria-expanded="false"/);
    assert.match(html, /href="\/admin\/minoristas\/pedidos"[^>]*aria-current="page"/);
    if (role === 'VENDEDOR') assert.doesNotMatch(html, />Mayoristas</);
  }
});

test('compatibility search covers middle years, combined high/low connectors and existing vehicle fields while keeping the form available', () => {
  const row = { id: 'vehicle', vehicleType: 'Camioneta', brandName: 'Toyota', modelName: 'Hilux', yearFrom: 2016, yearTo: 2023, connectorLow: 'H4', connectorHigh: null, combinedHighLow: true, connectorFog: 'H11', connectorAux: 'W5W', notes: 'Versión SRV', active: true };
  const List = () => null; let index = 0;
  const { AdminCompatibilityManager } = load('components/admin/CompatibilityManager.tsx', {
    react: { useEffect: () => {}, useState: initial => [index++ === 0 ? [row] : initial, () => {}] },
    '@/components/admin/SearchableList': { SearchableList: List },
    '@/lib/supabase/vehicle-compatibility': { VEHICLE_TYPES: ['Camioneta'] },
  });
  const tree = AdminCompatibilityManager();
  const list = nodes(tree).find(node => node.type === List);
  const { matchesAdminSearch } = load('components/admin/SearchableList.tsx');
  for (const query of ['Toyota Hilux', '2019', 'alta H4', 'baja H4', 'antiniebla H11', 'posición W5W', 'SRV']) assert.ok(matchesAdminSearch(query, list.props.searchText(row)), query);
  assert.ok(nodes(tree).some(node => node.type === 'button' && text(node) === 'Guardar compatibilidad'));
  assert.equal(list.props.rows[0], row);
});
