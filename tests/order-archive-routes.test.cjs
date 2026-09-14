/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const load = require('./load-ts.cjs');
const id = randomUUID();
const plain = value => JSON.parse(JSON.stringify(value));
const request = body => new Request('https://test.invalid', { method:'POST', body:JSON.stringify(body) });
function harness(auth = true, reason = null) {
  const calls = [];
  const db = { rpc:async (name,args) => { calls.push({ name,args:plain(args) }); return { data:args.p_archive, error:reason ? { message:reason } : null }; } };
  const mocks = { '@/lib/admin-auth':{ isAdminAuthenticated:async()=>auth }, '@/lib/supabase/server':{ isServiceRoleConfigured:()=>true, createAdminServerClient:()=>db } };
  return { calls,mocks,...load('app/api/admin/orders/archive/route.ts',mocks) };
}
test('archive API authenticates, validates booleans and only invokes the archive RPC', async () => {
  const denied = harness(false); assert.equal((await denied.POST(request({orderId:id,archive:true}))).status,401); assert.equal(denied.calls.length,0);
  for (const body of [{orderId:'x',archive:true},{orderId:id,archive:'false'},{orderId:id}]) {
    const h = harness(); assert.equal((await h.POST(request(body))).status,400); assert.equal(h.calls.length,0);
  }
  for (const value of [true,false]) {
    const h = harness(); const response = await h.POST(request({orderId:id,archive:value,actor:'forged',payment:'approved',stock:0}));
    assert.equal(response.status,200); assert.equal((await response.json()).archived,value);
    assert.deepEqual(h.calls,[{name:'set_order_archived',args:{p_order:id,p_archive:value}}]);
  }
});
test('archive API exposes review reason with 409 and missing order with 404', async () => {
  const h = harness(true,'ARCHIVE_NOT_ALLOWED: PAYMENT_REQUIRES_ATTENTION');
  const response = await h.POST(request({orderId:id,archive:true}));
  assert.equal(response.status,409); assert.match((await response.json()).error,/pendiente/);
  assert.equal((await harness(true,'ARCHIVE_ORDER_NOT_FOUND').POST(request({orderId:id,archive:false}))).status,404);
});
test('list API defaults to active; archived stays separate and ignores normal operational filters', async () => {
  const calls = [];
  const h = harness();
  const { GET } = load('app/api/admin/orders/route.ts',{...h.mocks,'@/lib/supabase/server':{isServiceRoleConfigured:()=>true,createAdminServerClient:()=>({rpc:async(name,args)=>{calls.push({name,args:plain(args)});return {data:{data:[],pagination:{total:0}},error:null};}})}});
  assert.equal((await GET(new Request('https://test.invalid?q=DCL-000001&period=all'))).status,200);
  assert.equal(calls[0].args.p_archived,false);
  assert.equal((await GET(new Request('https://test.invalid?q=DCL-000001&view=archived&status=attention&operational=ready&period=all'))).status,200);
  assert.equal(calls[1].args.p_archived,true); assert.equal(calls[1].args.p_status,'all'); assert.equal(calls[1].args.p_operational,'all'); assert.equal(calls[1].args.p_q,'DCL-000001');
  assert.equal((await GET(new Request('https://test.invalid?view=all'))).status,400); assert.equal(calls.length,2);
});

const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node,...nodes(node.props?.children)];
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
const settle = () => new Promise(resolve=>setImmediate(resolve));
function ui(eligible = true) {
  const states = [],refs = [],requests = [],confirmations = []; let cursor=0,refCursor=0,confirm=true;
  const fixture = {
    id,order_number:'DCL-000123',status:'completed',operational_status:eligible?'delivered':'received',total:100,
    created_at:'2026-09-13T10:00:00Z',payment_method:'transfer',fulfillment_method:'pickup',notes:'',
    archived_at:null,archive_block_reason:eligible?null:'ORDER_NOT_TERMINAL',
    customer:{full_name:'Test client',phone:null,email:null},payment:{status:'approved',sale_id:'sale',sale_status:'completed'},
    items:[{product_name:'Test product',quantity:1,line_total:100}],internalNotes:[],operationalHistory:[],
  };
  const react = {
    useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},
    useRef(initial){const i=refCursor++;return refs[i]||={current:initial};},useCallback:fn=>fn,useEffect(){},
  };
  const { OrdersManager } = load('components/admin/OrdersManager.tsx',{react},{URLSearchParams,window:{confirm:message=>{confirmations.push(message);return confirm;}},fetch:async(url,init)=>{
    requests.push({url,body:init?JSON.parse(init.body):null});
    if(init){const body=JSON.parse(init.body);fixture.archived_at=body.archive?'2026-09-13T12:00:00Z':null;fixture.operationalHistory.unshift({id:fixture.operationalHistory.length+1,action:body.archive?'archive':'restore',previous_status:'delivered',new_status:'delivered',created_at:'2026-09-13T12:00:00Z',actor:'admin',source:'admin',note:''});return Response.json({ok:true});}
    const archived=new URL(url,'https://test.invalid').searchParams.get('view')==='archived';
    const data=archived===Boolean(fixture.archived_at)?[plain(fixture)]:[];
    return Response.json({data,pagination:{total:data.length}});
  }});
  const render=()=>{cursor=0;refCursor=0;return OrdersManager();};
  const button=label=>nodes(render()).find(n=>n.type==='button'&&text(n)===label);
  const refresh=async()=>{button('Actualizar pedidos').props.onClick();await settle();};
  const open=()=>nodes(render()).find(n=>n.type==='button'&&text(n).includes('Test client')).props.onClick();
  return {render,button,refresh,open,requests,confirmations,setConfirm:v=>{confirm=v;}};
}
test('Admin archives with the requested confirmation, isolates search, opens archived detail and restores', async () => {
  const h=ui(); await h.refresh();
  assert.match(h.requests[0].url,/view=active/);
  h.open(); h.setConfirm(false); h.button('Archivar pedido').props.onClick(); await settle();
  assert.equal(h.requests.filter(r=>r.body).length,0);
  h.setConfirm(true); h.button('Archivar pedido').props.onClick(); await settle();
  assert.equal(h.confirmations[0],'Este pedido dejará de aparecer entre los pedidos activos. No se eliminará y podrás restaurarlo.');
  assert.doesNotMatch(text(h.render()),/Test client/);
  nodes(h.render()).find(n=>n.type==='input').props.onChange({target:{value:'DCL-000123'}});
  h.button('Ver archivados').props.onClick(); await h.refresh();
  assert.match(h.requests.at(-1).url,/view=archived/);assert.match(h.requests.at(-1).url,/q=DCL-000123/);
  assert.equal(nodes(h.render()).filter(n=>n.type==='select').length,1);
  h.open();assert.match(text(h.render()),/Pedido archivado/);
  assert.equal(h.button('Archivar pedido'),undefined);h.button('Restaurar pedido').props.onClick();await settle();
  assert.doesNotMatch(text(h.render()),/Test client/);
  h.button('Pedidos activos').props.onClick();await h.refresh();h.open();
  assert.match(text(h.render()),/Pedido restaurado/);
  assert.deepEqual(h.requests.filter(r=>r.body).map(r=>({url:r.url,archive:r.body.archive})),[{url:'/api/admin/orders/archive',archive:true},{url:'/api/admin/orders/archive',archive:false}]);
});
test('Admin does not expose archive for an ineligible order', async () => {
  const h=ui(false);await h.refresh();h.open();assert.equal(h.button('Archivar pedido'),undefined);
  assert.match(text(h.render()),/Sólo se pueden archivar pedidos entregados o cancelados/);
});
