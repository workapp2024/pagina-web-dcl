const {test}=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const load=require('./load-ts.cjs');
const {commercialStateClass,commercialHistory,wholesaleMoneySummary}=load('lib/wholesale-order-summary.ts');

test('current outcome controls colour even if an earlier revision was approved or delivered',()=>{
  for(const status of ['cancelled','rejected']) assert.match(commercialStateClass(status,true),/text-red/);
  assert.match(commercialStateClass('confirmed',true),/text-emerald/);
  for(const status of ['received','in_review','awaiting_customer','confirmed']) assert.match(commercialStateClass(status),/text-amber/);
  assert.match(commercialStateClass('unknown'),/text-zinc/);
});

test('normal history retains corrections after cancellation but excludes internal bookkeeping',()=>{
  const types=['order_created','revision_created','order_cancelled','delivery_correction_recorded','physical_return_recorded'];
  const events=types.map((type,id)=>({id,type,createdAt:`2026-10-15T12:00:0${id}Z`}));
  assert.deepEqual(Array.from(commercialHistory(events),event=>event.label),['Pedido recibido','Pedido cancelado','Entrega corregida','Devolución física registrada']);
  assert.equal(events.length,5);
});

test('an unconfirmed proposal amount is not a commercial receivable',()=>{
  for(const status of ['received','in_review','awaiting_customer','rejected']) assert.equal(wholesaleMoneySummary(status,100,'ARS',[],[]).due,0);
  assert.equal(wholesaleMoneySummary('confirmed',100,'ARS',[],[]).due,100);
});

function renderLedger(status,ledger,view='payments',deliveries=[]) {
  let index=0;
  const {WholesaleOrderLedger}=load('components/admin/WholesaleOrderLedger.tsx',{
    react:{...React,useState:initial=>[index++===0?ledger:index===2?true:initial,()=>{}],useEffect:()=>{},useMemo:fn=>fn(),useCallback:fn=>fn,useRef:initial=>({current:initial})},
  });
  return renderToStaticMarkup(React.createElement(WholesaleOrderLedger,{orderId:'o',revisionId:'v',status,total:100,currency:'ARS',view,deliveries}));
}
const empty={payments:[],recognitions:[],reconciliations:[],accountingJournals:[],deliveryCorrections:[],physicalReturns:[]};

test('normal settled cancellation is brief and excludes accounting, technical IDs and exhausted actions',()=>{
  const html=renderLedger('cancelled',empty);
  assert.match(html,/Pedido cancelado. Sin cobros ni entregas pendientes/);
  assert.doesNotMatch(html,/Diario de doble partida|Ver detalle contable|Gestionar cobros|Registrar cobro|Reembolsar/);
});

test('a genuine refund and physical return remain visible on a cancelled order',()=>{
  const html=renderLedger('cancelled',{...empty,payments:[{id:'p',entry_type:'payment',refund_of:null,amount:40,currency:'ARS',payment_method:'cash',occurred_at:'2026-10-15T12:00:00Z'}]},'payments',[{id:'d',deliveredAt:'2026-10-15T12:00:00Z',items:[{productId:'p1',quantity:1}]}]);
  assert.match(html,/Saldo a favor del cliente/);
  assert.match(html,/Reembolsar/);
  assert.match(html,/Registrar devolución física/);
  assert.doesNotMatch(html,/Sin cobros ni entregas pendientes/);
});

test('local development cookies support HTTP LAN while production remains Secure and HttpOnly',()=>{
  for(const mode of ['development','production']) {
    const {adminSessionCookie}=load('lib/admin-auth.ts',{'@/lib/supabase/server':{},'next/headers':{}},{process:{env:{NODE_ENV:mode}}});
    assert.equal(adminSessionCookie.secure,mode==='production');
    assert.equal(adminSessionCookie.httpOnly,true);
    assert.equal(adminSessionCookie.sameSite,'lax');
  }
  assert.match(require('../package.json').scripts['dev:lan'],/^next dev --hostname 0\.0\.0\.0$/);
});
