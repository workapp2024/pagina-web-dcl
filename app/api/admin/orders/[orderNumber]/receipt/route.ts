import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getOrderReceipt } from "@/lib/store/order-receipt";
import { withReceiptIdentity } from "@/lib/receipt-identity-server";
export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{orderNumber:string}>}) {
  if(!(await isAdminAuthenticated("commercial")))return NextResponse.json({error:"No autorizado."},{status:401});
  const {orderNumber}=await params,result=await withReceiptIdentity(await getOrderReceipt(orderNumber));
  return NextResponse.json(result,{status:result.status==='ok'?200:result.status==='not_found'?404:409,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
