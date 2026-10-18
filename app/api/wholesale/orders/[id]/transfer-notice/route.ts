import { NextResponse } from "next/server";
import { getWholesaleSessionCustomerId } from "@/lib/wholesale-server";
import { isWholesaleSessionWriteAllowed } from "@/lib/wholesale-session-origin";
import { createAdminServerClient } from "@/lib/supabase/server";
import { readJsonObject,isUuid } from "@/lib/api";
import { wholesalePaymentNoticesEnabled } from "@/lib/wholesale-payment-notices";

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  const customer=await getWholesaleSessionCustomerId();
  if(!customer||!isWholesaleSessionWriteAllowed(request))return NextResponse.json({error:"Ingresá a tu cuenta mayorista."},{status:403});
  if(!wholesalePaymentNoticesEnabled())return NextResponse.json({error:"El aviso interno de transferencia todavía no está disponible. Consultá con DCL."},{status:503});
  const {id}=await params,body=await readJsonObject(request);
  if(!isUuid(id)||!body||!isUuid(body.key)||!['inform','withdraw'].includes(String(body.action))
    ||Object.keys(body).some(k=>!['key','action','amount','noticeId'].includes(k))
    ||(body.action==='inform'&&(typeof body.amount!=='number'||!Number.isFinite(body.amount)||body.amount<=0||Math.abs(Math.round(body.amount*100)-body.amount*100)>0.0001))
    ||(body.action==='withdraw'&&!isUuid(body.noticeId)))return NextResponse.json({error:"Revisá el importe informado."},{status:400});
  const {data,error}=await createAdminServerClient().rpc("record_wholesale_transfer_notice" as never,{
    p_customer:customer,p_order:id,p_amount:body.amount??null,p_key:body.key,p_action:body.action,p_notice:body.noticeId??null,
  } as never);
  if(error)return NextResponse.json({error:"No se guardó el aviso. Actualizá el saldo y reintentá la misma solicitud."},{status:409});
  return NextResponse.json({ok:true,notice:data},{headers:{'Cache-Control':'no-store'}});
}
