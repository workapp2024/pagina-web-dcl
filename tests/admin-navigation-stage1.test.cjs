const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');

const attention = load('lib/admin-order-attention.ts');
const paid = { status: 'completed', operational_status: 'received', payment: { status: 'approved', sale_id: 'sale', sale_status: 'completed' } };

test('attention separates unpaid waiting, financial incidents, pickup/delivery and terminal orders', () => {
  assert.equal(attention.retailNeedsAttention({ ...paid, status: 'pending_payment', payment: null }), false);
  for (const status of ['pending_manual_verification', 'stock_unavailable', 'refund_required']) assert.equal(attention.retailNeedsAttention({ ...paid, status }), true);
  assert.equal(attention.retailNeedsAttention(paid), true);
  assert.equal(attention.retailNeedsAttention({ ...paid, operational_status: 'delivered' }), false);
  assert.match(attention.retailNextAction({ ...paid, status: 'refund_required' }), /reembolso externo/);
  assert.equal(attention.wholesaleNeedsAttention('awaiting_customer'), false);
  assert.equal(attention.wholesaleNeedsAttention('in_review'), true);
  assert.equal(attention.wholesaleNeedsAttention('confirmed', true), true);
  assert.equal(attention.wholesaleNeedsAttention('confirmed', false), false);
  assert.equal(attention.wholesaleNeedsAttention('cancelled'), false);
  assert.match(attention.wholesaleAdminLabel('in_review', 'approved'), /Propuesta aceptada.*confirmación DCL/);
  assert.match(attention.wholesaleNextAction('in_review', 'approved'), /Confirmar en DCL/);
});

test('retail attention pagination includes incidents beyond the first database page', async () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({ ...paid, id: String(index), operational_status: 'delivered', order_number: `DCL-${index}` }));
  rows[99] = { ...rows[99], status: 'refund_required' };
  rows[100] = { ...rows[100], operational_status: 'ready' };
  const calls = [];
  const db = { rpc: async (name, args) => {
    calls.push({ name, args });
    return { error: null, data: { data: rows.slice((args.p_page - 1) * args.p_limit, args.p_page * args.p_limit), pagination: { total: rows.length, page: args.p_page, limit: args.p_limit } } };
  }, from: () => {
    const query = { select: () => query, in: () => query, order: () => query, then: resolve => Promise.resolve({ data: [], error: null }).then(resolve) };
    return query;
  } };
  const { GET } = load('app/api/admin/orders/route.ts', {
    '@/lib/admin-auth': { isAdminAuthenticated: async () => true },
    '@/lib/supabase/server': { isServiceRoleConfigured: () => true, createAdminServerClient: () => db },
    '@/lib/store/order-receipt': { getOrderReceiptAvailability: async () => ({}) },
  });
  const response = await GET(new Request('https://test.invalid?status=needs_attention&period=all&limit=1&page=2'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.pagination.total, 2);
  assert.equal(body.data[0].id, '100');
  assert.ok(calls.some(call => call.args.p_page === 2 && call.args.p_limit === 100));
  assert.ok(calls.every(call => call.name === 'list_admin_operational_orders'));
});

function uiHarness(file, extra = {}) {
  const states = []; let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const component = load(file, {
    react: { useState: initial => { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
  }, extra);
  return { render: props => { cursor = 0; return component.WholesaleConfirmation(props); } };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  const children = tree.props?.children;
  return [tree, ...(Array.isArray(children) ? children.flatMap(nodes) : nodes(children))];
}
function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree) return '';
  if (Array.isArray(tree)) return tree.map(text).join('');
  return text(tree.props?.children);
}

