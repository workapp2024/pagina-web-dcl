/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const load = require('./load-ts.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
const request = body => new Request('https://test.invalid/api',{method:'POST',body:JSON.stringify(body)});
function chain(data) {
  const q = { then: resolve => Promise.resolve({data,error:null}).then(resolve) };
  for (const key of ['select','eq','or','update','single','maybeSingle']) q[key]=()=>q;
  return q;
}
const env={NODE_ENV:'production',VERCEL_ENV:'preview',NEXT_PUBLIC_ANALYTICS_ENVIRONMENT:'production',MERCADOPAGO_ACCESS_TOKEN:'fake',MERCADOPAGO_WEBHOOK_SECRET:'fake'};
const silent={warn(){},error(){},info(){}};

test('creation API sanitizes only analytics context, trusts server environment and schedules after RPC success',async()=>{
  const id=randomUUID(), distinct_id=randomUUID(), session_id=randomUUID();
  for(const context of [{distinct_id,session_id},{distinct_id,phone:'private'},null]) {
    const calls=[],order=[];
    const {POST}=load('app/api/store/orders/route.ts',{
      '@/lib/rate-limit':{rateLimit:()=>null},
      '@/lib/store/analytics-outbox':{scheduleAnalyticsFlush:()=>order.push('flush')},
      '@/lib/supabase/server':{createAdminServerClient:()=>({rpc:async(name,args)=>{calls.push({name,args:plain(args)});order.push('commit');return {data:id,error:null};},from:()=>chain({total:200,order_number:'DCL-1'})})},
    },{process:{env},console:silent});
    const result=await POST(request({name:'Customer',phone:'123',email:'',fulfillment:'pickup',paymentMethod:'card',idempotencyKey:randomUUID(),items:[{productId:'p1',quantity:2}],analytics_context:context,environment:'production'}));
    assert.equal(result.status,200); assert.deepEqual(order,['commit','flush']);
    assert.equal(calls[0].args.p_analytics_environment,'preview');
    assert.deepEqual(calls[0].args.p_analytics_context,context?.phone||!context?null:context);
  }
});

test('both webhook variants keep payment reconciliation and schedule even without a sale',async()=>{
  for(const kind of ['webhook','checkout-pro-webhook']) {
    const order=randomUUID(),calls=[],sequence=[];
    const provider=kind==='webhook'?{id:'external',external_reference:order,total_amount:200,currency:'ARS',status:'processed',transactions:{payments:[{id:'payment'}]}}:{id:'payment',external_reference:order,transaction_amount:200,currency_id:'ARS',status:'approved'};
    const {POST}=load(`app/api/payments/mercadopago/${kind}/route.ts`,{
      mercadopago:{InvalidWebhookSignatureError:class extends Error{},WebhookSignatureValidator:{validate(){}}},
      '@/lib/store/analytics-outbox':{scheduleAnalyticsFlush:()=>sequence.push('flush')},
      '@/lib/supabase/server':{createAdminServerClient:()=>({from:()=>chain({external_order_id:'external'}),rpc:async(name,args)=>{calls.push({name,args:plain(args)});sequence.push('commit');return {data:null,error:null};}})},
    },{process:{env},console:silent,fetch:async()=>Response.json(provider)});
    const req={nextUrl:new URL('https://test.invalid?data.id=external&type='+(kind==='webhook'?'order':'payment')),headers:new Headers({'x-signature':'fake','x-request-id':'fake'}),text:async()=>''};
    assert.equal((await POST(req)).status,200);assert.deepEqual(sequence,['commit','flush']);
    assert.equal(calls[0].name,'complete_mercadopago_order'); assert.equal(calls[0].args.p_analytics_environment,'preview');
    assert.equal(calls[0].args.p_status,'processed');
  }
});

test('payment API, manual confirmation and stock resolution preserve RPC semantics and enqueue flush',async()=>{
  const id=randomUUID();
  for(const kind of ['card','transfer','resolve']) {
    const calls=[],sequence=[];
    const db={from:table=>chain(table==='orders'?{total:200,currency:'ARS'}:{id,external_idempotency_key:'key',external_order_id:null}),rpc:async(name,args)=>{
      calls.push({name,args:plain(args)});
      if(name==='get_order_payment_window') return {data:new Date(Date.now()+60000).toISOString(),error:null};
      sequence.push('commit');return {data:id,error:null};
    }};
    const path=kind==='card'?'app/api/payments/mercadopago/orders/route.ts':kind==='transfer'?'app/api/admin/orders/route.ts':'app/api/admin/orders/resolve/route.ts';
    const {POST}=load(path,{
      '@/lib/admin-auth':{isAdminAuthenticated:async()=>true},'@/lib/rate-limit':{rateLimit:()=>null},
      '@/lib/store/analytics-outbox':{scheduleAnalyticsFlush:()=>sequence.push('flush')},
      '@/lib/supabase/server':{createAdminServerClient:()=>db,isServiceRoleConfigured:()=>true},
    },{process:{env},console:silent,fetch:async()=>Response.json({id:'external',external_reference:id,total_amount:200,currency:'ARS',status:'processed',transactions:{payments:[{id:'payment'}]}})});
    const body=kind==='card'?{orderId:id,token:'token',payment_method_id:'visa',payment_type:'credit_card',installments:1,payer:{email:'fake@example.test'}}:kind==='transfer'?{orderId:id,action:'confirm_transfer'}:{orderId:id,idempotencyKey:randomUUID(),resolutionType:'COMPLETE_STOCK_UNAVAILABLE',note:'Test'};
    assert.equal((await POST(request(body))).status,200);assert.deepEqual(sequence,['commit','flush']);
    assert.equal(calls.at(-1).args.p_analytics_environment,'preview');
  }
});

test('admin recovery requires authentication and failed commerce never schedules a flush',async()=>{
  let flushes=0;
  const mocks={'@/lib/store/analytics-outbox':{scheduleAnalyticsFlush:()=>flushes++},'@/lib/admin-auth':{isAdminAuthenticated:async()=>false}};
  const {GET}=load('app/api/admin/analytics/detail/route.ts',mocks);
  assert.equal((await GET(new Request('https://test.invalid?kind=products'))).status,401);assert.equal(flushes,0);
  const {POST}=load('app/api/store/orders/route.ts',{
    ...mocks,'@/lib/rate-limit':{rateLimit:()=>null},'@/lib/supabase/server':{createAdminServerClient:()=>({rpc:async()=>({data:null,error:{message:'OUT_OF_STOCK'}})})},
  },{console:silent});
  assert.equal((await POST(request({name:'Test',phone:'123',fulfillment:'pickup',paymentMethod:'card',idempotencyKey:randomUUID(),items:[{productId:'p1',quantity:1}]}))).status,409);
  assert.equal(flushes,0);
});
