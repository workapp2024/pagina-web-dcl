import { NextResponse } from "next/server";
import { getAdminIdentity } from "@/lib/admin-auth";
import { getWholesaleReceipt } from "@/lib/store/wholesale-receipt";
import { withReceiptIdentity } from "@/lib/receipt-identity-server";
export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  if((await getAdminIdentity())?.role!=="ADMIN")return NextResponse.json({error:"No autorizado."},{status:401});
  const {id}=await params,result=await withReceiptIdentity(await getWholesaleReceipt(id));
  return NextResponse.json(result,{status:result.status==='ok'?200:result.status==='not_found'?404:409,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
