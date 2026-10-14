// PREPARED, NOT RUN. Does not apply SQL. Requires both proposed migrations to
// and concurrency protection to be separately approved/applied, installed
// definitions compared, backup restore verified, and execution authorized.
const fs=require('node:fs');
const path=require('node:path');
const {ids,key,snapshot,stock,verifyUnrelated}=require('./regularize-confirmed-tests.cjs');
const orders=['3b02118b-cc18-48fb-ae72-f05893a080db','8d2bf8fe-8590-4a71-933e-e916eb87977e','bfa2aad5-ca81-4873-8741-1e38284f44cb','3622b1fa-899b-4a01-b275-cf4bfd920c6a','3fc59d89-b010-424f-bab6-aa786684f131'];
function ensure(ok,message){if(!ok)throw new Error(message);}
async function complete(db,baseline,save){
  async function read(label){const s=await snapshot(db);verifyUnrelated(baseline,s);
    ensure(s.sales.length===7 && s.sales.every(a=>ids.sales.includes(a.id)&&Number(a.total)===1),'Ventas nuevas o diferentes');
    ensure(s.wholesale_orders.length===4 && s.wholesale_orders.every(o=>ids.wholesale.includes(o.id)),'Pedidos nuevos o diferentes');
    ensure(s.cash_movements.every(m=>m.movement_type==='opening_balance'?Number(m.amount)===0:ids.incomes.includes(m.id)&&Number(m.amount)===1||m.movement_type==='sale_reversal'&&ids.sales.includes(m.sale_id)&&Number(m.amount)===-1),'Dinero ajeno a las pruebas');
    ensure(s.wholesale_payment_entries.length===2 && s.wholesale_payment_entries.every(p=>p.id===ids.payment||p.refund_of===ids.payment&&p.idempotency_key===key('refund')),'Par mayorista cambió');
    ensure(!s.inventory_reservations.some(r=>r.status==='active'&&[ids.retailTest,ids.retailLupa].includes(r.product_id)),'Reservas activas');
    await save(label,s);return s;
  }
  for(const table of ['confirmed_test_reversals','confirmed_test_installation_invalidations','confirmed_test_wholesale_neutralizations']){const r=await db.from(table).select('*').limit(1);ensure(!r.error,`Falta propuesta aprobada/aplicada: ${table}`);}
  const rpc=async(name,args)=>{const r=await db.rpc(name,args);if(r.error)throw new Error(`${name}: ${r.error.message}`);return r.data;};
  await read('completion-before');
  for(const order of orders){await rpc('regularize_confirmed_delivered_test',{p_order:order,p_actor:ids.admin,p_key:key('delivered-'+order)});await read('completed-'+order);}
  await rpc('invalidate_confirmed_test_installation',{p_actor:ids.admin,p_key:key('installation')});
  let s=await read('completion-pre-stock');
  ensure(s.sales.every(a=>a.status==='cancelled'),'Quedan ventas sin revertir');
  const adjustmentId=key('retail-test-zero');
  if(!s.inventory_movements.some(m=>m.id===adjustmentId)){
    ensure(s.products.find(p=>p.id===ids.retailTest)?.stock===10,'Stock esperado distinto de 5 + 5');
  }
  await rpc('zero_confirmed_test_stock',{p_actor:ids.admin,p_key:adjustmentId});
  await rpc('neutralize_confirmed_test_wholesale_pair',{p_actor:ids.admin,p_key:key('neutralize-wholesale')});
  s=await read('completion-pre-mapping');
  ensure(s.wholesale_financial_postings.length===2 && s.wholesale_financial_postings.every(p=>p.status==='neutralized_test_pair'&&!p.cash_movement_id),'Imputaciones no neutralizadas');
  await rpc('map_confirmed_test_cash_safely',{p_actor:ids.admin});
  s=await read('completion-after');
  ensure(s.cash_movements.reduce((n,m)=>n+Number(m.amount),0)===0,'Caja no está en cero');
  ensure([ids.retailTest,ids.retailLupa].every(id=>s.products.find(p=>p.id===id)?.stock===0),'Stock minorista no está en cero');
  ensure(stock(s,ids.wholesaleProduct).physical===0&&stock(s,ids.wholesaleProduct).reserved===0,'Stock mayorista no está en cero');
  ensure(s.warranties.every(w=>w.status==='void'),'Garantías sin invalidar');
  ensure(s.installations.length===1&&s.installations[0].status==='cancelled'&&s.installations[0].completed_at===baseline.installations[0].completed_at,'Instalación o fecha alterada');
  return s;
}
module.exports={complete,orders};
if(require.main===module)(async()=>{
  if(!process.argv.includes('--execute-after-approved-migrations'))throw new Error('NO EJECUTADO: autorización adicional y migraciones aprobadas requeridas.');
  require('@next/env').loadEnvConfig(process.cwd(),true,{info(){},error(){}});
  const db=require('@supabase/supabase-js').createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const root=path.resolve('.local-test-regularization');const baseline=JSON.parse(fs.readFileSync(path.join(root,'before.json'),'utf8'));
  const s=await complete(db,baseline,async(label,s)=>fs.writeFileSync(path.join(root,label+'.json'),JSON.stringify(s,null,2)));
  console.log(JSON.stringify({salesCancelled:s.sales.length,cash:0,authorizedStock:0,installationInvalidated:true,unrelatedStockVerified:true},null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
