import { commercialAnalyticsEnvironment } from "@/lib/commercial-analytics-config";
import { scheduleAnalyticsFlush } from "@/lib/store/analytics-outbox";
import { NextResponse } from "next/server";
import { apiError, apiInternalError, boundedString, isUuid, readJsonObject } from "@/lib/api";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { isResolutionType, refundResolutions } from "@/lib/store/order-resolutions";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";

const conflicts: Record<string, string> = {
  ORDER_RESOLUTION_ALREADY_APPLIED: "Esta resolución ya fue registrada. Actualizá el pedido.",
  ORDER_RESOLUTION_IDEMPOTENCY_CONFLICT: "El intento ya se usó con otros datos. Cerrá y volvé a abrir la acción.",
  ORDER_RESOLUTION_DELIVERED: "Los pedidos entregados requieren el futuro flujo de postventa.",
  ORDER_RESOLUTION_CLOSED: "El pedido ya está cerrado y no admite esta acción.",
  ORDER_RESOLUTION_NOT_PENDING: "El pedido ya no tiene un pago pendiente que pueda cancelarse.",
  ORDER_RESOLUTION_INVALID_STATE: "El estado del pedido, pago o venta cambió. Actualizá la lista.",
  ORDER_RESOLUTION_TRANSFER_ONLY: "Esta corrección sólo corresponde a transferencias.",
  ORDER_RESOLUTION_INSUFFICIENT_STOCK: "El stock disponible actualmente no alcanza para completar la venta.",
  ORDER_RESOLUTION_PAYMENT_AMBIGUOUS: "El pago requiere revisión manual antes de resolver el pedido.",
  ORDER_RESOLUTION_SALE_MISSING: "La venta vinculada no está disponible. Requiere revisión manual.",
  ORDER_RESOLUTION_NO_ITEMS: "El pedido no tiene productos para completar.",
};

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return apiError("UNAUTHORIZED", "No autorizado.", 401);
  if (!isServiceRoleConfigured()) return apiError("CONFIGURATION_ERROR", "Falta configurar el acceso al servidor.", 503);
  const body = await readJsonObject(request);
  if (!body || !isUuid(body.orderId) || !isUuid(body.idempotencyKey) || !isResolutionType(body.resolutionType)) {
    return apiError("BAD_REQUEST", "Seleccioná un pedido y una resolución válidos.", 400);
  }
  const note = boundedString(body.note, 1000, { required: true });
  const reference = boundedString(body.externalReference, 160);
  if (!note || reference === null || (refundResolutions.includes(body.resolutionType) && !reference)) {
    return apiError("BAD_REQUEST", "Indicá un motivo y, para reembolsos, la referencia externa.", 400);
  }
  try {
    const db = createAdminServerClient();
    const { data, error } = await db.rpc("resolve_order" as never, {
      p_analytics_environment: commercialAnalyticsEnvironment(),
      p_order: body.orderId,
      p_resolution: body.resolutionType,
      p_external_reference: reference || null,
      p_note: note,
      p_idempotency_key: body.idempotencyKey,
    } as never) as unknown as { data: unknown; error: { message: string } | null };
    if (error) {
      if (error.message === "ORDER_RESOLUTION_NOT_FOUND") return apiError("NOT_FOUND", "Pedido no encontrado.", 404);
      if (conflicts[error.message]) return apiError("BAD_REQUEST", conflicts[error.message], 409);
      throw new Error(error.message);
    }
    scheduleAnalyticsFlush();
    return NextResponse.json({ ok: true, resolution: data });
  } catch (error) { return apiInternalError("admin_order_resolution", error); }
}
