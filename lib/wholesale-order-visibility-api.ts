import { NextResponse } from "next/server";
import { apiError, isUuid, readJsonObject } from "@/lib/api";
import { createAdminServerClient } from "@/lib/supabase/server";
import { isWholesaleSessionWriteAllowed } from "@/lib/wholesale-session-origin";
import { readWholesaleVisibility, type VisibilityViewer } from "@/lib/wholesale-order-visibility-server";

export async function visibilityResponse(request: Request, viewer: VisibilityViewer) {
  try {
    if (request.method === "GET") return NextResponse.json({ok:true,...await readWholesaleVisibility(viewer)},{headers:{"Cache-Control":"no-store, private"}});
    if (!isWholesaleSessionWriteAllowed(request)) return apiError("FORBIDDEN","Origen inválido.",403);
    const body=await readJsonObject(request);
    if (!body || Object.keys(body).sort().join(",") !== "archived,orderId" || !isUuid(body.orderId) || typeof body.archived !== "boolean") return apiError("BAD_REQUEST","Solicitud de archivo inválida.",400);
    const result=await createAdminServerClient().rpc("set_wholesale_order_visibility" as never,{...viewer,p_order:body.orderId,p_archived:body.archived} as never) as unknown as {error:{message?:string;code?:string}|null};
    if (result.error) {
      if (result.error.message?.includes("VISIBILITY_PENDING")) return apiError("BAD_REQUEST","El pedido tiene operaciones pendientes o sigue en curso. No se puede archivar.",409);
      if (result.error.message?.includes("VISIBILITY_NOT_FOUND")) return apiError("NOT_FOUND","Pedido no disponible.",404);
      return apiError("INTERNAL_ERROR","No se pudo cambiar la visibilidad del pedido.",503);
    }
    return NextResponse.json({ok:true},{headers:{"Cache-Control":"no-store, private"}});
  } catch { return apiError("INTERNAL_ERROR","No se pudo consultar el archivo de pedidos.",503); }
}
