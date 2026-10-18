const {test}=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const load=require('./load-ts.cjs');
const {customerPaymentSummary}=load('lib/wholesale-customer-payment.ts');
test('customer balances support partial/full receipts, cancellation and currency uncertainty without creating payments',()=>{
  const p=n=>({entry_type:'payment',amount:n,currency:'ARS'});
  assert.equal(customerPaymentSummary('confirmed',100,'ARS',[]).canPay,true);
  const partial=customerPaymentSummary('confirmed',100,'ARS',[p(40)]);assert.equal(partial.due,60);assert.equal(partial.state,'Parcial');
  assert.equal(customerPaymentSummary('confirmed',100,'ARS',[p(40),p(60)]).canPay,false);
  assert.equal(customerPaymentSummary('cancelled',100,'ARS',[]).canPay,false);
  assert.equal(customerPaymentSummary('rejected',100,'ARS',[]).canPay,false);
  assert.equal(customerPaymentSummary('confirmed',100,'ARS',[{...p(40),currency:'USD'}]),null);
});
test('client payment view offers continuation only for a confirmed outstanding balance and no automatic checkout',()=>{
  const {WholesaleOrderPayment}=load('components/wholesale/WholesaleOrderPayment.tsx',{react:{useState:initial=>[initial,()=>{}],useEffect(){}}});
  function render(status,paid){return renderToStaticMarkup(React.createElement(WholesaleOrderPayment,{order:{id:'o',order_number:'MW-1',currency:'ARS',status,payment_summary:customerPaymentSummary(status,100,'ARS',paid?[{entry_type:'payment',amount:paid,currency:'ARS'}]:[])}}));}
  assert.match(render('confirmed',40),/Continuar al pago/);assert.match(render('confirmed',40),/60,00/);
  assert.match(render('confirmed',100),/Pago completo/);assert.doesNotMatch(render('confirmed',100),/Continuar al pago/);
  assert.doesNotMatch(render('cancelled',0),/Continuar al pago/);
});
test('payment instructions are session-owned, freshly calculated and strictly read-only',async()=>{
  let customer=null,owned=true;const reads=[];
  const {GET}=load('app/api/wholesale/orders/[id]/payment/route.ts',{
    '@/lib/wholesale-server':{getWholesaleSessionCustomerId:async()=>customer},
    '@/lib/supabase/server':{createAdminServerClient:()=>({from(table){const q={select:()=>q,eq(key,value){reads.push([table,key,value]);return q;},in:()=>q,order:()=>q,range:async()=>({data:[{order_id:'o',entry_type:'payment',amount:40,currency:'ARS'}],error:null}),maybeSingle:async()=>({data:table==='wholesale_orders'?(owned?{id:'o',order_number:'MW-1',current_revision_id:'v',status:'confirmed'}:null):{transfer_alias:'configured.alias',transfer_holder:'Titular de prueba',transfer_cbu_cvu:'',transfer_institution:'Mercado Pago',transfer_instructions:'Enviar comprobante',whatsapp:''},error:null}),single:async()=>({data:{total_amount:100,currency:'ARS'},error:null})};return q;},rpc(){throw Error('No writes');}})},
  });
  const request=new Request('https://dcl.test'),context={params:Promise.resolve({id:'11111111-1111-4111-8111-111111111111'})};
  assert.equal((await GET(request,context)).status,401);assert.equal(reads.length,0);
  customer='customer-session';owned=false;assert.equal((await GET(request,context)).status,404);
  owned=true;const response=await GET(request,context);assert.equal(response.status,200);const data=await response.json();assert.equal(data.summary.due,60);assert.equal(data.transfer.alias,'configured.alias');
  assert.ok(reads.some(([table,key,value])=>table==='wholesale_orders'&&key==='customer_id'&&value===customer));
  assert.match(response.headers.get('cache-control'),/no-store/);
});
test('shared account withdrawal explains the exact test discrepancy without hiding negatives or modifying sector receipts',()=>{
  const {buildSectorCash}=load('lib/finance-sector-cash.ts');
  const row=(id,amount,extra)=>({id,amount,account_id:'mercadopago',occurred_at:'2026-10-18T02:07:37Z',description:'Prueba',...extra});
  const cash=buildSectorCash([row('retail',13300,{sale_id:'s',movement_type:'sale_income'}),row('wholesale',29998,{wholesale_payment_entry_id:'p',movement_type:'income'}),row('withdrawal',-29998,{movement_type:'cash_withdrawal'})]);
  assert.equal(cash.minoristas.available,13300);assert.equal(cash.mayoristas.available,29998);assert.equal(cash.unassigned.available,-29998);assert.equal(cash.total,13300);assert.equal(cash.attributionNeedsReview,true);
});
test('confirmed states are green, received neutral and cancellation red with accessible chronology text',()=>{
  const {commercialStateClass}=load('lib/wholesale-order-summary.ts');
  assert.match(commercialStateClass('confirmed'),/emerald/);assert.doesNotMatch(commercialStateClass('received'),/amber|red/);assert.match(commercialStateClass('cancelled'),/red/);
  const {WholesaleOrderTracking}=load('components/wholesale/WholesaleOrderTracking.tsx');
  const html=renderToStaticMarkup(React.createElement(WholesaleOrderTracking,{outcome:'confirmed',events:[{id:'1',label:'Recibido'},{id:'2',label:'Confirmado'}]}));
  assert.match(html,/Paso completado/);assert.match(html,/Último estado registrado/);assert.doesNotMatch(html,/bg-red/);
});

