import { sectorFinancePreparedEnabled } from "@/lib/prepared-finance-features";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getAdminIdentity, isAdminAuthenticated } from "@/lib/admin-auth";
import { apiError, apiInternalError, boundedString, isUuid, readJsonObject } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import { buildWholesaleFinanceReadModel } from "@/lib/wholesale-finance-read-model.cjs";
import { buildSectorCash, type CashAllocation } from "@/lib/finance-sector-cash";

async function fetchAllRows(query: any) {
  const rows: any[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

function isWholesaleSchemaMissing(error: any) {
  return ["42P01", "PGRST200", "PGRST205"].includes(error?.code)
    || /wholesale_[a-z_]+.*(does not exist|schema cache)/i.test(error?.message || "");
}

async function guard() { if (!(await isAdminAuthenticated())) return apiError("UNAUTHORIZED", "No autorizado.", 401); if (!isServiceRoleConfigured()) return apiError("CONFIGURATION_ERROR", "La administración no está configurada.", 503); return null; }

export async function GET(request: Request) {
  const blocked = await guard(); if (blocked) return blocked;
  try {
    const p = new URL(request.url).searchParams, db: any = createAdminServerClient();
    const [{data:accounts,error:ae},{data:periods,error:pe},{data:products,error:pre},{data:activation,error:ace}] = await Promise.all([
      db.from("financial_accounts").select("id,name,account_type,active,sort_order,updated_at").order("sort_order"),
      db.from("financial_periods").select("id,name,starts_at,ends_at,status").order("starts_at",{ascending:false}),
      db.from("products").select("stock,cost_price,price"),
      db.from("financial_activation").select("activated_at,initial_period_id").eq("singleton",true).maybeSingle(),
    ]);
    if(ae||pe||pre||ace)return apiError("CONFIGURATION_ERROR","Aplicá la migración financiera pendiente para usar este módulo.",503);
    if(!activation)return NextResponse.json({ok:true,data:{activated:false,accounts:(accounts||[]).filter((a:any)=>a.active).map((a:any)=>({...a,balance:0})),accountManagement:accounts||[],periods:[]}});
    const selected=(periods||[]).find((x:any)=>x.id===p.get("periodId"))||(periods||[]).find((x:any)=>x.status==="open")||periods?.[0];
    if(!selected)return apiError("CONFIGURATION_ERROR","No existe un período financiero.",503);
    let sq=db.from("sales").select("id,total,status,payment_method,created_at").gte("created_at",selected.starts_at).order("created_at",{ascending:false}); if(selected.ends_at)sq=sq.lte("created_at",selected.ends_at);
    const sales=await fetchAllRows(sq);const completed=sales.filter((s:any)=>s.status==="completed"),ids=completed.map((s:any)=>s.id);
    const itemBatches=await Promise.all(Array.from({length:Math.ceil(ids.length/500)},(_,index)=>
      fetchAllRows(db.from("sale_items").select("sale_id,quantity,unit_cost").in("sale_id",ids.slice(index*500,(index+1)*500)))
    ));const items=itemBatches.flat();
    let mq=db.from("cash_movements").select("id,movement_type,amount,description,occurred_at,sale_id,account_id,period_id,transfer_id,wholesale_payment_entry_id").eq("period_id",selected.id).order("occurred_at",{ascending:false}).limit(1000);
    const accountId=boundedString(p.get("accountId"),40),movementType=boundedString(p.get("movementType"),32),from=p.get("from"),to=p.get("to");if(accountId)mq=mq.eq("account_id",accountId);if(movementType&&!movementType.startsWith("wholesale_"))mq=mq.eq("movement_type",movementType);if(from&&!Number.isNaN(Date.parse(from)))mq=mq.gte("occurred_at",from);if(to&&!Number.isNaN(Date.parse(to)))mq=mq.lte("occurred_at",/^\d{4}-\d{2}-\d{2}$/.test(to)?`${to}T23:59:59.999Z`:to);
    const {data:movements,error:me}=await mq;if(me)throw new Error(me.message);
    let wholesale: any = { available: false, activity: [], receivables: [] };
    const cashMetadata = new Map<string, {payment_method: string; order_number?: string; reversal_of_id?: string | null}>();
    const wholesalePeriod = { id: selected.id, starts_at: selected.starts_at, ends_at: selected.ends_at };
    try {
      const [orders, payments, recognitions, reversals, reconciliationEvents, journals, customers, accountMappings, financialPostings] = await Promise.all([
        fetchAllRows(db.from("wholesale_orders").select("id,order_number,customer_id,confirmed_revision_id,status")),
        fetchAllRows(db.from("wholesale_payment_entries").select("id,order_id,revision_id,entry_type,refund_of,amount,currency,payment_method,external_reference,occurred_at,actor_id")),
        fetchAllRows(db.from("wholesale_sale_recognitions").select("id,order_id,revision_id,amount,currency,recognized_at")),
        fetchAllRows(db.from("wholesale_sale_reversals").select("id,recognition_id,order_id,revision_id,amount,currency,reversed_at")),
        fetchAllRows(db.from("wholesale_payment_reconciliation_events").select("id,payment_entry_id,event_type,created_at")),
        fetchAllRows(db.from("wholesale_accounting_journals").select("id,order_id,source_type,status,amount,currency,occurred_at")),
        fetchAllRows(db.from("customers").select("id,full_name")),
        fetchAllRows(db.from("wholesale_financial_account_mappings").select("payment_method,account_id,configured_by,configured_at")),
        fetchAllRows(db.from("wholesale_financial_postings").select("payment_entry_id,status,account_id,period_id,cash_movement_id,posted_at")),
      ]);
      wholesale = buildWholesaleFinanceReadModel({
        orders, payments, recognitions, reversals, reconciliationEvents, journals, customers, financialPostings,
        period: wholesalePeriod,
        from: from && !Number.isNaN(Date.parse(from)) ? from : "",
        to: to && !Number.isNaN(Date.parse(to)) ? to : "",
        accountId: accountId || "", movementType: movementType || "",
      });
      const paymentById = new Map(payments.map((entry: any) => [entry.id, entry]));
      const postingByEntry = new Map(financialPostings.map((entry: any) => [entry.payment_entry_id, entry]));
      for (const entry of payments) cashMetadata.set(entry.id,{payment_method:entry.payment_method,order_number:orders.find((order:any)=>order.id===entry.order_id)?.order_number,reversal_of_id:entry.refund_of ? postingByEntry.get(entry.refund_of)?.cash_movement_id : undefined});
      const mappedMovements = (movements || []).map((movement: any) => {
        const entry = movement.wholesale_payment_entry_id ? paymentById.get(movement.wholesale_payment_entry_id) : null;
        if (!entry) return movement;
        return { ...movement,
          movement_type: entry.entry_type === "payment" ? "wholesale_payment" : "wholesale_refund",
          source: "wholesale", payment_entry_id: entry.id, payment_method: entry.payment_method,
          currency: entry.currency, order_id: entry.order_id,
          order_number: orders.find((order: any) => order.id === entry.order_id)?.order_number || entry.order_id,
        };
      });
      const postedEntryIds = new Set((movements || []).map((movement: any) => movement.wholesale_payment_entry_id).filter(Boolean));
      wholesale.activity = (wholesale.activity || []).filter((activity: any) =>
        !activity.payment_entry_id || !postedEntryIds.has(activity.payment_entry_id));
      wholesale.accountMappings = accountMappings;
      wholesale.financialPostingStates = financialPostings.reduce((summary: Record<string, number>, posting: any) => {
        summary[posting.status] = (summary[posting.status] || 0) + 1;
        return summary;
      }, {});
      wholesale.accountMappingChoices = (accounts || []).filter((account: any) => account.active).map((account: any) => ({ id: account.id, name: account.name }));
      wholesale.pendingFinancialEntries = (payments || []).filter((entry: any) => {
        const posting: any = postingByEntry.get(entry.id);
        return !posting || ["pending_mapping", "pending_period", "unsupported_currency"].includes(posting.status);
      }).map((entry: any) => ({
        id: entry.id, order_id: entry.order_id,
        order_number: orders.find((order: any) => order.id === entry.order_id)?.order_number || entry.order_id,
        payment_method: entry.payment_method, entry_type: entry.entry_type, amount: Number(entry.amount),
        currency: entry.currency, status: postingByEntry.get(entry.id)?.status || "pending_mapping",
      }));
      wholesale.cashMovements = mappedMovements.filter((movement: any) => movement.source === "wholesale");
    } catch (error: any) {
      if (!isWholesaleSchemaMissing(error)) throw error;
      wholesale = { available: false, activity: [], receivables: [], reason: "Aplicá las migraciones mayoristas locales para habilitar esta vista." };
    }
    const costBy=new Map<string,number>();for(const i of items||[])costBy.set(i.sale_id,(costBy.get(i.sale_id)||0)+Number(i.unit_cost||0)*Number(i.quantity));
    const salesTotal=completed.reduce((n:number,s:any)=>n+Number(s.total),0),realizedCost=completed.reduce((n:number,s:any)=>n+(costBy.get(s.id)||0),0);
    const retailCostsComplete=completed.length>0 && completed.every((sale:any)=>{
      const rows=items.filter((item:any)=>item.sale_id===sale.id);
      return rows.length>0 && rows.every((item:any)=>item.unit_cost!==null && item.unit_cost!==undefined && Number.isFinite(Number(item.unit_cost)) && Number(item.unit_cost)>=0);
    });
    const allMovements=await fetchAllRows(db.from("cash_movements").select("id,account_id,period_id,amount,movement_type,description,occurred_at,created_at,sale_id,wholesale_payment_entry_id,transfer_id,reversal_of_id").eq("period_id",selected.id).order("occurred_at",{ascending:false}).order("id"));
    let sectorAllocations: CashAllocation[] = [];
    const sectorOperations: any[] = [];
    try {
      sectorAllocations = await fetchAllRows(db.from("financial_sector_allocations").select("cash_movement_id,sector,operation_id").order("cash_movement_id"));
    } catch (error: any) {
      if (!["42P01", "PGRST205"].includes(error?.code)) throw error;
    }
    const cashIds = new Set(allMovements.map((movement:any)=>movement.id));
    const operationIds = [...new Set(sectorAllocations.filter(allocation=>cashIds.has(allocation.cash_movement_id)).map(allocation=>allocation.operation_id).filter(Boolean))];
    for (let offset=0;offset<operationIds.length;offset+=500) sectorOperations.push(...await fetchAllRows(db.from("financial_sector_operations").select("id,action,actor_id,created_at,reverse_of,legacy_movement_id,request").in("id",operationIds.slice(offset,offset+500)).order("id")));
    const cashBySector = buildSectorCash(allMovements.map((movement:any)=>({ ...movement,
      ...(movement.wholesale_payment_entry_id ? cashMetadata.get(movement.wholesale_payment_entry_id) : {payment_method:sales.find((sale:any)=>sale.id===movement.sale_id)?.payment_method}),
      operation:sectorOperations.find(operation=>operation.id===sectorAllocations.find(allocation=>allocation.cash_movement_id===movement.id)?.operation_id),
    })), sectorAllocations);
    const retailPending = await fetchAllRows(db.from("financial_pending_postings").select("id,amount,currency,reason,status").eq("status","pending").order("id"));
    const balances=(accounts||[]).filter((a:any)=>a.active).map((a:any)=>({...a,balance:allMovements.filter((m:any)=>m.account_id===a.id).reduce((n:number,m:any)=>n+Number(m.amount),0)}));
    const investedStock=(products||[]).reduce((n:number,x:any)=>n+Number(x.stock||0)*Number(x.cost_price||0),0),potentialStockValue=(products||[]).reduce((n:number,x:any)=>n+Number(x.stock||0)*Number(x.price||0),0),potentialStockProfit=potentialStockValue-investedStock;
    const financeMovements = [...(wholesale.cashMovements || []), ...(movements || []).filter((movement: any) => !movement.wholesale_payment_entry_id), ...(wholesale.activity || [])]
      .filter((movement: any) => !movementType || movement.movement_type === movementType)
      .sort((a: any, b: any) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
      .slice(0, 1000);
    return NextResponse.json({ok:true,data:{sectorOperationsEnabled:sectorFinancePreparedEnabled(),activated:true,cashBySector,retailPending,accounts:balances,accountManagement:accounts||[],totalAvailable:cashBySector.total,periods,selectedPeriod:selected,salesTotal,realizedProfit:salesTotal-realizedCost,retailCostsComplete,realizedCost,investedStock,potentialStockValue,potentialStockProfit,potentialRoi:investedStock>0?potentialStockProfit/investedStock*100:null,movements:financeMovements,wholesale}});
  } catch(error){return apiInternalError("admin_finances_list",error)}
}

export async function POST(request:Request){
  const limited=rateLimit(request,"admin-finances",{limit:30,windowMs:10*60*1000});if(limited)return limited;const blocked=await guard();if(blocked)return blocked;const body=await readJsonObject(request);if(!body)return apiError("BAD_REQUEST","Solicitud inválida.",400);
  try{const db:any=createAdminServerClient();let result:any;
    if(body.action==="activate"){const cash=Number(body.cashBalance),mercadopago=Number(body.mercadopagoBalance),key=String(body.idempotencyKey||"");if(!isUuid(key)||!Number.isFinite(cash)||!Number.isFinite(mercadopago)||cash<0||mercadopago<0||cash>100_000_000||mercadopago>100_000_000||body.confirmation!=="ACTIVAR FINANZAS")return apiError("BAD_REQUEST","Revisá los saldos y la confirmación.",400);result=await db.rpc("activate_finances",{p_cash_balance:cash,p_mercadopago_balance:mercadopago,p_idempotency_key:key});}
    else if(body.action==="movement"){const type=boundedString(body.type,32,{required:true}),accountId=boundedString(body.accountId,40,{required:true}),description=boundedString(body.description,500,{required:true}),amount=Number(body.amount),key=String(body.idempotencyKey||"");if(!isUuid(key)||!type||!accountId||!description||!["income","expense","cash_withdrawal","cash_contribution","adjustment","refund"].includes(type)||!Number.isFinite(amount)||amount===0||Math.abs(amount)>100_000_000)return apiError("BAD_REQUEST","Revisá el movimiento.",400);result=await db.rpc("record_financial_movement",{p_type:type,p_amount:amount,p_description:description,p_account_id:accountId,p_idempotency_key:key});}
    else if(body.action==="transfer"){const from=boundedString(body.fromAccountId,40,{required:true}),to=boundedString(body.toAccountId,40,{required:true}),description=boundedString(body.description,500)||"",amount=Number(body.amount),key=String(body.idempotencyKey||"");if(!isUuid(key)||!from||!to||from===to||!Number.isFinite(amount)||amount<=0||amount>100_000_000)return apiError("BAD_REQUEST","Revisá la transferencia.",400);result=await db.rpc("transfer_financial_balance",{p_from:from,p_to:to,p_amount:amount,p_description:description,p_idempotency_key:key});}
    else if(body.action==="close_period"){const name=boundedString(body.name,120,{required:true}),key=String(body.idempotencyKey||"");if(!isUuid(key)||!name||body.confirmation!=="CERRAR PERIODO")return apiError("BAD_REQUEST","La confirmación del cierre no es válida.",400);result=await db.rpc("close_financial_period",{p_name:name,p_reset_to_zero:Boolean(body.resetToZero),p_idempotency_key:key});}
    else if(body.action==="map_wholesale_method"){const method=boundedString(body.paymentMethod,24,{required:true}),accountId=body.accountId===null?null:boundedString(body.accountId,40,{required:true});if(!method||!["cash","bank_transfer","mercadopago","debit_card","credit_card","other"].includes(method)||accountId===undefined||accountId==="")return apiError("BAD_REQUEST","Seleccioná un método y una cuenta válida.",400);const identity=await getAdminIdentity();if(!identity||identity.legacy||!isUuid(identity.id))return apiError("FORBIDDEN","Esta configuración requiere una cuenta ADMIN individual.",403);if(method==='cash' && accountId){const {data:posting,error:postingError}=await db.from('wholesale_financial_postings').select('status').eq('payment_entry_id','dc6124a6-d680-4edf-9384-777803e5ad03').maybeSingle();if(postingError)throw new Error('wholesale_mapping_precheck_failed');if(posting && posting.status!=='neutralized_test_pair')return apiError('BAD_REQUEST','Regularizaci\u00f3n de movimientos de prueba pendiente. No se puede asignar efectivo todav\u00eda.',409);}result=await db.rpc("set_wholesale_financial_account_mapping",{p_method:method,p_account_id:accountId,p_actor:identity.id});}
    else if(body.action==="account_create"||body.action==="account_update"||body.action==="account_deactivate"){
      const identity=await getAdminIdentity();if(!identity||identity.legacy||identity.role!=="ADMIN"||!isUuid(identity.id))return apiError("FORBIDDEN","La administración de cuentas requiere una cuenta ADMIN individual.",403);
      const action=body.action==="account_create"?"create":body.action==="account_update"?"update":"deactivate";
      const id=boundedString(body.id,40,{required:true}),name=action==="deactivate"?null:boundedString(body.name,100,{required:true}),accountType=action==="deactivate"?null:boundedString(body.accountType,24,{required:true}),sortOrder=action==="deactivate"?null:Number(body.sortOrder),openingBalance=action==="deactivate"?null:Number(body.openingBalance??0),requestKey=String(body.idempotencyKey||"");
      if(!id||!/^[a-z][a-z0-9_-]{1,39}$/.test(id)||!isUuid(requestKey)||(action!=="deactivate"&&(!name||!accountType||!["cash","wallet","bank","card","other"].includes(accountType)||!Number.isInteger(sortOrder)||Number(sortOrder)<0||Number(sortOrder)>10000||!Number.isFinite(openingBalance)||Number(openingBalance)<0||Number(openingBalance)>100_000_000)))return apiError("BAD_REQUEST","Revisá el identificador, tipo, nombre, saldo inicial, orden y clave de la cuenta.",400);
      result=await db.rpc("manage_financial_account",{p_action:action,p_id:id,p_name:name,p_account_type:accountType,p_sort_order:sortOrder,p_actor:identity.id,p_idempotency_key:requestKey,p_opening_balance:openingBalance});
    }
    else if(body.action==="retry_wholesale_postings"){const identity=await getAdminIdentity();if(!identity||identity.legacy||!isUuid(identity.id))return apiError("FORBIDDEN","Esta operación requiere una cuenta ADMIN individual.",403);result=await db.rpc("retry_wholesale_financial_postings",{p_actor:identity.id});}
    else if(body.action==="cancel_sale"){const reason=boundedString(body.reason,500,{required:true});if(!isUuid(body.saleId)||!reason)return apiError("BAD_REQUEST","Indicá una venta y el motivo.",400);result=await db.rpc("cancel_sale_with_reversal",{p_sale_id:body.saleId,p_reason:reason});}
    else if(body.action==="archive_sale"){if(!isUuid(body.saleId)||typeof body.archive!=="boolean")return apiError("BAD_REQUEST","Datos inválidos.",400);result=await db.rpc("archive_sale",{p_sale_id:body.saleId,p_archive:body.archive});}
    else return apiError("BAD_REQUEST","Acción inválida.",400);if(result?.error)return apiError("BAD_REQUEST","No se pudo registrar la operación.",400);return NextResponse.json({ok:true});
  }catch(error){return apiInternalError("admin_finances_action",error)}
}
