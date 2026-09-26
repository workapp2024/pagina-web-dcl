import { commercialAnalyticsEnvironment } from "@/lib/commercial-analytics-config";
import { scheduleAnalyticsFlush } from "@/lib/store/analytics-outbox";
import { NextResponse } from "next/server";

import { apiError, apiInternalError, boundedString, isUuid, readJsonObject } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminServerClient } from "@/lib/supabase/server";
import { sanitizeAnalyticsContext } from "@/lib/store/analytics-context";
import { normalizeOrderItems } from "@/lib/store/order-input";
import { buyerNotFound, claimBuyerAttempt, getBuyerSession, isSameOriginWrite, recoverBuyerOrder } from "@/lib/store/buyer-session";

const PAYMENT_METHODS = new Set(["mercadopago", "card", "transfer"]);
type RpcError = { code?: string; message?: string; details?: string; hint?: string };
type RpcResult = { data: string | null; error: RpcError | null };

export async function POST(request: Request) {
  const limited = rateLimit(request, "public-order", { limit: 10, windowMs: 60 * 1000 });
  if (limited) return limited;
  if (!isSameOriginWrite(request)) return buyerNotFound();

  const body = await readJsonObject(request);
  if (!body) return apiError("BAD_REQUEST", "El pedido no tiene un formato válido.", 400);

  const name = boundedString(body.name, 120, { required: true });
  const phone = boundedString(body.phone, 40, { required: true });
  const email = boundedString(body.email, 254) ?? "";
  const fulfillment = body.fulfillment === "pickup" || body.fulfillment === "delivery" ? body.fulfillment : null;
  const address = boundedString(body.address, 300) ?? "";
  const notes = boundedString(body.notes, 1000) ?? "";
  const paymentMethod = typeof body.paymentMethod === "string" && PAYMENT_METHODS.has(body.paymentMethod) ? body.paymentMethod : null;
  const idempotencyKey = body.idempotencyKey;
  const items = Array.isArray(body.items) && body.items.length > 0 && body.items.length <= 50
    ? body.items.map((item) => item && typeof item === "object" ? {
      productId: boundedString((item as Record<string, unknown>).productId, 64, { required: true }),
      quantity: Number((item as Record<string, unknown>).quantity),
    } : null)
    : null;

  if (!name || !phone || !fulfillment || !paymentMethod || !isUuid(idempotencyKey) || !items || items.some((item) => !item?.productId || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100)) {
    return apiError("BAD_REQUEST", "Revisá los datos del pedido e intentá nuevamente.", 400);
  }
  if (fulfillment === "delivery" && !address) return apiError("BAD_REQUEST", "La dirección es obligatoria para entrega.", 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return apiError("BAD_REQUEST", "El email no tiene un formato válido.", 400);

  let normalizedItems;
  try { normalizedItems = normalizeOrderItems(items as { productId: string; quantity: number }[]); }
  catch { return apiError("INVALID_QUANTITY", "Revisá las cantidades acumuladas por producto.", 400); }

  try {
    const session = await getBuyerSession();
    if (!session) return buyerNotFound();
    const requestFingerprint = JSON.stringify({ name, phone, email, fulfillment, address: fulfillment === "delivery" ? address : "", notes, paymentMethod, items: normalizedItems });
    if (!(await claimBuyerAttempt(session.id, idempotencyKey, requestFingerprint))) return buyerNotFound();
    const recovered = await recoverBuyerOrder(session.id, idempotencyKey);
    if (recovered) return NextResponse.json({ ok: true, orderNumber: recovered }, { headers: { "Cache-Control": "no-store" } });
    const db = createAdminServerClient();
    if (paymentMethod === "transfer") {
      const { data: settings } = await db.from("site_settings").select("transfer_alias,transfer_cbu_cvu,transfer_holder,transfer_institution").eq("id", 1).maybeSingle() as unknown as { data: { transfer_alias: string; transfer_cbu_cvu: string; transfer_holder: string; transfer_institution: string } | null };
      if (!settings || !(settings.transfer_alias.trim() || settings.transfer_cbu_cvu.trim()) || !settings.transfer_holder.trim() || !settings.transfer_institution.trim()) return apiError("CONFIGURATION_ERROR", "La transferencia no está disponible en este momento.", 409);
    }
    const result = await db.rpc("create_public_order", {
      p_name: name, p_phone: phone, p_email: email, p_fulfillment: fulfillment, p_address: address,
      p_notes: notes, p_method: paymentMethod, p_items: normalizedItems, p_key: idempotencyKey,
      p_analytics_context: sanitizeAnalyticsContext(body.analytics_context), p_analytics_environment: commercialAnalyticsEnvironment(),
    } as never) as unknown as RpcResult;
    if (result.error || !result.data) {
      const recovered = await recoverBuyerOrder(session.id, idempotencyKey);
      if (recovered) return NextResponse.json({ ok: true, orderNumber: recovered }, { headers: { "Cache-Control": "no-store" } });
      const diagnostic = { stage: "create_public_order", code: result.error?.code, message: result.error?.message, details: result.error?.details, hint: result.error?.hint };
      console.warn("Public order rejected", process.env.NODE_ENV === "production" ? { stage: diagnostic.stage, code: diagnostic.code } : diagnostic);
      const reason = result.error?.message;
      if (reason === "IDEMPOTENCY_CONFLICT") return apiError("IDEMPOTENCY_CONFLICT", "La compra cambió. Volvé a preparar el pedido.", 409);
      if (reason === "RESERVATION_EXPIRED") return apiError("RESERVATION_EXPIRED", "El pedido ya no tiene una reserva vigente. Iniciá una nueva compra.", 409);
      if (reason === "OUT_OF_STOCK") return apiError("OUT_OF_STOCK", "No hay stock suficiente para completar el pedido.", 409);
      if (reason === "PRODUCT_NOT_FOUND") return apiError("PRODUCT_NOT_FOUND", "Uno de los productos ya no está disponible.", 404);
      if (reason === "PRODUCT_INACTIVE") return apiError("PRODUCT_INACTIVE", "Uno de los productos fue desactivado.", 409);
      if (reason === "INVALID_QUANTITY") return apiError("INVALID_QUANTITY", "La cantidad solicitada no es válida.", 400);
      if (reason === "PRICE_ERROR") return apiError("PRICE_ERROR", "No se pudo validar el precio de un producto.", 409);
      return apiError("ORDER_CREATION_ERROR", "No se pudo crear el pedido. Intentá nuevamente.", 500);
    }
    scheduleAnalyticsFlush();
    const orderNumber = await recoverBuyerOrder(session.id, idempotencyKey);
    if (!orderNumber) return apiError("INTERNAL_ERROR", "No se pudo preparar la recuperación. Conservá este intento.", 503);
    return NextResponse.json({ ok: true, orderNumber }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiInternalError("create_public_order", error);
  }
}