async function sectorPendingView(sector, orders, role = "ADMIN", wholesaleFailure = false, requests = []) {
  const states=[]; let cursor=0; let effect;
  const jsx=(type,props)=>({type,props});
  const {SectorHome}=load('components/admin/SectorHome.tsx',{
    react:{useEffect:callback=>{effect=callback;},useState:initial=>{const index=cursor++;if(!(index in states))states[index]=initial;return [states[index],value=>{states[index]=typeof value === "function" ? value(states[index]) : value;}];}},
    'react/jsx-runtime':{jsx,jsxs:jsx},'next/link':'a',
    '@/components/admin/AdminIdentityProvider':{useAdminIdentity:()=>({role})},
  },{fetch:async url=>{
    requests.push(url);
    const params=new URL('https://local.test'+url).searchParams;
    if(url.includes('/api/admin/wholesale-orders')) {
      assert.equal(role, 'ADMIN');
      if (wholesaleFailure) return Response.json({ message: 'Consulta mayorista no disponible' }, { status: 503 });
      assert.match(url,/\/api\/admin\/wholesale-orders/);
      assert.equal(params.get('includeDeliveryPending'),'true');
      const start = (Number(params.get('page')) - 1) * 25;
      return Response.json({ data: orders.slice(start, start + 25), pagination: { total: orders.length } });
      assert.equal(params.get('archived'),'false');
    } else {
      assert.notEqual(sector, 'mayoristas');
      assert.match(url,/\/api\/admin\/orders\?/);
      assert.equal(params.get('view'),'active');
    }
    return Response.json({data:orders,pagination:{total:orders.length}});
  }});
  const render=()=>{cursor=0;return SectorHome({sector});};
  render();const cleanup=effect();
  await new Promise(resolve=>setTimeout(resolve,30));
  const tree=render();cleanup();return tree;
}

test('wholesale home respects administrative archive and never falls back to historical activity',async()=>{
  const rows=['cancelled','rejected','awaiting_customer'].map((status,index)=>({id:status,orderNumber:`MW-${index}`,status,customerName:'Cliente'}));
  rows.push({id:'delivered',orderNumber:'MW-DELIVERED',status:'confirmed',deliveryPending:false,customerName:'Cliente'});
  const tree=await sectorPendingView('mayoristas',rows);
  assert.match(text(tree),/Todo al día. No tenés pedidos pendientes/);
  assert.doesNotMatch(text(tree),/MW-|Actividad reciente|Próxima acción/);
  assert.ok(nodes(tree).some(node=>node.props?.href==='/admin/mayoristas/pedidos'));
});

test('retail home keeps genuine pending actions and omits delivered or settled terminal orders',async()=>{
  const rows=[
    {id:'pending',order_number:'MIN-PENDING',status:'pending_manual_verification',operational_status:'received',payment:null,customer:{full_name:'Cliente pendiente'}},
    {...paid,id:'done',order_number:'MIN-DONE',operational_status:'delivered'},
    {id:'cancelled',order_number:'MIN-CANCELLED',status:'cancelled',operational_status:'cancelled',payment:null},
  ];
  const tree=await sectorPendingView('minoristas',rows);
  assert.match(text(tree),/MIN-PENDING.*Cliente pendiente.*Transferencia a verificar.*Verificar la transferencia recibida/);
  assert.doesNotMatch(text(tree),/MIN-DONE|MIN-CANCELLED|Actividad reciente/);
  const empty=await sectorPendingView('minoristas',rows.slice(1));
  assert.match(text(empty),/Todo al día. No tenés pedidos pendientes/);
  assert.ok(nodes(empty).some(node=>node.props?.href==='/admin/minoristas/pedidos'));
});

test('guided confirmation blocks unknown/insufficient stock and requires review; performs only a GET precheck', async () => {
  let available = 1; let confirmed = 0; const requests = [];
  const ui = uiHarness('components/admin/WholesaleConfirmation.tsx', { fetch: async (url, init) => {
    requests.push({ url, init }); return Response.json({ data: { products: [{ productId: 'p', available, reserved: 1, onHand: available + 1 }] } });
  } });
  const props = { items: [{ productId: 'p', name: 'LED', quantity: 2 }], conditions: 'Condiciones acordadas', approved: true, busy: false, confirm: () => confirmed++ };
  const button = label => nodes(ui.render(props)).find(node => node.type === 'button' && text(node) === label);
  assert.equal(button('Confirmar pedido').props.disabled, true);
  button('Comprobar disponibilidad').props.onClick(); await new Promise(resolve => setImmediate(resolve));
  assert.match(text(ui.render(props)), /Stock insuficiente/);
  assert.equal(button('Confirmar pedido').props.disabled, true);
  available = 2;
  button('Comprobar disponibilidad').props.onClick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(button('Confirmar pedido').props.disabled, true);
  nodes(ui.render(props)).find(node => node.type === 'input').props.onChange({ target: { checked: true } });
  assert.equal(button('Confirmar pedido').props.disabled, false);
  button('Confirmar pedido').props.onClick();
  assert.equal(confirmed, 1);
  assert.ok(requests.every(request => request.url === '/api/admin/wholesale-inventory' && !request.init.method));
  assert.equal(nodes(ui.render({ ...props, busy: true })).find(node => node.type === 'button' && text(node) === 'Confirmando…').props.disabled, true);
});

