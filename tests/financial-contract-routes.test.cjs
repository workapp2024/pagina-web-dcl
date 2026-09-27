/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const load = require('./load-ts.cjs');
const request = body => new Request('https://test.invalid/api', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const silent = {warn(){},error(){}};
test('manual sale readiness and unknown-account failures provide actionable feedback',async()=>{
  for(const reason of ['FINANCE_NOT_READY','FINANCIAL_ACCOUNT_REQUIRED']) {
    const {POST}=load('app/api/admin/sales/route.ts',{
      '@/lib/admin-auth':{isAdminAuthenticated:async()=>true},
      '@/lib/supabase/server':{isServiceRoleConfigured:()=>true,createAdminServerClient:()=>({rpc:async()=>({data:null,error:{message:reason}})})},
    });
    const response=await POST(request({action:'create_sale',customerId:randomUUID(),items:[{productId:'test',quantity:1}],paymentMethod:'cash'}));
    assert.equal(response.status,409);
    const body=await response.json();
    if(reason==='FINANCE_NOT_READY') assert.equal(body.error,'Activá y configurá Finanzas antes de registrar ventas.');
    else assert.match(body.error,/cuenta financiera definida/);
  }
});
test('public finance rejection is generic; existing buyer order is still recovered',async()=>{
  for(const recovered of [null,'DCL-900100']) {
    let calls=0;
    const {POST}=load('app/api/store/orders/route.ts',{
      '@/lib/rate-limit':{rateLimit:()=>null},
      '@/lib/store/analytics-outbox':{scheduleAnalyticsFlush(){}},
      '@/lib/store/buyer-session':{isSameOriginWrite:()=>true,getBuyerSession:async()=>({id:randomUUID()}),claimBuyerAttempt:async()=>true,recoverBuyerOrder:async()=>recovered},
      '@/lib/supabase/server':{createAdminServerClient:()=>({rpc:async()=>{calls++;return {data:null,error:{message:'FINANCE_NOT_READY'}};}})},
    },{console:silent});
    const response=await POST(request({name:'Test',phone:'123',fulfillment:'pickup',paymentMethod:'card',idempotencyKey:randomUUID(),items:[{productId:'test',quantity:1}]}));
    const body=await response.json();
    assert.equal(response.status,recovered?200:503); assert.equal(calls,recovered?0:1);
    if(recovered) assert.equal(body.orderNumber,recovered);
    else {
      assert.equal(body.message,'Las compras online están temporalmente pausadas. Podés comunicarte con DCL por WhatsApp.');
      assert.doesNotMatch(JSON.stringify(body),/FINANCE|período|cuenta|activación/);
    }
  }
});
