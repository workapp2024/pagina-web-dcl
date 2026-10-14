// Narrow, resumable runner. No new migration, external refund, account mapping,
// delivered-retail reversal, or adjustment of Product prueba 1 is executed here.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const reason = 'Regularización inicial de datos de prueba autorizada por administrador';
const ids = {
  admin: '53197e5a-3bb8-4589-bb9e-596fb5cb6574',
  independent: ['8cc24ca5-b618-4cd0-b5f3-9ef8f233250a', '49a5d8de-9ccb-4172-a54a-c3e2f1abb31e'],
  sales: ['8d505ad0-7d96-4d3f-923c-3652225285ef', '441dda5d-f78b-43e1-b195-021a9d815963', 'ab65f6f8-5f0a-4aa7-9db0-71319b4b0dd8', '82111eb9-6472-4d00-8364-443819b65583', '8cc24ca5-b618-4cd0-b5f3-9ef8f233250a', 'a78def9b-cdd2-49e7-ad1c-746ae035e278', '49a5d8de-9ccb-4172-a54a-c3e2f1abb31e'],
  wholesale: ['4e91e75d-6e89-44bc-a50a-f104c6919851', 'efbf28dd-3ceb-4ab9-8fbc-ea11657518f3', 'b1a91f1a-ac50-4a89-97af-952019c7e13e', 'bd6ddd6a-b8df-4402-96f9-b039dca0aa93'],
  deliveredOrder: 'bd6ddd6a-b8df-4402-96f9-b039dca0aa93',
  delivery: 'bc3d4788-3fd2-4055-b542-0c97018b5684',
  recognition: 'b8383bfe-b2a9-423c-ae66-12a629702c62',
  payment: 'dc6124a6-d680-4edf-9384-777803e5ad03',
  retailTest: 'producto-1790288673630', retailLupa: 'producto-1790731943415', wholesaleProduct: 'producto-1788919384672',
  incomes: ['2f1e0f74-b9da-41ff-a6bc-2ec58d8e280f', '84ceedbd-b661-4a51-ab58-5d990e8d3f8f', 'e84df70e-74f6-4a62-923f-f5c2be5a6084', '7d4a6b51-d4e1-4950-9db5-3bfb3e6a3c65'],
};
function key(label) { const h = createHash('sha256').update('DCL-confirmed-test-regularization-v1:' + label).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; }
function ensure(condition, message) { if (!condition) throw new Error(message); }
const tables = ['admin_profiles','sales','sale_items','payment_transactions','products','inventory_movements','inventory_reservations','cash_movements','financial_periods','wholesale_orders','wholesale_order_revision_items','wholesale_deliveries','wholesale_delivery_corrections','wholesale_physical_returns','wholesale_inventory_movements','wholesale_payment_entries','wholesale_sale_recognitions','wholesale_sale_reversals','wholesale_financial_postings','wholesale_financial_account_mappings','warranties','installations'];
async function snapshot(db) {
  const result = {};
  for (const table of tables) {
    let rows = [];
    for (let offset=0; ; offset+=1000) {
      const columns = table === 'admin_profiles' ? 'id,role,active' : table === 'products' ? 'id,name,stock' : '*';
      const {data,error} = await db.from(table).select(columns).range(offset,offset+999);
      if (error) throw new Error(`SELECT ${table}: ${error.code}`);
      rows.push(...data); if(data.length<1000) break;
    }
    result[table]=rows;
  }
  return result;
}
function preflight(s) {
  ensure(s.admin_profiles.some(a=>a.id===ids.admin && a.role==='ADMIN' && a.active), 'ADMIN no disponible');
  ensure(s.sales.length===7 && s.sales.every(a=>ids.sales.includes(a.id) && Number(a.total)===1 && ['completed','cancelled'].includes(a.status)), 'Ventas nuevas o distintas: detener');
  ensure(s.wholesale_orders.length===4 && s.wholesale_orders.every(o=>ids.wholesale.includes(o.id)), 'Pedidos mayoristas nuevos: detener');
  ensure(s.cash_movements.every(m=>m.movement_type==='opening_balance' ? Number(m.amount)===0 : ids.incomes.includes(m.id) && Number(m.amount)===1 && m.movement_type==='sale_income' || m.movement_type==='sale_reversal' && ids.sales.includes(m.sale_id) && Number(m.amount)===-1), 'Movimientos financieros ajenos: detener');
  ensure(s.financial_periods.length===1 && s.financial_periods[0].status==='open', 'Período financiero cambió');
  ensure(s.wholesale_financial_account_mappings.find(m=>m.payment_method==='cash')?.account_id===null, 'No se permite imputar el cobro ficticio');
  const payment=s.wholesale_payment_entries.find(p=>p.id===ids.payment);
  ensure(payment && payment.order_id===ids.deliveredOrder && payment.entry_type==='payment' && Number(payment.amount)===78446 && payment.currency==='ARS' && payment.payment_method==='cash', 'Cobro mayorista distinto');
  ensure(s.wholesale_payment_entries.every(p=>p.id===ids.payment || p.refund_of===ids.payment && p.entry_type==='refund' && Number(p.amount)===78446 && p.payment_method==='cash' && p.idempotency_key===key('refund')), 'Cobros ajenos o contrarregistro distinto');
  ensure(s.wholesale_financial_postings.every(p=>!p.cash_movement_id && !p.posted_at && p.status==='pending_mapping'), 'Imputación mayorista ya procesada: detener');
  for(const saleId of ids.independent) {
    const sale=s.sales.find(x=>x.id===saleId); const items=s.sale_items.filter(i=>i.sale_id===saleId);
    ensure(sale && !s.payment_transactions.some(p=>p.sale_id===saleId), 'Venta independiente ahora vinculada');
    ensure(items.length===1 && items[0].quantity===1 && items[0].product_id===(saleId===ids.independent[0]?ids.retailTest:ids.retailLupa), 'Ítems independientes distintos');
    ensure(sale.payment_method===(saleId===ids.independent[0]?'cash':'transfer'), 'Medio minorista distinto');
    const original=s.cash_movements.filter(m=>m.sale_id===saleId && m.movement_type==='sale_income');
    ensure(original.length===1 && ids.incomes.includes(original[0].id) && Number(original[0].amount)===1, 'Ingreso minorista original distinto');
  }
  ensure(!s.inventory_reservations.some(r=>r.status==='active' && [ids.retailTest,ids.retailLupa].includes(r.product_id)), 'Reserva minorista activa');
  const delivery=s.wholesale_deliveries.find(d=>d.id===ids.delivery);
  ensure(delivery?.order_id===ids.deliveredOrder, 'Entrega original distinta');
  ensure(s.wholesale_sale_recognitions.length===1 && s.wholesale_sale_recognitions[0].id===ids.recognition && Number(s.wholesale_sale_recognitions[0].amount)===78446, 'Reconocimiento distinto');
  ensure(!s.wholesale_physical_returns.length, 'Devolución física existente: revisar');
  return s;
}
function stock(s,product) { const rows=s.wholesale_inventory_movements.filter(m=>m.product_id===product); return {physical:rows.reduce((n,m)=>n+m.on_hand_delta,0),reserved:rows.reduce((n,m)=>n+m.reserved_delta,0)}; }
function verifyUnrelated(before,after) {
  for(const p of before.products) if(![ids.retailTest,ids.retailLupa].includes(p.id)) ensure(after.products.find(a=>a.id===p.id)?.stock===p.stock, `Stock minorista ajeno cambió: ${p.id}`);
  for(const m of after.wholesale_inventory_movements) if(!before.wholesale_inventory_movements.some(a=>a.id===m.id)) ensure(m.product_id===ids.wholesaleProduct,'Movimiento mayorista ajeno');
}
async function applyExisting(db, plan, save) {
  const before=preflight(await snapshot(db)); await save('before',before);
  const rpc=async(name,args)=>{const {data,error}=await db.rpc(name,args);if(error)throw new Error(`${name}: ${error.message}`);return data;};
  const read=async label=>{const s=preflight(await snapshot(db));verifyUnrelated(before,s);await save(label,s);return s;};
  for(const id of ids.independent) {
    const s=await read('pre-sale-'+id);
    if(s.sales.find(a=>a.id===id).status!=='cancelled') await rpc('cancel_sale_with_reversal',{p_sale_id:id,p_reason:reason});
    const after=await read('post-sale-'+id);
    ensure(after.sales.find(a=>a.id===id).status==='cancelled','Venta no anulada');
    ensure(after.inventory_movements.filter(m=>m.reference_type==='sale_reversal' && m.reference_id===id).length===1,'Restitución duplicada o faltante');
    ensure(after.cash_movements.filter(m=>m.sale_id===id && m.movement_type==='sale_reversal').length===1,'Reversión financiera faltante');
  }
  let s=await read('pre-wholesale');
  const correction=s.wholesale_delivery_corrections.find(c=>c.idempotency_key===key('delivery-correction'));
  ensure(!s.wholesale_delivery_corrections.some(c=>c.idempotency_key!==key('delivery-correction')),'Corrección ajena existente');
  if(!correction) await rpc('record_wholesale_delivery_correction',{p_order:ids.deliveredOrder,p_delivery:ids.delivery,p_items:[{productId:ids.wholesaleProduct,quantity:1}],p_reason:reason,p_key:key('delivery-correction'),p_actor:ids.admin});
  s=await read('post-delivery-correction');
  ensure(s.wholesale_sale_reversals.length===1 && s.wholesale_sale_reversals[0].recognition_id===ids.recognition && Number(s.wholesale_sale_reversals[0].amount)===78446,'Reconocimiento no compensado');
  for(const order of [ids.wholesale[0],ids.deliveredOrder]) {
    s=await read('pre-close-'+order);
    ensure(['confirmed','cancelled'].includes(s.wholesale_orders.find(o=>o.id===order)?.status),'Estado mayorista distinto');
    if(s.wholesale_orders.find(o=>o.id===order).status!=='cancelled') await rpc('close_wholesale_order',{p_order:order,p_action:'cancel',p_actor:ids.admin,p_internal_note:reason});
    await read('post-close-'+order);
  }
  s=await read('pre-refund');
  if(!s.wholesale_payment_entries.some(p=>p.idempotency_key===key('refund'))) await rpc('refund_wholesale_payment',{p_payment:ids.payment,p_amount:78446,p_method:'cash',p_external_reference:'DCL-TEST-REGULARIZATION-MW-000004',p_occurred_at:plan.refundAt,p_key:key('refund'),p_actor:ids.admin});
  s=await read('post-refund');
  ensure(s.wholesale_payment_entries.reduce((n,p)=>n+Number(p.amount)*(p.entry_type==='refund'?-1:1),0)===0,'Cobro neto distinto de cero');
  // LUPA has no blocked linked sales. The other retail product must wait for its five delivered reversals.
  const adjustmentId=key('retail-lupa-zero');
  if(!s.inventory_movements.some(m=>m.id===adjustmentId)) {
    ensure(s.products.find(p=>p.id===ids.retailLupa)?.stock===10,'Stock LUPA no coincide con 9 + 1');
    const {error}=await db.from('inventory_movements').insert({id:adjustmentId,product_id:ids.retailLupa,movement_type:'ajuste',quantity_delta:-10,reason,reference_type:'initial_test_regularization',reference_id:ids.independent[1]});
    if(error)throw new Error(`Ajuste LUPA: ${error.code}`);
  }
  s=await read('post-lupa-zero');ensure(s.products.find(p=>p.id===ids.retailLupa)?.stock===0,'LUPA no está en cero');
  if(!s.wholesale_inventory_movements.some(m=>m.idempotency_key===key('wholesale-zero'))) {
    const balance=stock(s,ids.wholesaleProduct);ensure(balance.physical===1 && balance.reserved===0,'Stock IR no coincide con restitución');
    await rpc('record_wholesale_stock_movement',{p_product_id:ids.wholesaleProduct,p_movement_type:'adjustment',p_quantity:-1,p_reason:reason,p_key:key('wholesale-zero'),p_actor:ids.admin});
  }
  s=await read('after');ensure(stock(s,ids.wholesaleProduct).physical===0 && stock(s,ids.wholesaleProduct).reserved===0,'IR no está en cero');return s;
}
module.exports={ids,key,reason,preflight,stock,verifyUnrelated,applyExisting,snapshot};
if(require.main===module) (async()=>{
  require('@next/env').loadEnvConfig(process.cwd(),true,{info(){},error(){}});
  const db=require('@supabase/supabase-js').createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const root=path.resolve('.local-test-regularization');fs.mkdirSync(root,{recursive:true});
  const planFile=path.join(root,'plan.json');let plan;
  if(fs.existsSync(planFile))plan=JSON.parse(fs.readFileSync(planFile,'utf8'));else {plan={refundAt:new Date().toISOString()};fs.writeFileSync(planFile,JSON.stringify(plan,null,2));}
  const save=async(label,s)=>{const file=path.join(root,label+'.json');if(label==='before' && fs.existsSync(file))return;fs.writeFileSync(file,JSON.stringify(s,null,2));};
  const s=process.argv.includes('--apply-existing')?await applyExisting(db,plan,save):preflight(await snapshot(db));
  console.log(JSON.stringify({mode:process.argv.includes('--apply-existing')?'applied-existing':'SELECT-only',sales:s.sales.map(a=>({id:a.id,status:a.status})),wholesale:s.wholesale_orders.map(a=>({id:a.id,status:a.status})),cash:s.cash_movements.reduce((n,m)=>n+Number(m.amount),0),retailStock:s.products.filter(p=>[ids.retailTest,ids.retailLupa].includes(p.id)),wholesaleStock:stock(s,ids.wholesaleProduct),pending:s.wholesale_financial_postings.map(p=>({id:p.payment_entry_id,status:p.status})),installation:s.installations.map(i=>({id:i.id,status:i.status,completed_at:i.completed_at}))},null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
