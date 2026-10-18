import { NextResponse } from "next/server";
import { getAdminIdentity } from "@/lib/admin-auth";
import { apiError, boundedString, isUuid, readJsonObject } from "@/lib/api";
import { sectorFinancePreparedEnabled } from "@/lib/prepared-finance-features";
import { isWholesaleSessionWriteAllowed } from "@/lib/wholesale-session-origin";
import { createAdminServerClient } from "@/lib/supabase/server";

export async function POST(request:Request) {
  const actor=await getAdminIdentity();
  if(actor?.role!=="ADMIN"||actor.legacy||!isUuid(actor.id)) return apiError("FORBIDDEN","No autorizado.",403);
  if(!sectorFinancePreparedEnabled()) return apiError("CONFIGURATION_ERROR","Operaciones por sector pendientes de autorización.",503);
  if(!isWholesaleSessionWriteAllowed(request))return apiError("FORBIDDEN","Origen no permitido.",403);
  const body=await readJsonObject(request);
  const reason=boundedString(body?.reason,300,{required:true});
  if(!body||Object.keys(body).some(k=>!["operation","sector","accountId","amount","reason","occurredAt","idempotencyKey"].includes(k))
    ||!["income","withdrawal"].includes(String(body.operation))||!["minoristas","mayoristas"].includes(String(body.sector))
    ||!["cash","mercadopago"].includes(String(body.accountId))||typeof body.amount!=="number"||!Number.isFinite(body.amount)||body.amount<=0||body.amount>100000000||Math.abs(body.amount*100-Math.round(body.amount*100))>0.0001
    ||!reason||!isUuid(body.idempotencyKey)||typeof body.occurredAt!=="string"||!Number.isFinite(Date.parse(body.occurredAt))) return apiError("BAD_REQUEST","Revisá sector, cuenta, importe y motivo.",400);
  try {
    const {data,error}=await createAdminServerClient().rpc("record_sector_finance" as never,{
      p_action:body.operation,p_account:body.accountId,p_amount:body.amount,p_from:body.operation==="withdrawal"?body.sector:null,p_to:body.operation==="income"?body.sector:null,
      p_occurred_at:body.occurredAt,p_party:"Administración DCL",p_reason:reason,p_actor:actor.id,p_key:body.idempotencyKey,
    } as never) as unknown as {data:string|null;error:{message:string}|null};
    if(error||!isUuid(data))return apiError("BAD_REQUEST","No se pudo registrar. Verificá el saldo, el período y el resultado del intento anterior.",409);
    return NextResponse.json({ok:true,id:data},{headers:{"Cache-Control":"no-store"}});
  } catch{return apiError("INTERNAL_ERROR","No se pudo confirmar el movimiento. Reintentá con los mismos datos.",503);}
}
