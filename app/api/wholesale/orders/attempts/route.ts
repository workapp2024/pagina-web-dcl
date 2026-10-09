import { NextResponse } from "next/server";
import { getWholesaleSessionCustomerId } from "@/lib/wholesale-server";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import { isSameOriginWrite } from "@/lib/store/buyer-session";
import { parseWholesaleRequestItems, wholesaleRpcErrorMessage } from "@/lib/wholesale-order-api";

const privateHeaders = { "Cache-Control": "no-store, private" };
const errorResponse = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers: privateHeaders });

export async function GET() {
  const customerId = await getWholesaleSessionCustomerId();
  if (!customerId) return errorResponse("Ingresá a tu cuenta mayorista para recuperar solicitudes.", 401);
  if (!isServiceRoleConfigured()) return errorResponse("El servicio de pedidos no está disponible. Intentá más tarde.", 503);
  try {
    const { data, error } = await createAdminServerClient().rpc("get_wholesale_order_attempts" as never, {
      p_customer: customerId,
    } as never) as unknown as { data: unknown; error: { message?: string } | null };
    if (error) {
      const mapped = wholesaleRpcErrorMessage(error.message || "attempt recovery unavailable");
      return errorResponse(mapped.error, mapped.status);
    }
    return NextResponse.json({ ok: true, data: Array.isArray(data) ? data : [] }, { headers: privateHeaders });
  } catch {
    return errorResponse("No se pudieron recuperar los intentos. Intentá nuevamente.", 503);
  }
}

export async function POST(request: Request) {
  const customerId = await getWholesaleSessionCustomerId();
  if (!customerId) return errorResponse("Ingresá a tu cuenta mayorista para iniciar una solicitud.", 401);
  if (!isSameOriginWrite(request)) return errorResponse("No se pudo validar el origen de la solicitud.", 403);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return errorResponse("El formato de la solicitud no es válido.", 400);
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("El contenido no es JSON válido.", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse("Revisá los productos e intentá nuevamente.", 400);
  const payload = body as Record<string, unknown>;
  const items = parseWholesaleRequestItems(payload.items);
  const keys = Object.keys(payload).sort().join(",");
  if ((keys !== "items" && keys !== "items,newIntent") || !items
    || (payload.newIntent !== undefined && typeof payload.newIntent !== "boolean")) return errorResponse("Revisá los productos y las cantidades e intentá nuevamente.", 400);
  if (!isServiceRoleConfigured()) return errorResponse("El servicio de pedidos no está disponible. Intentá más tarde.", 503);
  try {
    const { data, error } = await createAdminServerClient().rpc("start_wholesale_order_attempt" as never, {
      p_customer: customerId,
      p_items: items as never,
      p_new_intent: payload.newIntent === true,
    } as never) as unknown as { data: { attemptId?: string; status?: string } | null; error: { message?: string } | null };
    if (error || !data?.attemptId) {
      const mapped = wholesaleRpcErrorMessage(error?.message || "attempt could not start");
      return errorResponse(mapped.error, mapped.status);
    }
    return NextResponse.json({ ok: true, data }, { headers: privateHeaders });
  } catch {
    return errorResponse("No se pudo iniciar el intento. Intentá nuevamente.", 503);
  }
}
