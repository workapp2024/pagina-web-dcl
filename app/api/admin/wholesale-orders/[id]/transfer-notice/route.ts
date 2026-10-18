import { NextResponse } from "next/server";
import { getAdminIdentity } from "@/lib/admin-auth";
import { createAdminServerClient } from "@/lib/supabase/server";
import { isWholesaleSessionWriteAllowed } from "@/lib/wholesale-session-origin";
import { isUuid,readJsonObject } from "@/lib/api";
import { wholesalePaymentNoticesEnabled } from "@/lib/wholesale-payment-notices";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  const actor=await getAdminIdentity();
  if(actor?.role!=="ADMIN"||actor.legacy||!isUuid(actor.id)||!isWholesaleSessionWriteAllowed(request))return NextResponse.json({error:"No autorizado."},{status:403});
  if(!wholesalePaymentNoticesEnabled())return NextResponse.json({error:"Avisos pendientes de habilitar."},{status:503});
  const {id}=await params,body=await readJsonObject(request);
  if(!isUuid(id)||!body||!isUuid(body.noticeId)||!['verified','not_received'].includes(String(body.status))||Object.keys(body).some(k=>!['noticeId','status','paymentId'].includes(k))||(body.status==='verified'&&!isUuid(body.paymentId))||(body.status==='not_received'&&body.paymentId!=null))return NextResponse.json({error:"Seleccioná el aviso y un cobro ya registrado, si corresponde."},{status:400});
  const {error}=await createAdminServerClient().rpc("resolve_wholesale_transfer_notice" as never,{p_order:id,p_notice:body.noticeId,p_status:body.status,p_payment:body.paymentId??null,p_actor:actor.id} as never);
  if(error)return NextResponse.json({error:"No se pudo resolver el aviso. Revisá el cobro y actualizá el pedido."},{status:409});
  return NextResponse.json({ok:true});
}
