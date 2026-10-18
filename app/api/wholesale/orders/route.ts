import { NextResponse } from "next/server";
import { getWholesaleSessionCustomerId } from "@/lib/wholesale-server";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import { isWholesaleSessionWriteAllowed } from "@/lib/wholesale-session-origin";
import { isWholesaleUuid, wholesaleRpcErrorMessage } from "@/lib/wholesale-order-api";
import { customerPaymentSummary, readCustomerPayments } from "@/lib/wholesale-customer-payment";
import { readTransferNotices } from "@/lib/wholesale-payment-notices";

const privateHeaders = { "Cache-Control": "no-store, private" };
const errorResponse = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers: privateHeaders });

export async function POST(request: Request) {
  const customerId = await getWholesaleSessionCustomerId();
  if (!customerId) return errorResponse("Ingresá a tu cuenta mayorista para enviar una solicitud.", 401);
  if (!isWholesaleSessionWriteAllowed(request)) return errorResponse("No se pudo validar el origen de la solicitud.", 403);
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
    const db = createAdminServerClient();
    const { data, error } = await db.rpc("list_wholesale_customer_orders" as never, {
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
    // IDs come exclusively from the session-scoped RPC, never from client input.
    const orderIds = orders.map(order => order.id as string);
    const publicTypes = ["order_created", "review_started", "revision_proposed", "revision_approved", "revision_rejected", "order_confirmed", "order_rejected", "order_cancelled", "delivery_recorded", "order_fully_delivered", "order_delivery_completion_reversed"];
    const tracking: { id: number; order_id: string; event_type: string; created_at: string }[] = [];
    if (orderIds.length) {
      for (let offset = 0; ; offset += 500) {
        const result = await db.from("wholesale_order_events")
          .select("id,order_id,event_type,created_at").in("order_id", orderIds)
          .in("event_type", publicTypes).order("created_at").order("id").range(offset, offset + 499);
        if (result.error) throw new Error("Customer tracking unavailable");
        const batch = result.data ?? [];
        tracking.push(...batch);
        if (batch.length < 500) break;
      }
    }
    const payments = await readCustomerPayments(db,orderIds);
    const notices=await readTransferNotices(db,orderIds);
    const settings=await db.from("site_settings").select("whatsapp").eq("id",1).maybeSingle() as unknown as {data:{whatsapp:string|null}|null;error:unknown};
    if(settings.error)throw settings.error;
    const presentedOrders = orders.map(order => ({ ...order, whatsapp:settings.data?.whatsapp??null,transfer_notices:notices.filter(n=>n.order_id===order.id),payment_summary:customerPaymentSummary(order.status,order.total_amount,order.currency,payments.filter(payment=>payment.order_id===order.id)), tracking_events: tracking
      .filter(event => event.order_id === order.id && publicTypes.includes(event.event_type))
      .map(event => ({ id: String(event.id), type: event.event_type, at: event.created_at })) }));
    const last = orders.at(-1) as { created_at?: string; id?: string } | undefined;
    const nextCursor = orders.length === limitValue && last?.created_at && last.id
      ? { beforeCreatedAt: last.created_at, beforeId: last.id }
      : null;
    return NextResponse.json({ ok: true, data: presentedOrders, nextCursor }, { headers: privateHeaders });
  } catch {
    return errorResponse("No se pudieron consultar las solicitudes. Intentá nuevamente.", 503);
  }
}
