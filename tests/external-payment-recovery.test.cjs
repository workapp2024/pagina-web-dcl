/* eslint-disable @typescript-eslint/no-require-imports */
require('./offline-network.cjs');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const database=require('./database.cjs');
const load=require('./load-ts.cjs');
let db;
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
before(async()=>{db=await database();await db.exec('SELECT activate_finances(0,0,gen_random_uuid())');});
after(async()=>{await db?.close();});
const plain=value=>JSON.parse(JSON.stringify(value));
// Only the Supabase transport is adapted. All RPCs, triggers and constraints execute in PGlite.
const client={
  rpc:async(name,args)=>{try {
    const entries=Object.entries(args),params=entries.map(([key],i)=>`${key}=>$${i+1}`).join(',');
    return {data:await scalar(`SELECT ${name}(${params})`,entries.map(([,value])=>value)),error:null};
  }catch(error){return {data:null,error:{message:error.message}};}},
  from(table){
    let columns='*',updates=null;const filters=[];
    const query={select(value){columns=value;return query;},eq(key,value){filters.push([key,value]);return query;},
      update(value){updates=value;return query;},single(){return query;},maybeSingle(){return query;},
      async then(resolve,reject){try {
        const args=[],where=filters.map(([key,value])=>{args.push(value);return `${key}=$${args.length}`;}).join(' AND ');
        let sql=`SELECT ${columns} FROM ${table} WHERE ${where}`;
        if(updates){const set=Object.entries(updates).map(([key,value])=>{args.push(value);return `${key}=$${args.length}`;}).join(',');sql=`UPDATE ${table} SET ${set} WHERE ${where} RETURNING *`;}
        const rows=(await db.query(sql,args)).rows;resolve({data:rows[0]??null,error:null});
      }catch(error){if(reject)reject(error);else throw error;}}
    };return query;
  }
};
const silent={warn(){},info(){},error(){}};
class InvalidSignature extends Error {}
const mocks={
  '@/lib/supabase/server':{createAdminServerClient:()=>client},
  '@/lib/rate-limit':{rateLimit:()=>null},
  '@/lib/store/analytics-outbox':{scheduleAnalyticsFlush(){}},
  '@/lib/commercial-analytics-config':{commercialAnalyticsEnvironment:()=> 'preview'},
  mercadopago:{InvalidWebhookSignatureError:InvalidSignature,WebhookSignatureValidator:{validate:({xSignature})=>{if(xSignature!=='valid')throw new InvalidSignature();}}},
};
const env={NODE_ENV:'test',MERCADOPAGO_ACCESS_TOKEN:'mock-only',MERCADOPAGO_WEBHOOK_SECRET:'mock-only'};
function route(name,fetch,extra={}) {return load(`app/api/payments/mercadopago/${name}/route.ts`,{...mocks,...extra},{console:silent,process:{env},fetch});}
function notification(id,type='order',signature='valid') {return {nextUrl:new URL(`https://test.invalid?type=${type}&data.id=${id}`),headers:new Headers({'x-signature':signature,'x-request-id':'test'}),text:async()=>''};}
async function fixture(method='card') {
  const product=randomUUID();await db.query('INSERT INTO products(id,name,slug,price,stock) VALUES($1,$1,$1,100,3)',[product]);
  const id=await scalar("SELECT create_public_order('Test','123','','pickup','','',$1,$2::jsonb,$3)",[method,JSON.stringify([{productId:product,quantity:1}]),randomUUID()]);
  const tx=(await db.query('SELECT * FROM payment_transactions WHERE order_id=$1',[id])).rows[0];
  return {id,tx,product,external:'ORD'+randomUUID().replaceAll('-',''),payment:'PAY'+randomUUID().replaceAll('-','')};
}
function providerOrder(f,reference=f.tx.external_idempotency_key) {return {id:f.external,type:'online',processing_mode:'automatic',external_reference:reference,currency:'ARS',total_amount:'100.00',status:'processed',transactions:{payments:[{id:f.payment,status:'processed',amount:'100.00'}]}};}
const claim=f=>scalar('SELECT begin_mercadopago_request($1)',[f.id]);
async function state(f){return {
  payment:(await db.query('SELECT status,sale_id,external_order_id,external_payment_id,recovery_issue FROM payment_transactions WHERE id=$1',[f.tx.id])).rows[0],
  order:await scalar('SELECT status FROM orders WHERE id=$1',[f.id]),stock:await scalar('SELECT stock FROM products WHERE id=$1',[f.product]),
  sales:await scalar('SELECT count(*)::int FROM sales WHERE id=(SELECT sale_id FROM payment_transactions WHERE id=$1)',[f.tx.id]),
  inventory:await scalar('SELECT count(*)::int FROM inventory_movements WHERE product_id=$1',[f.product]),
  cash:await scalar("SELECT count(*)::int FROM cash_movements WHERE movement_type='sale_income' AND sale_id=(SELECT sale_id FROM payment_transactions WHERE id=$1)",[f.tx.id]),
  postings:(await db.query('SELECT status,reason FROM financial_pending_postings WHERE payment_transaction_id=$1',[f.tx.id])).rows
};}
function endpoint(f,fetch){return route('orders',fetch,{'@/lib/store/buyer-session':{authorizedBuyerOrder:async()=>f.id,isSameOriginWrite:()=>true,buyerNotFound:()=>Response.json({},{status:404})}});}
const payRequest=()=>new Request('https://test.invalid',{method:'POST',body:JSON.stringify({orderNumber:'DCL-900001',token:'mock',payment_method_id:'visa',payment_type:'credit_card',installments:1,payer:{email:'mock@test.invalid'}})});

