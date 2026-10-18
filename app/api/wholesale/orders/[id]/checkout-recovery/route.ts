import { NextResponse } from "next/server";
import { getWholesaleSessionCustomerId } from "@/lib/wholesale-server";
import { isWholesaleSessionWriteAllowed } from "@/lib/wholesale-session-origin";
import { createAdminServerClient } from "@/lib/supabase/server";
import { wholesalePaymentNoticesEnabled } from "@/lib/wholesale-payment-notices";
import { providerGet } from "@/lib/store/mercadopago-recovery";
import { isUuid } from "@/lib/api";

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  const customer=await getWholesaleSessionCustomerId(),{id}=await params;
  if(!customer||!isWholesaleSessionWriteAllowed(request))return NextResponse.json({error:"No autorizado."},{status:403});
  if(!isUuid(id))return NextResponse.json({error:"Pedido inválido."},{status:400});
  if(!wholesalePaymentNoticesEnabled())return NextResponse.json({error:"Consultá con DCL para revisar el intento."},{status:503});
  const token=process.env.MERCADOPAGO_ACCESS_TOKEN;if(!token)return NextResponse.json({error:"Pago no disponible."},{status:503});
  try {
    const db=createAdminServerClient();
    const {data:intent,error}=await db.from("wholesale_checkout_intents").select("id,preference_id,provider_started_at,expires_at").eq("customer_id",customer).eq("order_id",id).not("state","in","(approved,closed)").maybeSingle() as unknown as {data:{id:string;preference_id:string|null;provider_started_at:string|null;expires_at:string}|null;error:unknown};
    if(error||!intent||Date.parse(intent.expires_at)>Date.now())throw Error('Not expired');
    if(intent.provider_started_at&&!intent.preference_id)throw Error('Provider result uncertain; requires administrative recovery');
    if(intent.preference_id){
      const preference=await providerGet(`/checkout/preferences/${encodeURIComponent(intent.preference_id)}`,token);
      if(String(preference.id)!==intent.preference_id||preference.external_reference!==`wholesale:${intent.id}`||preference.expires!==true||!Number.isFinite(Date.parse(String(preference.expiration_date_to)))||Date.parse(String(preference.expiration_date_to))>Date.now())throw Error('Preference not verified expired');
    }
    const search=await providerGet(`/v1/payments/search?external_reference=${encodeURIComponent(`wholesale:${intent.id}`)}&limit=100`,token);
    const payments=search.results as {external_reference?:string;status?:string}[]|undefined;
    const paging=search.paging as {total?:number}|undefined;
    if(!Array.isArray(payments)||!Number.isInteger(paging?.total)||paging!.total!>payments.length||payments.some(p=>p.external_reference!==`wholesale:${intent.id}`||!['rejected','cancelled'].includes(p.status??'')))throw Error('Payment still requires verification');
    const closed=await db.rpc("close_verified_wholesale_checkout" as never,{p_customer:customer,p_order:id,p_intent:intent.id,p_preference:intent.preference_id,p_provider_checked:true} as never);
    if(closed.error)throw closed.error;
    return NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});
  }catch{return NextResponse.json({error:"El intento todavía requiere verificación de DCL. No vuelvas a pagar si ya se descontó dinero."},{status:409});}
}
