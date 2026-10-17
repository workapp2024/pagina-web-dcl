import { getAdminIdentity } from "@/lib/admin-auth";
import { apiError, isUuid } from "@/lib/api";
import { visibilityResponse } from "@/lib/wholesale-order-visibility-api";
export async function GET(request: Request) {
  const identity=await getAdminIdentity();
  if (identity?.role !== "ADMIN" || identity.legacy || !isUuid(identity.id)) return apiError("FORBIDDEN","No autorizado.",403);
  return visibilityResponse(request,{p_actor:identity.id,p_customer:null});
}
export const POST=GET;
