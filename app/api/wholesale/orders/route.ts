import { NextResponse } from "next/server";
import { getWholesaleSessionCustomerId } from "@/lib/wholesale-server";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import { isSameOriginWrite } from "@/lib/store/buyer-session";
import { isWholesaleUuid, wholesaleRpcErrorMessage } from "@/lib/wholesale-order-api";

const privateHeaders = { "Cache-Control": "no-store, private" };
const errorResponse = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers: privateHeaders });

export async function POST(request: Request) {
  const customerId = await getWholesaleSessionCustomerId();
  if (!customerId) return errorResponse("Ingresá a tu cuenta mayorista para enviar una solicitud.", 401);
  if (!isSameOriginWrite(request)) return errorResponse("No se pudo validar el origen de la solicitud.", 403);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return errorResponse("El formato de la solicitud no es válido.", 400);

  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("El contenido de la solicitud no es JSON válido.", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse("Revisá los productos e intentá nuevamente.", 400);
  const payload = body as Record<string, unknown>;
  const legacy = Object.keys(payload).sort().join(",") === "idempotencyKey,items" && isWholesaleUuid(payload.idempotencyKey);
  if (legacy) return errorResponse("Esta versión del portal ya no acepta envíos antiguos. Actualizá la página e intentá desde el carrito.", 409);
  if (Object.keys(payload).join(",") !== "attemptId" || !isWholesaleUuid(payload.attemptId)) {
    return errorResponse("El intento no es válido. Recuperalo e intentá nuevamente.", 400);
  }
  if (!isServiceRoleConfigured()) return errorResponse("El servicio de pedidos no está disponible. Intentá más tarde.", 503);

  try {
    const result = await createAdminServerClient().rpc("submit_wholesale_order_attempt" as never, {
      p_customer: customerId, p_attempt: payload.attemptId,
    } as never);
    const { data, error } = result as unknown as { data: string | null; error: { message?: string } | null };
    if (error || !data) {
      const mapped = wholesaleRpcErrorMessage(error?.message || "empty response");
      return errorResponse(mapped.error, mapped.status);
    }
    return NextResponse.json({ ok: true, orderId: data }, { headers: privateHeaders });
  } catch {
    return errorResponse("No se pudo crear la solicitud. Intentá nuevamente.", 503);
  }
}

export async function GET(request: Request) {
  const customerId = await getWholesaleSessionCustomerId();
  if (!customerId) return errorResponse("Ingresá a tu cuenta mayorista para consultar tus solicitudes.", 401);
  if (!isServiceRoleConfigured()) return errorResponse("El servicio de pedidos no está disponible. Intentá más tarde.", 503);
  const query = new URL(request.url).searchParams;
  const limitValue = Number(query.get("limit") || 25);
  const beforeCreatedAt = query.get("beforeCreatedAt");
  const beforeId = query.get("beforeId");
  if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100
    || Boolean(beforeCreatedAt) !== Boolean(beforeId)
    || (beforeId && !isWholesaleUuid(beforeId))
    || (beforeCreatedAt && !Number.isFinite(Date.parse(beforeCreatedAt)))) {
    return errorResponse("El cursor de solicitudes no es válido.", 400);
  }
  try {
    const { data, error } = await createAdminServerClient().rpc("list_wholesale_customer_orders" as never, {
      p_customer: customerId,
      p_limit: limitValue,
      p_before_created_at: beforeCreatedAt,
      p_before_id: beforeId,
    } as never) as unknown as { data: unknown; error: { message?: string } | null };
    if (error) {
      const mapped = wholesaleRpcErrorMessage(error.message || "order history unavailable");
      return errorResponse(mapped.error, mapped.status);
    }
    const orders = Array.isArray(data) ? data : [];
    const last = orders.at(-1) as { created_at?: string; id?: string } | undefined;
    const nextCursor = orders.length === limitValue && last?.created_at && last.id
      ? { beforeCreatedAt: last.created_at, beforeId: last.id }
      : null;
    return NextResponse.json({ ok: true, data: orders, nextCursor }, { headers: privateHeaders });
  } catch {
    return errorResponse("No se pudieron consultar las solicitudes. Intentá nuevamente.", 503);
  }
}