test('new wholesale sector rejects sellers before rendering existing managers', async () => {
  for (const route of ['app/admin/mayoristas/page.tsx', 'app/admin/mayoristas/clientes/page.tsx', 'app/admin/mayoristas/pedidos/page.tsx', 'app/admin/mayoristas/finanzas/page.tsx']) {
    const jsx = () => { throw new Error('Must not render for seller'); };
    const page = load(route, {
      '@/lib/admin-auth': { getAdminIdentity: async () => ({ role: 'VENDEDOR' }), isAdminAuthenticated: async () => true },
      'next/navigation': { redirect: path => { throw new Error(`redirect:${path}`); } },
      'react/jsx-runtime': { jsx, jsxs: jsx },
      '@/components/admin/SectorHome': {},
      '@/app/admin/clientes/page': {}, '@/app/admin/pedidos-mayoristas/page': {}, '@/app/admin/finanzas/page': {},
    });
    await assert.rejects(page.default(), /redirect:\/admin$/);
  }
});

test('sector home reads all pages, distinguishes full delivery and never marks a failed read Todo al día', async () => {
  let fail = false;
  async function renderHome() {
    const states = []; let cursor = 0; let effect;
    const jsx = (type, props) => ({ type, props });
    const { SectorHome } = load('components/admin/SectorHome.tsx', {
      react: { useEffect: callback => { effect = callback; }, useState: initial => { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; } },
      'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/link': 'a',
      '@/components/admin/AdminIdentityProvider': { useAdminIdentity: () => ({ role: 'ADMIN' }) },
    }, { AbortController, setTimeout, clearTimeout, URLSearchParams, fetch: async url => {
      if (url.includes('/api/admin/orders')) throw new Error('Other sector must not be loaded');
      assert.match(url, /wholesale-orders\?/);
      const page = Number(new URL('https://test.invalid' + url).searchParams.get('page'));
      if (page === 2 && fail) return Response.json({ message: 'Consulta incompleta' }, { status: 500 });
      const order = page === 1 ? { id: 'accepted', orderNumber: 'MW-000001', status: 'in_review', revisionStatus: 'approved' } : { id: 'delivered', orderNumber: 'MW-000002', status: 'confirmed', deliveryPending: false };
      return Response.json({ data: [{ ...order, customerName: 'Cliente', createdAt: '2026-10-01T12:00:00Z' }], pagination: { total: 2 } });
    } });
    const render = () => { cursor = 0; return SectorHome({ sector: 'mayoristas' }); };
    render(); const cleanup = effect();
    await new Promise(resolve => setTimeout(resolve, 30));
    const result = text(render()); cleanup(); return result;
  }
  const successful = await renderHome();
  assert.match(successful, /Requieren atención · 1/);
  assert.match(successful, /Propuesta aceptada.*confirmación DCL/);
  assert.doesNotMatch(successful, /MW-000002/);
  fail = true;
  const failed = await renderHome();
  assert.match(failed, /Consulta incompleta/);
  assert.doesNotMatch(failed, /Todo al día/);
});

test('general home exposes only the seller channel and opens the exact retail record', async () => {
  const order = { id: 'retail', order_number: 'DCL-123456', status: 'pending_manual_verification', operational_status: 'received', payment: null };
  const tree = await sectorPendingView(undefined, [order], 'VENDEDOR');
  assert.match(text(tree), /Pendientes de trabajo.*requiere revisión de Administración/);
  assert.doesNotMatch(text(tree), /Mayoristas|Editar página de inicio/);
  assert.ok(nodes(tree).some(node => node.props?.href === '/admin/minoristas/pedidos?order=DCL-123456'));
});

test('general home preserves retail results when the wholesale source fails', async () => {
  const order = { ...paid, id: 'retail', order_number: 'DCL-123456' };
  const tree = await sectorPendingView(undefined, [order], 'ADMIN', true);
  assert.match(text(tree), /DCL-123456.*Consulta mayorista no disponible/);
  assert.doesNotMatch(text(tree), /Todo al día/);
});

