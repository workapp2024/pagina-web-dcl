/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const load = require('./load-ts.cjs');
const id = randomUUID();
const silent = { info(){},warn(){},error(){} };
function chain(result) {
  const query = { then: (resolve,reject) => Promise.resolve(result).then(resolve,reject) };
  for (const method of ['select','eq','or','order','limit','update','maybeSingle','single']) query[method]=()=>query;
  return query;
}
const mocks = db => ({ '@/lib/rate-limit': { rateLimit:()=>null }, '@/lib/supabase/server':{createAdminServerClient:()=>db,isServiceRoleConfigured:()=>true} });
const request=body=>new Request('https://test.invalid/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
test('availability RPC error, null, invalid number and thrown exception never advertise physical stock',async()=>{
  for(const result of [{data:null,error:{}},{data:null,error:null},{data:-1,error:null},{data:'10',error:null},new Error('offline')]) {
    const db={from:()=>chain({data:{active:true,stock:999},error:null}),rpc:async()=>{if(result instanceof Error)throw result;return result;}};
    const {GET}=load('app/api/store/products/[id]/availability/route.ts',mocks(db));
    const response=await GET(new Request('https://test.invalid/?quantity=1'),{params:Promise.resolve({id})});
    assert.equal(response.status,503);assert.equal((await response.json()).available,false);
  }
});
test('availability uses authoritative quantity, not physical stock',async()=>{
  const {GET}=load('app/api/store/products/[id]/availability/route.ts',mocks({from:()=>chain({data:{active:true,stock:999}}),rpc:async()=>({data:0})}));
  const response=await GET(new Request('https://test.invalid/?quantity=1'),{params:Promise.resolve({id})});
  assert.equal((await response.json()).available,false);
});
function preference({deadline=new Date(Date.now()+7*60000).toISOString(),existing=null,final=deadline,externalDeadline=deadline}={}) {
  const calls=[];let rpcCalls=0;
  const db={from:table=>chain({data:table==='orders'?{id,total:100,currency:'ARS',payment_method:'mercadopago'}:{id:'tx',external_order_id:existing,external_idempotency_key:'key'}}),rpc:async()=>({data:++rpcCalls===1?deadline:final,error:null})};
  const {POST}=load('app/api/payments/mercadopago/preference/route.ts',mocks(db),{console:silent,process:{env:{MERCADOPAGO_ACCESS_TOKEN:'mock',NEXT_PUBLIC_SITE_URL:'https://test.invalid'}},fetch:async(url,init)=>{calls.push({url,init});return Response.json({id:'pref',init_point:'https://test.invalid/pay',external_reference:id,expires:true,expiration_date_to:externalDeadline});}});
  return {POST,calls};
}
test('Checkout Pro sends the supplied real deadline, including a partially elapsed reservation',async()=>{
  for(const minutes of [29,6]) {
    const deadline=new Date(Date.now()+minutes*60000).toISOString(),{POST,calls}=preference({deadline});
    assert.equal((await POST(request({orderId:id}))).status,200);
    const payload=JSON.parse(calls[0].init.body);
    assert.equal(payload.expiration_date_to,deadline);assert.equal(payload.expires,true);
  }
});
test('Checkout Pro reuses linked preference without creating another or extending deadline',async()=>{
  const {POST,calls}=preference({existing:'pref'});
  assert.equal((await POST(request({orderId:id}))).status,200);
  assert.equal(calls.length,1);assert.equal(calls[0].init.method,undefined);
});
test('expired/invalid reservation and expired/overshooting preference fail closed',async()=>{
  for(const deadline of [null,'invalid',new Date(Date.now()-1000).toISOString()]) {
    const {POST,calls}=preference({deadline});assert.equal((await POST(request({orderId:id}))).status,409);assert.equal(calls.length,0);
  }
  for(const externalDeadline of [new Date(Date.now()-1000).toISOString(),new Date(Date.now()+60*60000).toISOString()]) {
    const {POST}=preference({existing:'pref',externalDeadline});assert.equal((await POST(request({orderId:id}))).status,409);
  }
});
test('reservation invalidated while provider responds is rejected for new and reused preference',async()=>{
  for(const existing of [null,'pref']) for(const final of [null,'invalid']) {
    const {POST}=preference({existing,final});assert.equal((await POST(request({orderId:id}))).status,409);
  }
});
test('stock_unavailable and approved-but-incomplete always return review',async()=>{
  for(const status of ['stock_unavailable','pending_payment','cancelled']) {
    const db={from:table=>chain({data:table==='orders'?{status,payment_method:'mercadopago',total:100,currency:'ARS'}:{status:'approved'}})};
    const {GET}=load('app/api/store/orders/[id]/status/route.ts',mocks(db));
    const body=await (await GET(new Request('https://test.invalid'),{params:Promise.resolve({id})})).json();
    assert.equal(body.result,'review');assert.equal(body.paymentReceived,true);
  }
});
test('signed Checkout Pro webhook repeats the same reconciliation arguments; unsigned webhook is rejected',async()=>{
  const calls=[];
  class InvalidSignature extends Error {}
  const db={from:()=>chain({data:{external_order_id:'pref'}}),rpc:async(name,args)=>{calls.push({name,args});return {data:'sale',error:null};}};
  const {POST}=load('app/api/payments/mercadopago/checkout-pro-webhook/route.ts',{...mocks(db),mercadopago:{InvalidWebhookSignatureError:InvalidSignature,WebhookSignatureValidator:{validate:()=>{}}}},{console:silent,process:{env:{MERCADOPAGO_ACCESS_TOKEN:'mock',MERCADOPAGO_WEBHOOK_SECRET:'mock'}},fetch:async()=>Response.json({id:123,status:'approved',external_reference:id,transaction_amount:100,currency_id:'ARS'})});
  const req=()=>({nextUrl:new URL('https://test.invalid?type=payment&data.id=123'),headers:new Headers({'x-signature':'mock','x-request-id':'mock'})});
  assert.equal((await POST(req())).status,200);assert.equal((await POST(req())).status,200);
  assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].args.p_status,'processed');
  assert.equal((await POST({...req(),headers:new Headers()})).status,400);
});
