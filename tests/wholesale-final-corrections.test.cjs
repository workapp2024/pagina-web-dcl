const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=require('./load-ts.cjs');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {wholesaleMoneySummary,refundablePayment,adminCommercialTracking,adminOrderDelivered,historicalOrder}=load('lib/wholesale-order-summary.ts');
const payment=(id,amount,entry_type='payment',refund_of=null)=>({id,amount,entry_type,refund_of,currency:'ARS'});
const recognition=(amount,reversed=0)=>({amount,currency:'ARS',reversal:reversed ? {amount:reversed}:null});

test('regularized cancelled order has zero commercial debt while preserving compensated historical amounts',()=>{
  const payments=[payment('p',78446),payment('r',78446,'refund','p')];
  const result=wholesaleMoneySummary('cancelled',78446,'ARS',payments,[recognition(78446,78446)]);
  assert.equal(result.recognized,0);assert.equal(result.due,0);assert.equal(result.paid,0);assert.equal(result.settled,true);
  assert.equal(result.compensated,78446);assert.equal(refundablePayment(payments[0],payments),0);
});
test('cancelled order never hides receivables or a real customer credit requiring refund review',()=>{
  assert.equal(wholesaleMoneySummary('cancelled',100,'ARS',[payment('p',20)],[recognition(100)]).due,80);
  const credit=wholesaleMoneySummary('cancelled',100,'ARS',[payment('p',40)],[]);
  assert.equal(credit.refundReview,40);assert.equal(credit.settled,false);
  assert.equal(refundablePayment(payment('p',100),[payment('p',100),payment('r',30,'refund','p')]),70);
});
test('confirmed, delivered and rejected presentations preserve their distinct commercial meanings',()=>{
  assert.equal(wholesaleMoneySummary('confirmed',100,'ARS',[payment('p',20)],[]).due,80);
  assert.equal(wholesaleMoneySummary('confirmed',100,'ARS',[payment('p',100)],[recognition(100)]).due,0);
  assert.equal(wholesaleMoneySummary('rejected',100,'ARS',[],[]).due,0);
  assert.equal(historicalOrder('cancelled'),true);assert.equal(historicalOrder('confirmed'),false);assert.equal(historicalOrder('confirmed',true),true);
  assert.equal(wholesaleMoneySummary('cancelled',100,'ARS',[{...payment('p',10),currency:'USD'}],[]),null);
});
test('commercial timeline excludes audit noise and terminates on the genuine cancellation',()=>{
  const event=(id,type)=>({id,type,createdAt:`2026-10-13T12:00:0${id}Z`});
  const events=[event(1,'order_created'),event(2,'revision_created'),event(3,'revision_proposed'),event(4,'order_cancelled'),event(5,'delivery_correction_recorded')];
  assert.deepEqual(Array.from(adminCommercialTracking(events),e=>e.label),['Pedido recibido','Propuesta enviada','Cancelado']);
  assert.equal(adminCommercialTracking(events).at(-1).at,events[3].createdAt);
  assert.equal(adminOrderDelivered([event(1,'order_fully_delivered'),event(2,'order_delivery_completion_reversed')]),false);
});

test('visibility API derives viewer on the server, rejects forged scopes and preserves independent scopes',async()=>{
  const calls=[];const actor='11111111-1111-4111-8111-111111111111';const id='22222222-2222-4222-8222-222222222222';
  const mocks={
    '@/lib/wholesale-order-visibility-server':{readWholesaleVisibility:async viewer=>({available:true,ids:viewer.p_customer ? [id] : []})},
    '@/lib/wholesale-session-origin':{isWholesaleSessionWriteAllowed:()=>true},
    '@/lib/supabase/server':{createAdminServerClient:()=>({rpc:async(...args)=>{calls.push(args);return {error:null};}})},
  };
  const {visibilityResponse}=load('lib/wholesale-order-visibility-api.ts',mocks);
  const request=body=>new Request('https://dcl.test/visibility',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await visibilityResponse(request({orderId:id,archived:true,p_customer:actor}),{p_actor:actor,p_customer:null})).status,400);
  assert.equal(calls.length,0);
  assert.equal((await visibilityResponse(request({orderId:id,archived:true}),{p_customer:actor,p_actor:null})).status,200);
  assert.equal(calls[0][1].p_customer,actor);assert.equal(calls[0][1].p_actor,null);
  const read=new Request('https://dcl.test/visibility');
  assert.deepEqual((await (await visibilityResponse(read,{p_customer:actor,p_actor:null})).json()).ids,[id]);
  assert.deepEqual((await (await visibilityResponse(read,{p_customer:null,p_actor:actor})).json()).ids,[]);
});

