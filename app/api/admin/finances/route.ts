/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { apiError, apiInternalError, boundedString, isUuid, readJsonObject } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";

async function guard() { if (!(await isAdminAuthenticated())) return apiError("UNAUTHORIZED", "No autorizado.", 401); if (!isServiceRoleConfigured()) return apiError("CONFIGURATION_ERROR", "La administración no está configurada.", 503); return null; }

export async function GET(request: Request) {
  const blocked = await guard(); if (blocked) return blocked;
  try {
    const p = new URL(request.url).searchParams, db: any = createAdminServerClient();
    const [{data:accounts,error:ae},{data:periods,error:pe},{data:products,error:pre},{data:activation,error:ace}] = await Promise.all([
      db.from("financial_accounts").select("id,name,account_type,active,sort_order").eq("active",true).order("sort_order"),
      db.from("financial_periods").select("id,name,starts_at,ends_at,status").order("starts_at",{ascending:false}),
      db.from("products").select("stock,cost_price,price"),
      db.from("financial_activation").select("activated_at,initial_period_id").eq("singleton",true).maybeSingle(),
    ]);
    if(ae||pe||pre||ace)return apiError("CONFIGURATION_ERROR","Aplicá la migración financiera pendiente para usar este módulo.",503);
    if(!activation)return NextResponse.json({ok:true,data:{activated:false,accounts:(accounts||[]).map((a:any)=>({...a,balance:0})),periods:[]}});
    const selected=(periods||[]).find((x:any)=>x.id===p.get("periodId"))||(periods||[]).find((x:any)=>x.status==="open")||periods?.[0];
    if(!selected)return apiError("CONFIGURATION_ERROR","No existe un período financiero.",503);
    let sq=db.from("sales").select("id,total,status,payment_method,created_at").gte("created_at",selected.starts_at).order("created_at",{ascending:false}).limit(1000); if(selected.ends_at)sq=sq.lte("created_at",selected.ends_at);
    const {data:sales,error:se}=await sq;if(se)throw new Error(se.message);const completed=(sales||[]).filter((s:any)=>s.status==="completed"),ids=completed.map((s:any)=>s.id);
    const {data:items,error:ie}=ids.length?await db.from("sale_items").select("sale_id,quantity,unit_cost").in("sale_id",ids):{data:[],error:null};if(ie)throw new Error(ie.message);
    let mq=db.from("cash_movements").select("id,movement_type,amount,description,occurred_at,sale_id,account_id,period_id,transfer_id").eq("period_id",selected.id).order("occurred_at",{ascending:false}).limit(1000);
    const accountId=boundedString(p.get("accountId"),40),movementType=boundedString(p.get("movementType"),32),from=p.get("from"),to=p.get("to");if(accountId)mq=mq.eq("account_id",accountId);if(movementType)mq=mq.eq("movement_type",movementType);if(from&&!Number.isNaN(Date.parse(from)))mq=mq.gte("occurred_at",from);if(to&&!Number.isNaN(Date.parse(to)))mq=mq.lte("occurred_at",to);
    const {data:movements,error:me}=await mq;if(me)throw new Error(me.message);
    const costBy=new Map<string,number>();for(const i of items||[])costBy.set(i.sale_id,(costBy.get(i.sale_id)||0)+Number(i.unit_cost||0)*Number(i.quantity));
    const salesTotal=completed.reduce((n:number,s:any)=>n+Number(s.total),0),realizedCost=completed.reduce((n:number,s:any)=>n+(costBy.get(s.id)||0),0);
    const {data:allMovements,error:ame}=await db.from("cash_movements").select("account_id,amount").eq("period_id",selected.id);if(ame)throw new Error(ame.message);
    const balances=(accounts||[]).map((a:any)=>({...a,balance:(allMovements||[]).filter((m:any)=>m.account_id===a.id).reduce((n:number,m:any)=>n+Number(m.amount),0)}));
    const investedStock=(products||[]).reduce((n:number,x:any)=>n+Number(x.stock||0)*Number(x.cost_price||0),0),potentialStockValue=(products||[]).reduce((n:number,x:any)=>n+Number(x.stock||0)*Number(x.price||0),0),potentialStockProfit=potentialStockValue-investedStock;
    return NextResponse.json({ok:true,data:{activated:true,accounts:balances,totalAvailable:balances.reduce((n:number,a:any)=>n+a.balance,0),periods,selectedPeriod:selected,salesTotal,realizedProfit:salesTotal-realizedCost,realizedCost,investedStock,potentialStockValue,potentialStockProfit,potentialRoi:investedStock>0?potentialStockProfit/investedStock*100:null,movements}});
  } catch(error){return apiInternalError("admin_finances_list",error)}
}