test('navigation allows the existing retail aliases and excludes admin-only destinations for sellers', () => {
  const { canShowAdminLink } = load('components/admin/AdminSidebar.tsx', {
    '@/components/admin/AdminIdentityProvider': {},
  });
  for (const path of ['/admin', '/admin/minoristas/pedidos', '/admin/minoristas/clientes', '/admin/productos']) {
    assert.equal(canShowAdminLink('VENDEDOR', path), true, path);
  }
  for (const path of ['/admin/mayoristas', '/admin/mayoristas/clientes', '/admin/minoristas/finanzas', '/admin/home', '/admin/analitica']) {
    assert.equal(canShowAdminLink('VENDEDOR', path), false, path);
    assert.equal(canShowAdminLink('ADMIN', path), true, path);
  }
});

test('100 confirmed wholesale orders require four list requests and no detail requests', async () => {
  const orders = Array.from({ length: 100 }, (_, i) => ({
    id: String(i), orderNumber: 'MW-' + (1000 + i), status: 'confirmed', deliveryPending: i === 99,
  }));
  const requests = [];
  const tree = await sectorPendingView('mayoristas', orders, 'ADMIN', false, requests);
  assert.equal(requests.length, 4);
  assert.ok(requests.every(url => url.startsWith('/api/admin/wholesale-orders?')));
  assert.match(text(tree), /Requieren atención · 1.*MW-1099/);
  assert.doesNotMatch(text(tree), /MW-1000/);
});

test('wholesale list computes the same delivery pending by order and current revision with read-only batches', async () => {
  const orders = ['partial', 'complete', 'missing', 'notice'].map(id => ({
    id, status: 'confirmed', current_revision_id: 'rev-' + id, order_number: 'MW-' + id, customer_id: 'customer',
  }));
  const tables = {
    wholesale_orders: orders,
    customers: [{ id: 'customer', full_name: 'Cliente' }],
    wholesale_order_revisions: orders.map(order => ({ id: order.current_revision_id, total_amount: 100, currency: 'ARS' })),
    wholesale_order_revision_items: [
      { revision_id: 'rev-partial', product_id: 'led', quantity: 4 },
      { revision_id: 'rev-complete', product_id: 'led', quantity: 4 },
      { revision_id: 'rev-complete', product_id: 'other', quantity: 2 },
    ],
    wholesale_delivery_items: [
      ...Array.from({ length: 2 }, () => ({ wholesale_deliveries: { order_id: 'complete' }, product_id: 'led', quantity: 2 })),
      { wholesale_deliveries: { order_id: 'complete' }, product_id: 'other', quantity: 2 },
      { wholesale_deliveries: { order_id: 'partial' }, product_id: 'led', quantity: 3 },
    ],
  };
  const reads = [];
  let role = 'ADMIN';
  const { GET } = load('app/api/admin/wholesale-orders/route.ts', {
    '@/lib/admin-auth': { getAdminIdentity: async () => ({ role, id: 'actor' }) },
    '@/lib/wholesale-order-visibility-server': { readWholesaleVisibility: async () => ({ available: true, ids: [] }) },
    '@/lib/wholesale-payment-notices': { readTransferNotices: async () => [{ order_id: 'notice', status: 'pending' }] },
    '@/lib/supabase/server': {
      isServiceRoleConfigured: () => true,
      createAdminServerClient: () => ({ from(table) {
        let rows = tables[table];
        reads.push(table);
        const result = () => ({ data: rows, count: rows.length, error: null });
        const q = {
          select: () => q, order: () => q,
          in(key, ids) {
            rows = rows.filter(row => ids.includes(key.split('.').reduce((obj, part) => obj[part], row)));
            return q;
          },
          range: async (start, end) => ({ ...result(), data: rows.slice(start, end + 1) }),
          then: resolve => Promise.resolve(result()).then(resolve),
        };
        return q;
      } }),
    },
  });
  const request = new Request('https://test.invalid?archived=false&includeDeliveryPending=true');
  role = 'VENDEDOR';
  assert.equal((await GET(request)).status, 401);
  assert.deepEqual(reads, []);
  role = 'ADMIN';
  const response = await GET(request);
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.deepEqual(data.map(row => [row.id, row.deliveryPending, row.transferNoticePending]), [
    ['partial', true, false], ['complete', false, false], ['missing', true, false], ['notice', undefined, true],
  ]);
  assert.equal(reads.filter(table => table === 'wholesale_order_revision_items').length, 1);
  assert.equal(reads.filter(table => table === 'wholesale_delivery_items').length, 1);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const ordinary = await GET(new Request('https://test.invalid'));
  assert.ok((await ordinary.json()).data.every(row => !Object.hasOwn(row, 'deliveryPending')));
  assert.equal(reads.filter(table => table === 'wholesale_delivery_items').length, 1);
});
