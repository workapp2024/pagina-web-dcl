import { NextResponse } from "next/server";
import { isUuid } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminServerClient } from "@/lib/supabase/server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited=rateLimit(request,"public-order-status",{limit:30,windowMs:60_000});if(limited)return limited;
  const {id}=await params;if(!isUuid(id))return NextResponse.json({ok:false},{status:400});
  const db=createAdminServerClient();
  const [{data:order},{data:transaction}]=await Promise.all([
    db.from("orders").select("status,payment_method,total,currency").eq("id",id).single(),
    db.from("payment_transactions").select("status").eq("order_id",id).order("created_at",{ascending:false}).limit(1).maybeSingle(),
  ]) as unknown as [
    {data:{status:string;payment_method:string;total:number|string;currency:string}|null},
    {data:{status:string}|null},
  ];
  if(!order)return NextResponse.json({ok:false},{status:404});
  const review=order.status==="stock_unavailable" || (transaction?.status==="approved" && !["paid","completed"].includes(order.status));
  const approved=["paid","completed"].includes(order.status) && transaction?.status==="approved";
  const rejected=["rejected","cancelled","stock_unavailable"].includes(order.status)||["rejected","cancelled","error"].includes(transaction?.status||"");
  return NextResponse.json({ok:true,result:review?"review":rejected?"rejected":approved?"approved":"pending",paymentReceived:transaction?.status==="approved",status:order.status,paymentMethod:order.payment_method,total:Number(order.total),currency:order.currency,reference:id.slice(0,8).toUpperCase()},{headers:{"Cache-Control":"no-store"}});
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited=rateLimit(request,"public-transfer-declared",{limit:5,windowMs:60_000});if(limited)return limited;
  const {id}=await params;if(!isUuid(id))return NextResponse.json({ok:false},{status:400});
  const db=createAdminServerClient();
  const {data,error}=await db.rpc("declare_manual_transfer" as never,{p_order:id} as never);
  if(error||!data)return NextResponse.json({ok:false,error:"El pedido no está disponible para verificar."},{status:409});
  return NextResponse.json({ok:true});
}