export async function POST(request:Request){
  const limited=rateLimit(request,"admin-finances",{limit:30,windowMs:10*60*1000});if(limited)return limited;const blocked=await guard();if(blocked)return blocked;const body=await readJsonObject(request);if(!body)return apiError("BAD_REQUEST","Solicitud inválida.",400);
  try{const db:any=createAdminServerClient();let result:any;
    if(body.action==="activate"){const cash=Number(body.cashBalance),mercadopago=Number(body.mercadopagoBalance),key=String(body.idempotencyKey||"");if(!isUuid(key)||!Number.isFinite(cash)||!Number.isFinite(mercadopago)||cash<0||mercadopago<0||cash>100_000_000||mercadopago>100_000_000||body.confirmation!=="ACTIVAR FINANZAS")return apiError("BAD_REQUEST","Revisá los saldos y la confirmación.",400);result=await db.rpc("activate_finances",{p_cash_balance:cash,p_mercadopago_balance:mercadopago,p_idempotency_key:key});}
    else if(body.action==="movement"){const type=boundedString(body.type,32,{required:true}),accountId=boundedString(body.accountId,40,{required:true}),description=boundedString(body.description,500,{required:true}),amount=Number(body.amount),key=String(body.idempotencyKey||"");if(!isUuid(key)||!type||!accountId||!description||!["income","expense","cash_withdrawal","cash_contribution","adjustment","refund"].includes(type)||!Number.isFinite(amount)||amount===0||Math.abs(amount)>100_000_000)return apiError("BAD_REQUEST","Revisá el movimiento.",400);result=await db.rpc("record_financial_movement",{p_type:type,p_amount:amount,p_description:description,p_account_id:accountId,p_idempotency_key:key});}
    else if(body.action==="transfer"){const from=boundedString(body.fromAccountId,40,{required:true}),to=boundedString(body.toAccountId,40,{required:true}),description=boundedString(body.description,500)||"",amount=Number(body.amount),key=String(body.idempotencyKey||"");if(!isUuid(key)||!from||!to||from===to||!Number.isFinite(amount)||amount<=0||amount>100_000_000)return apiError("BAD_REQUEST","Revisá la transferencia.",400);result=await db.rpc("transfer_financial_balance",{p_from:from,p_to:to,p_amount:amount,p_description:description,p_idempotency_key:key});}
    else if(body.action==="close_period"){const name=boundedString(body.name,120,{required:true}),key=String(body.idempotencyKey||"");if(!isUuid(key)||!name||body.confirmation!=="CERRAR PERIODO")return apiError("BAD_REQUEST","La confirmación del cierre no es válida.",400);result=await db.rpc("close_financial_period",{p_name:name,p_reset_to_zero:Boolean(body.resetToZero),p_idempotency_key:key});}
    else if(body.action==="cancel_sale"){const reason=boundedString(body.reason,500,{required:true});if(!isUuid(body.saleId)||!reason)return apiError("BAD_REQUEST","Indicá una venta y el motivo.",400);result=await db.rpc("cancel_sale_with_reversal",{p_sale_id:body.saleId,p_reason:reason});}
    else if(body.action==="archive_sale"){if(!isUuid(body.saleId)||typeof body.archive!=="boolean")return apiError("BAD_REQUEST","Datos inválidos.",400);result=await db.rpc("archive_sale",{p_sale_id:body.saleId,p_archive:body.archive});}
    else return apiError("BAD_REQUEST","Acción inválida.",400);if(result?.error)return apiError("BAD_REQUEST","No se pudo registrar la operación.",400);return NextResponse.json({ok:true});
  }catch(error){return apiInternalError("admin_finances_action",error)}
}