test('normal endpoint persists binding; repeated endpoint and webhook use GET and one economic receipt',async()=>{
  const f=await fixture(),payload=providerOrder(f);let posts=0,gets=0;
  const fetch=async(_url,init)=>{if(init.method==='POST'){posts++;const body=JSON.parse(init.body);assert.equal(body.external_reference,f.tx.external_idempotency_key);assert.equal(init.headers['X-Idempotency-Key'],f.tx.external_idempotency_key);assert.ok(await scalar('SELECT provider_request_started_at FROM payment_transactions WHERE id=$1',[f.tx.id]));}else gets++;return Response.json(payload);};
  const api=endpoint(f,fetch),hook=route('webhook',fetch);
  assert.equal((await api.POST(payRequest())).status,200);
  assert.equal((await api.POST(payRequest())).status,200);
  for(let n=0;n<3;n++)assert.equal((await hook.POST(notification(f.external))).status,200);
  const actual=await state(f);assert.equal(posts,1);assert.equal(gets,4);
  assert.equal(actual.sales,1);assert.equal(actual.stock,2);assert.equal(actual.inventory,1);assert.equal(actual.cash,1);
  assert.deepEqual(actual.postings,[{status:'posted',reason:'posted'}]);assert.equal(actual.payment.external_order_id,f.external);
});
test('CRITICAL lost response before external ID persistence is recovered by webhook without another charge',async()=>{
  const f=await fixture();let posts=0;
  const api=endpoint(f,async()=>{posts++;throw new Error('provider approved, response lost');});
  assert.equal((await api.POST(payRequest())).status,500);
  let actual=await state(f);assert.equal(actual.payment.external_order_id,null);assert.equal(actual.payment.recovery_issue,'awaiting_provider');
  assert.equal((await api.POST(payRequest())).status,409);assert.equal(posts,1);
  const hook=route('webhook',async(_url,init)=>{assert.equal(init.method,undefined);return Response.json(providerOrder(f));});
  for(let n=0;n<3;n++)assert.equal((await hook.POST(notification(f.external))).status,200);
  actual=await state(f);assert.equal(actual.payment.status,'approved');assert.equal(actual.payment.external_payment_id,f.payment);
  assert.equal(actual.sales,1);assert.equal(actual.inventory,1);assert.equal(actual.stock,2);assert.equal(actual.cash,1);assert.equal(actual.postings.length,1);
});
test('webhook completes while endpoint response is in flight; both converge without a second POST',async()=>{
  const f=await fixture();let posts=0;
  const hook=route('webhook',async()=>Response.json(providerOrder(f)));
  const api=endpoint(f,async()=>{posts++;assert.equal((await hook.POST(notification(f.external))).status,200);return Response.json(providerOrder(f));});
  assert.equal((await api.POST(payRequest())).status,200);
  const actual=await state(f);assert.equal(posts,1);assert.equal(actual.sales,1);assert.equal(actual.inventory,1);assert.equal(actual.cash,1);assert.equal(actual.postings.length,1);
});
test('two request claims cannot both allow a charge',async()=>{
  const f=await fixture();assert.deepEqual(await Promise.all([claim(f),claim(f)]),[true,false]);
});
test('wrong amount, currency, provider flow, operation or payment state cannot bind or complete',async()=>{
  for(const anomaly of ['amount','currency','flow','provider','type','mode','state','multiple','payment_amount']) {
    const f=await fixture(anomaly==='flow'?'mercadopago':'card');if(anomaly!=='flow')await claim(f);
    if(anomaly==='provider')await db.query("UPDATE payment_transactions SET provider='transfer' WHERE id=$1",[f.tx.id]);
    const payload=providerOrder(f);
    if(anomaly==='amount'){payload.total_amount='101';payload.transactions.payments[0].amount='101';}
    if(anomaly==='currency')payload.currency='USD';
    if(anomaly==='type')payload.type='point';
    if(anomaly==='mode')payload.processing_mode='manual';
    if(anomaly==='state')payload.transactions.payments[0].status='pending';
    if(anomaly==='multiple')payload.transactions.payments.push({...payload.transactions.payments[0],id:'other'});
    if(anomaly==='payment_amount')payload.transactions.payments[0].amount='1';
    assert.notEqual((await route('webhook',async()=>Response.json(payload)).POST(notification(f.external))).status,200,anomaly);
    const actual=await state(f);assert.equal(actual.payment.external_order_id,null,anomaly);assert.equal(actual.sales,0);assert.equal(actual.stock,3);assert.equal(actual.cash,0);
  }
});
test('foreign reference/ID, unsigned webhook and forged body never associate another equal-amount order',async()=>{
  const a=await fixture(),b=await fixture();await claim(a);await claim(b);
  const payload=providerOrder(b);
  assert.equal((await endpoint(a,async()=>Response.json(payload)).POST(payRequest())).status,409);
  const helper=load('lib/store/mercadopago-recovery.ts',mocks);
  await assert.rejects(helper.reconcileVerifiedOrder(client,payload,b.external,a.id),/mismatch/);
  const valid=route('webhook',async()=>Response.json(providerOrder(a)));
  assert.equal((await valid.POST(notification(a.external))).status,200);
  payload.id=a.external;payload.transactions.payments[0].id=a.payment;
  const forged=route('webhook',async()=>Response.json(payload));
  assert.equal((await forged.POST(notification(a.external))).status,500);
  assert.equal((await state(b)).sales,0);assert.equal((await state(b)).payment.external_order_id,null);
  assert.equal((await valid.POST(notification(a.external,'order','invalid'))).status,401);
  const mismatch=route('webhook',async()=>Response.json(providerOrder(a)));
  assert.equal((await mismatch.POST(notification(b.external))).status,502);
  assert.equal((await valid.POST({...notification(a.external),text:async()=>JSON.stringify({external_reference:b.id,status:'approved'})})).status,200);
  assert.equal((await state(a)).cash,1);assert.equal((await state(b)).cash,0);
});
test('approved recovery with expired reservation or cancelled order preserves existing incident flow',async()=>{
  for(const cancelled of [false,true]) {
    const f=await fixture();await claim(f);
    if(cancelled)await scalar("SELECT resolve_order($1,'CANCEL_PENDING',NULL,'Local test',$2)",[f.id,randomUUID()]);
    else await db.query("UPDATE inventory_reservations SET expires_at=clock_timestamp()-interval '1 second' WHERE order_id=$1",[f.id]);
    assert.equal((await route('webhook',async()=>Response.json(providerOrder(f))).POST(notification(f.external))).status,200);
    const actual=await state(f);assert.equal(actual.payment.status,'approved');assert.equal(actual.order,cancelled?'refund_required':'stock_unavailable');
    assert.equal(actual.sales,0);assert.equal(actual.stock,3);assert.equal(actual.inventory,0);assert.equal(actual.cash,0);assert.deepEqual(actual.postings,[{status:'pending',reason:'payment_without_sale'}]);
  }
});
test('finance disabled after external charge preserves sale and exactly one A1 pending',async()=>{
  const f=await fixture();await claim(f);await db.exec("UPDATE financial_activation SET activated_at=clock_timestamp()+interval '1 day'");
  try {
    const hook=route('webhook',async()=>Response.json(providerOrder(f)));
    for(let n=0;n<3;n++)assert.equal((await hook.POST(notification(f.external))).status,200);
    const actual=await state(f);assert.equal(actual.sales,1);assert.equal(actual.payment.status,'approved');assert.equal(actual.stock,2);assert.equal(actual.cash,0);assert.deepEqual(actual.postings,[{status:'pending',reason:'finance_not_ready'}]);
  }finally{await db.exec('UPDATE financial_activation SET activated_at=clock_timestamp()');}
});
test('legacy Orders already initiated and country-code-only provider responses remain recoverable',async()=>{
  const f=await fixture();await db.query('UPDATE payment_transactions SET provider_recovery_version=1 WHERE id=$1',[f.tx.id]);
  assert.equal(await claim(f),false);
  let posts=0;assert.equal((await endpoint(f,async()=>{posts++;throw new Error('must not charge legacy');}).POST(payRequest())).status,409);assert.equal(posts,0);
  const payload=providerOrder(f,f.id);delete payload.currency;payload.country_code='AR';
  assert.equal((await route('webhook',async()=>Response.json(payload)).POST(notification(f.external))).status,200);
  assert.equal((await state(f)).cash,1);
});

