const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=require('./load-ts.cjs');
const id='11111111-1111-4111-8111-111111111111',customer='22222222-2222-4222-8222-222222222222';
const intent={id,order_id:'33333333-3333-4333-8333-333333333333',revision_id:'44444444-4444-4444-8444-444444444444',customer_id:customer,amount:40,currency:'ARS',expires_at:new Date(Date.now()+600000).toISOString(),preference_id:null};
const preference={id:'fixture-pref',external_reference:`wholesale:${id}`,expires:true,expiration_date_to:intent.expires_at,init_point:'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=fixture',metadata:{sector:'mayoristas',wholesale_intent_id:id,wholesale_order_id:intent.order_id,wholesale_revision_id:intent.revision_id},items:[{id:intent.order_id,quantity:1,unit_price:40,currency_id:'ARS'}]};

test('unverified projects and automatic checkout cannot activate production with local flags',()=>{
  const flags=load('lib/prepared-finance-features.ts',{}, {process:{env:{NODE_ENV:'production',DCL_PREPARED_WHOLESALE_CHECKOUT:'1',DCL_PREPARED_SECTOR_FINANCE:'1'}}});
  assert.equal(flags.sectorFinancePreparedEnabled(),false);assert.equal(flags.wholesaleCheckoutPreparedEnabled(),false);
  const remote=load('lib/prepared-finance-features.ts',{}, {process:{env:{NODE_ENV:'development',NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.co',DCL_PREPARED_WHOLESALE_CHECKOUT:'1',DCL_PREPARED_SECTOR_FINANCE:'1'}}});
  assert.equal(remote.sectorFinancePreparedEnabled(),false);assert.equal(remote.wholesaleCheckoutPreparedEnabled(),false);
});
test('authorized production project enables installed sector finance but keeps automatic checkout disabled',()=>{
  const env={NODE_ENV:'production',NEXT_PUBLIC_SUPABASE_URL:'https://ajbztbwflhjxrenryphu.supabase.co',DCL_PREPARED_WHOLESALE_CHECKOUT:'1'};
  const flags=load('lib/prepared-finance-features.ts',{}, {process:{env}});
  assert.equal(flags.sectorFinancePreparedEnabled(),true);
  assert.equal(flags.wholesaleCheckoutPreparedEnabled(),false);
  const disabled=load('lib/prepared-finance-features.ts',{}, {process:{env:{...env,DCL_PREPARED_SECTOR_FINANCE:'0'}}});
  assert.equal(disabled.sectorFinancePreparedEnabled(),false);
});
test('checkout provider creation is claimed once; uncertain retries recover instead of issuing another POST',async()=>{
  let postCount=0,claim=true;const calls=[];
  const {prepareWholesaleCheckout}=load('lib/wholesale-checkout.ts',{
    '@/lib/store/mercadopago-recovery':{providerGet:async path=>path.includes('/search?')?{elements:[{id:'fixture-pref'}]}:preference},
  },{fetch:async(url,init)=>{postCount++;assert.equal(url,'https://api.mercadopago.com/checkout/preferences');const body=JSON.parse(init.body);assert.equal(body.external_reference,`wholesale:${id}`);assert.equal(body.metadata.sector,'mayoristas');assert.equal(body.items[0].unit_price,40);return Response.json(preference);}});
  const db={rpc:async(name,args)=>{calls.push([name,args]);return {data:name==='begin_wholesale_checkout'?intent:name==='claim_wholesale_checkout'?claim:null,error:null};}};
  await prepareWholesaleCheckout(db,customer,intent.order_id,40,id,'test-token','https://dcl.test');claim=false;
  await prepareWholesaleCheckout(db,customer,intent.order_id,40,id,'test-token','https://dcl.test');
  assert.equal(postCount,1);assert.ok(calls.every(([name])=>!['complete_manual_transfer','complete_mercadopago_order','create_sale_with_inventory'].includes(name)));
});
test('provider amount, sector, merchant relationship and preference proofs are checked before settlement',async()=>{
  let merchantValid=true,settled=0;
  const {reconcileWholesaleCheckout,verifyWholesalePreference}=load('lib/wholesale-checkout.ts',{
    '@/lib/store/mercadopago-recovery':{providerGet:async path=>path.startsWith('/v1/payments/')?{id:700001,external_reference:`wholesale:${id}`,order:{id:900,type:'mercadopago'},transaction_amount:40,currency_id:'ARS',status:'approved',date_approved:new Date().toISOString()}:path.startsWith('/merchant_orders/')?{id:900,external_reference:merchantValid?`wholesale:${id}`:customer,preference_id:'fixture-pref',payments:[{id:700001}]}:preference},
  });
  assert.throws(()=>verifyWholesalePreference({...preference,metadata:{...preference.metadata,sector:'minoristas'}},intent),/mismatch/);
  assert.throws(()=>verifyWholesalePreference({...preference,items:[{...preference.items[0],unit_price:41}]},intent),/mismatch/);
  assert.throws(()=>verifyWholesalePreference({...preference,init_point:'https://evil.test/pay'},intent),/host/);
  const db={from(table){assert.equal(table,'wholesale_checkout_intents');const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{...intent,preference_id:'fixture-pref'},error:null})};return q;},rpc:async(name,args)=>{assert.equal(name,'settle_wholesale_checkout');assert.equal(args.p_payment,'700001');settled++;return {data:'approved',error:null};}};
  assert.equal(await reconcileWholesaleCheckout(db,'700001','test-token'),'approved');merchantValid=false;
  await assert.rejects(reconcileWholesaleCheckout(db,'700001','test-token'),/relationship/);assert.equal(settled,1);
});
test('manual sector endpoint binds the administrator, requires sector/account and preserves positive request amount',async()=>{
  let role='ADMIN';const calls=[];
  const {POST}=load('app/api/admin/finances/sector/route.ts',{
    '@/lib/admin-auth':{getAdminIdentity:async()=>({id,role,legacy:false})},
    '@/lib/prepared-finance-features':{sectorFinancePreparedEnabled:()=>true},
    '@/lib/wholesale-session-origin':{isWholesaleSessionWriteAllowed:()=>true},
    '@/lib/supabase/server':{createAdminServerClient:()=>({rpc:async(...args)=>{calls.push(args);return {data:id,error:null};}})},
  });
  const body={operation:'withdrawal',sector:'mayoristas',accountId:'mercadopago',amount:10,reason:'Ensayo aislado',occurredAt:new Date().toISOString(),idempotencyKey:id};
  const request=b=>new Request('https://dcl.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});
  assert.equal((await POST(request({...body,sector:'unassigned'}))).status,400);assert.equal(calls.length,0);
  assert.equal((await POST(request(body))).status,200);assert.equal(calls[0][1].p_from,'mayoristas');assert.equal(calls[0][1].p_account,'mercadopago');assert.equal(calls[0][1].p_amount,10);assert.equal(calls[0][1].p_actor,id);
  role='VENDEDOR';assert.equal((await POST(request(body))).status,403);assert.equal(calls.length,1);
});
test('checkout routes remain disabled without local authorization and reject invalid webhook signatures',async()=>{
  const flags={'@/lib/prepared-finance-features':{wholesaleCheckoutPreparedEnabled:()=>false}};
  const route=load('app/api/wholesale/orders/[id]/checkout/route.ts',flags);
  assert.equal((await route.POST(new Request('https://dcl.test'),{params:Promise.resolve({id})})).status,503);
  let settled=0;
  const webhook=load('app/api/wholesale/checkout/webhook/route.ts',{
    '@/lib/prepared-finance-features':{wholesaleCheckoutPreparedEnabled:()=>true},
    mercadopago:{WebhookSignatureValidator:{validate(){throw Error('Invalid signature');}}},
    '@/lib/wholesale-checkout':{reconcileWholesaleCheckout:async()=>{settled++;}},
  },{process:{env:{MERCADOPAGO_WEBHOOK_SECRET:'fixture-secret',MERCADOPAGO_ACCESS_TOKEN:'fixture-token'}}});
  const request=new Request('https://dcl.test?type=payment&data.id=700001',{method:'POST',headers:{'x-signature':'invalid','x-request-id':'fixture'}});request.nextUrl=new URL(request.url);
  assert.equal((await webhook.POST(request)).status,401);assert.equal(settled,0);
});

test('classified legacy withdrawal is displayed as a classification, not another payment or reversal',()=>{
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
  const {FinanceCashHistory}=load('components/admin/FinanceCashHistory.tsx',{react:{useState:initial=>[initial,()=>{}]}});
  const html=renderToStaticMarkup(React.createElement(FinanceCashHistory,{hidden:false,accounts:[{id:'mercadopago',name:'Mercado Pago'}],rows:[{id,amount:-29998,movement_type:'cash_withdrawal',sector:'mayoristas',account_id:'mercadopago',description:'Retiro original',occurred_at:'2026-10-18T02:07:37Z',operation:{id:customer,action:'reclassify',actor_id:customer,created_at:'2026-10-18T03:00:00Z',legacy_movement_id:id,request:{to:'mayoristas'}}}]}));
  assert.match(html,/Reclasificado/);assert.match(html,/Reclasificado el/);assert.doesNotMatch(html,/>Reversión · /);
});

test('customer can resume a pending partial checkout after reloading without creating another key',async()=>{
  const calls=[];
  const {WholesaleAutomaticPayment}=load('components/wholesale/WholesaleAutomaticPayment.tsx',{
    react:{useState:initial=>[initial,()=>{}],useRef:initial=>({current:initial})},
    '@/lib/client-uuid':{createClientUuid(){throw Error('Must preserve existing key');}},
  },{fetch:async(url,init)=>{calls.push(JSON.parse(init.body));return Response.json({checkoutUrl:preference.init_point});},window:{location:{assign(){}}}});
  const tree=WholesaleAutomaticPayment({orderId:intent.order_id,due:100,pending:{id,amount:40,requested_amount:40}});
  await tree.props.onSubmit({preventDefault(){}});assert.deepEqual(calls,[{amount:40,idempotencyKey:id}]);
});

test('namespaced wholesale reference cannot be consumed by the unchanged retail reconciliation',async()=>{
  let reads=0;
  const {reconcileCheckoutPro}=load('lib/store/mercadopago-recovery.ts',{}, {fetch:async()=>Response.json({id:700001,external_reference:`wholesale:${id}`})});
  await assert.rejects(reconcileCheckoutPro({from(){reads++;throw Error('Retail lookup forbidden');}},'700001','fixture-token'),/Invalid provider reference/);
  assert.equal(reads,0);
});
