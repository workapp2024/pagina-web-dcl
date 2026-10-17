import { getWholesaleSessionCustomerId } from "@/lib/wholesale-server";
import { apiError } from "@/lib/api";
import { visibilityResponse } from "@/lib/wholesale-order-visibility-api";
export async function GET(request: Request) {
  const customer=await getWholesaleSessionCustomerId();
  if (!customer) return apiError("UNAUTHORIZED","Ingresá a tu cuenta mayorista.",401);
  return visibilityResponse(request,{p_customer:customer,p_actor:null});
}
export const POST=GET;
