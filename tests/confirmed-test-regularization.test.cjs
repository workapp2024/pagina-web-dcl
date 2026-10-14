const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ids,key,preflight,applyExisting}=require('../scripts/maintenance/regularize-confirmed-tests.cjs');
const load=require('./load-ts.cjs');
function fixture(){return {
  admin_profiles:[{id:ids.admin,role:'ADMIN',active:true}],sales:ids.sales.map(id=>({id,status:'completed',total:1,payment_method:id===ids.independent[0]?'cash':'transfer'})),
  sale_items:ids.independent.map((id,index)=>({sale_id:id,product_id:index?ids.retailLupa:ids.retailTest,quantity:1})),payment_transactions:[],
  products:[{id:ids.retailTest,stock:4},{id:ids.retailLupa,stock:9},{id:'real-product',stock:37}],inventory_movements:[],inventory_reservations:[],
  cash_movements:ids.incomes.map((id,index)=>({id,movement_type:'sale_income',amount:1,sale_id:[ids.sales[3],ids.independent[0],ids.sales[5],ids.independent[1]][index]})),financial_periods:[{status:'open'}],
  wholesale_orders:ids.wholesale.map((id,index)=>({id,status:[0,3].includes(index)?'confirmed':'rejected'})),wholesale_order_revision_items:[],
  wholesale_deliveries:[{id:ids.delivery,order_id:ids.deliveredOrder}],wholesale_delivery_corrections:[],wholesale_physical_returns:[],wholesale_inventory_movements:[],
  wholesale_payment_entries:[{id:ids.payment,order_id:ids.deliveredOrder,entry_type:'payment',amount:78446,currency:'ARS',payment_method:'cash'}],
  wholesale_sale_recognitions:[{id:ids.recognition,amount:78446}],wholesale_sale_reversals:[],wholesale_financial_postings:[{payment_entry_id:ids.payment,status:'pending_mapping'}],
  wholesale_financial_account_mappings:[{payment_method:'cash',account_id:null}],warranties:[],installations:[],
};}
test('regularization refuses new money, linked independent sales, changed stock scope and mapped cash',()=>{
  const original=fixture();assert.equal(preflight(original),original);
  for(const mutate of [s=>s.cash_movements.push({movement_type:'income',amount:50}),s=>s.payment_transactions.push({sale_id:ids.independent[0]}),s=>s.sale_items[0].product_id='real-product',s=>s.wholesale_financial_account_mappings[0].account_id='cash']){
    const s=fixture();mutate(s);assert.throws(()=>preflight(s));
  }
});
test('finance mapping cannot replay the known fictitious payment before explicit neutralization',async()=>{
  let status='pending_mapping';let calls=0;
  const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:{status},error:null})};
  const {POST}=load('app/api/admin/finances/route.ts',{
    '@/lib/admin-auth':{isAdminAuthenticated:async()=>true,getAdminIdentity:async()=>({id:ids.admin,role:'ADMIN'})},
    '@/lib/rate-limit':{rateLimit:()=>null},
    '@/lib/supabase/server':{isServiceRoleConfigured:()=>true,createAdminServerClient:()=>({from:()=>query,rpc:async()=>{calls++;return {error:null};}})},
  });
  const request=()=>new Request('https://test.invalid',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'map_wholesale_method',paymentMethod:'cash',accountId:'cash'})});
  assert.equal((await POST(request())).status,409);assert.equal(calls,0);
  status='neutralized_test_pair';assert.equal((await POST(request())).status,200);assert.equal(calls,1);
});
test('existing runner is resumable, adjusts only finished product scopes and never maps or refunds externally',async()=>{
  const s=fixture();const calls=[];
  const db={from(table){return {select(){return {range:async()=>({data:structuredClone(s[table]||[]),error:null})};},insert:async row=>{assert.equal(table,'inventory_movements');s[table].push(row);s.products.find(p=>p.id===row.product_id).stock+=row.quantity_delta;return {error:null};}};},rpc:async(name,p)=>{
    calls.push(name);switch(name){
      case 'cancel_sale_with_reversal':{
        s.sales.find(a=>a.id===p.p_sale_id).status='cancelled';const item=s.sale_items.find(a=>a.sale_id===p.p_sale_id);s.products.find(a=>a.id===item.product_id).stock++;
        s.inventory_movements.push({reference_type:'sale_reversal',reference_id:p.p_sale_id});s.cash_movements.push({sale_id:p.p_sale_id,movement_type:'sale_reversal',amount:-1});break;}
      case 'record_wholesale_delivery_correction':
        s.wholesale_delivery_corrections.push({idempotency_key:p.p_key});s.wholesale_sale_reversals.push({recognition_id:ids.recognition,amount:78446});s.wholesale_inventory_movements.push({id:'correction',product_id:ids.wholesaleProduct,on_hand_delta:1,reserved_delta:1});break;
      case 'close_wholesale_order':
        s.wholesale_orders.find(o=>o.id===p.p_order).status='cancelled';if(p.p_order===ids.deliveredOrder)s.wholesale_inventory_movements.push({id:'release',product_id:ids.wholesaleProduct,on_hand_delta:0,reserved_delta:-1});break;
      case 'refund_wholesale_payment':
        s.wholesale_payment_entries.push({refund_of:ids.payment,entry_type:'refund',amount:78446,payment_method:'cash',idempotency_key:p.p_key});s.wholesale_financial_postings.push({status:'pending_mapping'});break;
      case 'record_wholesale_stock_movement':
        s.wholesale_inventory_movements.push({id:'adjustment',idempotency_key:p.p_key,product_id:p.p_product_id,on_hand_delta:p.p_quantity,reserved_delta:0});break;
      default:assert.fail(name);
    }return {error:null,data:'ok'};
  }};
  const plan={refundAt:'2026-10-12T16:00:00Z'};await applyExisting(db,plan,async()=>{});const count=calls.length;
  await applyExisting(db,plan,async()=>{});assert.equal(calls.length,count);
  assert.equal(s.products.find(p=>p.id===ids.retailTest).stock,5);assert.equal(s.products.find(p=>p.id===ids.retailLupa).stock,0);assert.equal(s.products.find(p=>p.id==='real-product').stock,37);
  assert.equal(s.cash_movements.reduce((n,m)=>n+m.amount,0),2);
  assert.equal(s.wholesale_inventory_movements.reduce((n,m)=>n+m.on_hand_delta,0),0);
  assert.equal(s.wholesale_inventory_movements.reduce((n,m)=>n+m.reserved_delta,0),0);
  assert.equal(s.wholesale_payment_entries.length,2);assert.equal(s.wholesale_financial_account_mappings[0].account_id,null);
  assert.equal(key('refund'),key('refund'));
});
