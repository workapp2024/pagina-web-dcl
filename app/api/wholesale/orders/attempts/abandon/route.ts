import { NextResponse } from "next/server";
import { getWholesaleSessionCustomerId } from "@/lib/wholesale-server";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import { isSameOriginWrite } from "@/lib/store/buyer-session";
import { isWholesaleUuid, wholesaleRpcErrorMessage } from "@/lib/wholesale-order-api";

const privateHeaders = { "Cache-Control": "no-store, private" };
const errorResponse = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers: privateHeaders });

export async function POST(request: Request) {
  const customerId = await getWholesaleSessionCustomerId();
  if (!customerId) return errorResponse("Ingresá a tu cuenta mayorista para cerrar el intento.", 401);
  if (!isSameOriginWrite(request)) return errorResponse("No se pudo validar el origen de la solicitud.", 403);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return errorResponse("El formato no es válido.", 400);
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("El contenido no es JSON válido.", 400); }
  const payload = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  if (Object.keys(payload).join(",") !== "attemptId" || !isWholesaleUuid(payload.attemptId)) return errorResponse("El intento no es válido.", 400);
  if (!isServiceRoleConfigured()) return errorResponse("El servicio de pedidos no está disponible. Intentá más tarde.", 503);
  try {
    const { data, error } = await createAdminServerClient().rpc("abandon_wholesale_order_attempt" as never, {
      p_customer: customerId, p_attempt: payload.attemptId,
    } as never) as unknown as { data: string | null; error: { message?: string } | null };
    if (error || !data) {
      const mapped = wholesaleRpcErrorMessage(error?.message || "attempt could not close");
      return errorResponse(mapped.error, mapped.status);
    }
    return NextResponse.json({ ok: true, status: data }, { headers: privateHeaders });
  } catch {
    return errorResponse("No se pudo cerrar el intento. Intentá nuevamente.", 503);
  }
}