test('proposed withdrawal classification preserves date, amount and all cash rows with one audit',async()=>{
  const fs=require('node:fs'),{randomUUID}=require('node:crypto');const db=await require('./database.cjs')();
  try {
    await db.exec(fs.readFileSync('scripts/maintenance/proposed-block3-sector-finances.sql','utf8'));
    const actor=randomUUID();await db.query('INSERT INTO auth.users(id) VALUES($1)',[actor]);
    await db.query("INSERT INTO admin_profiles(id,email,display_name,role,active) VALUES($1,'polish@test.invalid','Admin','ADMIN',true)",[actor]);
    await db.query('SELECT activate_finances(0,0,$1)',[randomUUID()]);
    await db.query("SELECT record_sector_finance('income','mercadopago',29998,NULL,'mayoristas',clock_timestamp(),'Prueba','Fondos de prueba',$1,$2)",[actor,randomUUID()]);
    const target=(await db.query("SELECT record_financial_movement('cash_withdrawal',-29998,'Retiro de prueba','mercadopago',$1) id",[randomUUID()])).rows[0].id;
    const original=(await db.query('SELECT to_jsonb(c) original FROM cash_movements c WHERE id=$1',[target])).rows[0].original;
    const proposal=fs.readFileSync('scripts/maintenance/proposed-correct-test-withdrawal-29998.sql','utf8').replaceAll('5b87e40f-f4c8-4897-a83a-2e1b271dddc1',target).replace('2026-10-18T02:07:37.679887+00:00',original.occurred_at);
    await db.query("SELECT set_config('dcl.authorized_actor',$1,false),set_config('dcl.correction_sector','mayoristas',false),set_config('dcl.correction_at',clock_timestamp()::text,false)",[actor]);
    await db.exec(proposal);await db.exec(proposal);
    assert.deepEqual((await db.query('SELECT to_jsonb(c) original FROM cash_movements c WHERE id=$1',[target])).rows[0].original,original);
    assert.equal(Number((await db.query("SELECT sum(amount) total FROM cash_movements WHERE account_id='mercadopago'")).rows[0].total),0);
    const {buildSectorCash}=load('lib/finance-sector-cash.ts');const summary=buildSectorCash((await db.query('SELECT * FROM cash_movements')).rows,(await db.query('SELECT * FROM financial_sector_allocations')).rows);
    assert.equal(summary.mayoristas.available,0);assert.equal(summary.unassigned.available,0);assert.equal(summary.total,0);
    assert.equal(Number((await db.query("SELECT count(*) n FROM financial_sector_operations WHERE action='reclassify'")).rows[0].n),1);
  } finally {await db.close();}
});
