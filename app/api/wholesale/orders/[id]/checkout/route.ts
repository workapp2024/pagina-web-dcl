import { NextResponse } from "next/server";
import { getWholesaleSessionCustomerId } from "@/lib/wholesale-server";
import { isWholesaleSessionWriteAllowed } from "@/lib/wholesale-session-origin";
import { isUuid, readJsonObject } from "@/lib/api";
import { createAdminServerClient } from "@/lib/supabase/server";
import { wholesaleCheckoutPreparedEnabled } from "@/lib/prepared-finance-features";
import { prepareWholesaleCheckout } from "@/lib/wholesale-checkout";
import { rateLimit } from "@/lib/rate-limit";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  if(!wholesaleCheckoutPreparedEnabled())return NextResponse.json({error:"Checkout mayorista pendiente de autorización."},{status:503});
  const customer=await getWholesaleSessionCustomerId();
  if(!customer||!isWholesaleSessionWriteAllowed(request))return NextResponse.json({error:"Ingresá a tu cuenta mayorista."},{status:403});
  const limited=rateLimit(request,"wholesale-checkout",{limit:10,windowMs:60000});if(limited)return limited;
  const {id}=await params,body=await readJsonObject(request);
  if(!isUuid(id)||!body||Object.keys(body).some(k=>!["amount","idempotencyKey"].includes(k))||!isUuid(body.idempotencyKey)||(body.amount!=null&&(typeof body.amount!=="number"||!Number.isFinite(body.amount)||body.amount<=0||Math.abs(body.amount*100-Math.round(body.amount*100))>0.0001)))return NextResponse.json({error:"Importe o intento inválido."},{status:400});
  if(!process.env.MERCADOPAGO_ACCESS_TOKEN||!process.env.NEXT_PUBLIC_SITE_URL)return NextResponse.json({error:"Checkout no configurado."},{status:503});
  try {
    const checkoutUrl=await prepareWholesaleCheckout(createAdminServerClient() as unknown as Parameters<typeof prepareWholesaleCheckout>[0],customer,id,body.amount as number|null??null,body.idempotencyKey,process.env.MERCADOPAGO_ACCESS_TOKEN,process.env.NEXT_PUBLIC_SITE_URL);
    return NextResponse.json({checkoutUrl},{headers:{"Cache-Control":"no-store"}});
  } catch{return NextResponse.json({error:"No se pudo preparar el pago. Conservá este intento y reintentá; puede requerir revisión de DCL."},{status:409});}
}
