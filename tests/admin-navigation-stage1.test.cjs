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

async function sectorPendingView(sector, orders) {
  const states=[]; let cursor=0; let effect;
  const jsx=(type,props)=>({type,props});
  const {SectorHome}=load('components/admin/SectorHome.tsx',{
    react:{useEffect:callback=>{effect=callback;},useState:initial=>{const index=cursor++;if(!(index in states))states[index]=initial;return [states[index],value=>{states[index]=value;}];}},
    'react/jsx-runtime':{jsx,jsxs:jsx},'next/link':'a',
    '@/components/admin/AdminIdentityProvider':{useAdminIdentity:()=>({role:'ADMIN'})},
  },{fetch:async url=>{
    const params=new URL('https://local.test'+url).searchParams;
    if(sector==='mayoristas') {
      assert.match(url,/\/api\/admin\/wholesale-orders/);
      if(url.endsWith('/delivered')) return Response.json({data:{deliveryProgress:[{ordered:1,delivered:1}]}});
      assert.equal(params.get('archived'),'false');
    } else {
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
  rows.push({id:'delivered',orderNumber:'MW-DELIVERED',status:'confirmed',customerName:'Cliente'});
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
      if (url.includes('/wholesale-orders/delivered')) return fail ? Response.json({ message: 'Consulta incompleta' }, { status: 500 }) : Response.json({ data: { deliveryProgress: [{ ordered: 2, delivered: 2 }] } });
      const page = Number(new URL('https://test.invalid' + url).searchParams.get('page'));
      const order = page === 1 ? { id: 'accepted', orderNumber: 'MW-000001', status: 'in_review', revisionStatus: 'approved' } : { id: 'delivered', orderNumber: 'MW-000002', status: 'confirmed' };
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