function proProvider(f,change={}) {
  const payment={id:f.payment,status:'approved',external_reference:f.id,transaction_amount:100,currency_id:'ARS',order:{id:'merchant1',type:'mercadopago'},...change.payment};
  const merchant={id:'merchant1',external_reference:f.id,preference_id:f.external,payments:[{id:f.payment}],...change.merchant};
  const preference={id:f.external,external_reference:f.id,metadata:{local_order_id:f.id,payment_transaction_id:f.tx.id},...change.preference};
  return async(url,init)=>{assert.equal(init.method,undefined);return Response.json(url.includes('/v1/payments/')?payment:url.includes('/merchant_orders/')?merchant:preference);};
}
test('Checkout Pro verifies merchant/preference origin and recovers missing preference binding; legacy metadata optional',async()=>{
  for(const linked of [true,false]) {
    const f=await fixture('mercadopago');if(linked)await db.query('UPDATE payment_transactions SET external_order_id=$1 WHERE id=$2',[f.external,f.tx.id]);
    const hook=route('checkout-pro-webhook',proProvider(f,{preference:linked?{metadata:{}}:{}}));
    for(let n=0;n<3;n++)assert.equal((await hook.POST(notification(f.payment,'payment'))).status,200);
    const actual=await state(f);assert.equal(actual.payment.external_order_id,f.external);assert.equal(actual.cash,1);assert.equal(actual.sales,1);assert.equal(actual.postings.length,1);
  }
});
test('Checkout Pro rejects wrong preference, payment origin, returned ID, reference and absent origin',async()=>{
  for(const change of [{merchant:{preference_id:'foreign'}},{merchant:{payments:[]}},{payment:{id:'foreign'}},{payment:{order:null}},{merchant:{external_reference:randomUUID()}},{preference:{metadata:{payment_transaction_id:randomUUID()}}}]) {
    const f=await fixture('mercadopago');await db.query('UPDATE payment_transactions SET external_order_id=$1 WHERE id=$2',[f.external,f.tx.id]);
    assert.equal((await route('checkout-pro-webhook',proProvider(f,change)).POST(notification(f.payment,'payment'))).status,503);
    const actual=await state(f);assert.equal(actual.sales,0);assert.equal(actual.cash,0);assert.equal(actual.payment.status,'pending');
  }
});
test('commercial failure keeps verified identifiers and retry resolves without another provider POST',async()=>{
  const f=await fixture();await claim(f);
  await db.exec("CREATE FUNCTION fail_a2_sale() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$; CREATE TRIGGER fail_a2_sale BEFORE INSERT ON sales FOR EACH ROW EXECUTE FUNCTION fail_a2_sale()");
  const hook=route('webhook',async()=>Response.json(providerOrder(f)));
  try {assert.equal((await hook.POST(notification(f.external))).status,500);const actual=await state(f);assert.equal(actual.payment.external_order_id,f.external);assert.equal(actual.payment.recovery_issue,'completion_failed');assert.equal(actual.payment.status,'approved');assert.deepEqual(actual.postings,[{status:'pending',reason:'payment_without_sale'}]);assert.equal(actual.stock,3);}
  finally{await db.exec('DROP TRIGGER fail_a2_sale ON sales; DROP FUNCTION fail_a2_sale()');}
  assert.equal((await hook.POST(notification(f.external))).status,200);assert.equal((await state(f)).cash,1);
});
test('recovery RPCs are restricted to service role',async()=>{
  for(const fn of ['begin_mercadopago_request(uuid)','reconcile_mercadopago_payment(uuid,uuid,text,text,text,text,numeric,text,text,text)'])
    for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar("SELECT has_function_privilege($1,$2,'EXECUTE')",[role,fn]),role==='service_role');
  assert.equal(plain(await state(await fixture())).sales,0);
});

test('service_role can claim and recover with actual grants and both A1 deferred triggers',async()=>{
  const f=await fixture();await db.exec('SET ROLE service_role');
  try {
    assert.equal(await claim(f),true);
    assert.equal((await route('webhook',async()=>Response.json(providerOrder(f))).POST(notification(f.external))).status,200);
    assert.equal((await state(f)).cash,1);
  } finally {await db.exec('RESET ROLE');}
});

test('temporarily unavailable real provider order is retried, never acknowledged as recovered',async()=>{
  const hook=route('webhook',async()=>Response.json({message:'not visible yet'},{status:404}));
  assert.equal((await hook.POST(notification('ORD01J49MMW3SSBK5PSV3DFR32959'))).status,502);
});