test('regularized cancellation renders no fictitious debt, refund or exhausted delivery forms',()=>{
  const entries=[{...payment('p',78446),payment_method:'cash',occurred_at:'2026-10-13T12:00:00Z',posting_status:'neutralized_test_pair'},
    {...payment('r',78446,'refund','p'),payment_method:'cash',occurred_at:'2026-10-13T12:00:00Z',posting_status:'neutralized_test_pair'}];
  const ledger={payments:entries,recognitions:[],reconciliations:[],accountingJournals:[],deliveryCorrections:[{delivery_id:'d',items:[{productId:'p1',quantity:1}]}],physicalReturns:[]};
  let index=0;
  const {WholesaleOrderLedger}=load('components/admin/WholesaleOrderLedger.tsx',{
    react:{...React,useState:initial=>[index++===0 ? ledger : index===2 ? true : initial,()=>{}],useEffect:()=>{},useMemo:fn=>fn(),useCallback:fn=>fn,useRef:initial=>({current:initial})},
  });
  const html=renderToStaticMarkup(React.createElement(WholesaleOrderLedger,{orderId:'o',revisionId:'v',status:'cancelled',total:78446,currency:'ARS',view:'history',deliveries:[{id:'d',deliveredAt:'2026-10-13T12:00:00Z',items:[{productId:'p1',quantity:1}]}]}));
  assert.match(html,/Pedido cancelado.*Sin cobros ni entregas pendientes/);
  assert.match(html,/Contrarregistro compensado/);
  assert.doesNotMatch(html,/Pendiente del total|Reembolsar|Guardar corrección|Registrar devolución física|Registrar cobro|Marcar conciliado/);
});

test('missing archive migration disables the capability while unrelated read failures remain errors',async()=>{
  let result={data:null,error:{code:'PGRST202'}};
  const {readWholesaleVisibility}=load('lib/wholesale-order-visibility-server.ts',{'@/lib/supabase/server':{createAdminServerClient:()=>({rpc:async()=>result})}});
  assert.equal((await readWholesaleVisibility({p_customer:null,p_actor:'admin'})).available,false);
  result={data:null,error:{code:'42501'}};
  await assert.rejects(readWholesaleVisibility({p_customer:null,p_actor:'admin'}),/Visibility unavailable/);
});

test('revision history is ADMIN-only and returns snapshots without costs or private customer fields',async()=>{
  let role='VENDEDOR';let queries=0;
  const revision={id:'v1',version_number:1,status:'approved',commercial_conditions:'Condición histórica',total_amount:'100',currency:'ARS',created_at:'2026-10-13T12:00:00Z'};
  const item={product_id:'p1',product_name_snapshot:'Lámpara',category_snapshot:'LED',connector_type_snapshot:'H7',quantity:1,unit_price:'100',line_total:'100',currency:'ARS'};
  const {GET}=load('app/api/admin/wholesale-orders/[id]/revisions/route.ts',{
    '@/lib/admin-auth':{getAdminIdentity:async()=>({role})},
    '@/lib/supabase/server':{isServiceRoleConfigured:()=>true,createAdminServerClient:()=>({from(table){queries++;const q={select(fields){assert.doesNotMatch(fields,/cost|private|phone|email/);return q;},eq(){return q;},order(){return q;},range:async()=>({data:[revision],error:null}),then(resolve){resolve({data:table==='wholesale_order_revision_items'?[item]:[],error:null});}};return q;}})},
  });
  const context={params:Promise.resolve({id:'11111111-1111-4111-8111-111111111111'})};
  assert.equal((await GET(new Request('https://dcl.test'),context)).status,403);assert.equal(queries,0);
  role='ADMIN';const response=await GET(new Request('https://dcl.test'),context);
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.data[0].items[0].name,'Lámpara');assert.equal(body.data[0].totalAmount,100);
});
