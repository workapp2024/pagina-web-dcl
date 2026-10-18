import { NextRequest, NextResponse } from "next/server";
import { WebhookSignatureValidator } from "mercadopago";
import { createAdminServerClient } from "@/lib/supabase/server";
import { reconcileWholesaleCheckout } from "@/lib/wholesale-checkout";
export async function POST(request:NextRequest) {
  // Keep legacy preference notifications recoverable when new checkout is off.
  const id=request.nextUrl.searchParams.get("data.id"),type=request.nextUrl.searchParams.get("type");
  const signature=request.headers.get("x-signature"),requestId=request.headers.get("x-request-id"),secret=process.env.MERCADOPAGO_WEBHOOK_SECRET,token=process.env.MERCADOPAGO_ACCESS_TOKEN;
  if(type!=="payment"||!id||!/^\d{1,100}$/.test(id)||!signature||!requestId||!secret||!token)return NextResponse.json({ok:false},{status:400});
  try {WebhookSignatureValidator.validate({xSignature:signature,xRequestId:requestId,dataId:id,secret});}catch{return NextResponse.json({ok:false},{status:401});}
  try {await reconcileWholesaleCheckout(createAdminServerClient() as unknown as Parameters<typeof reconcileWholesaleCheckout>[0],id,token);return NextResponse.json({ok:true});}catch{return NextResponse.json({ok:false},{status:503});}
}
