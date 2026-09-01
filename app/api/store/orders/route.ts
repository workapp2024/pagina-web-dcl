import { NextResponse } from "next/server";

import { apiError, apiInternalError, boundedString, isUuid, readJsonObject } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminServerClient } from "@/lib/supabase/server";

const PAYMENT_METHODS = new Set(["mercadopago", "transfer", "cash"]);
type RpcResult = { data: string | null; error: { code?: string } | null };
type TotalQuery = { data: { total: number | string } | null; error: unknown };

export async function POST(request: Request) {
  const limited = rateLimit(request, "public-order", { limit: 10, windowMs: 60 * 1000 });
  if (limited) return limited;

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
  const items = Array.isArray(body.items) && body.items.length > 0 && body.items.length <= 30
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

  try {
    const db = createAdminServerClient();
    const result = await db.rpc("create_public_order", {
      p_name: name, p_phone: phone, p_email: email, p_fulfillment: fulfillment, p_address: address,
      p_notes: notes, p_method: paymentMethod, p_items: items, p_key: idempotencyKey,
    } as never) as unknown as RpcResult;
    if (result.error || !result.data) {
      console.warn("Public order rejected", { stage: "create_public_order", code: result.error?.code });
      return apiError("BAD_REQUEST", "No se pudo crear el pedido. Verificá el stock e intentá nuevamente.", 400);
    }
    const totalQuery = await db.from("orders").select("total").eq("id", result.data).single() as unknown as TotalQuery;
    if (totalQuery.error || !totalQuery.data) return apiError("INTERNAL_ERROR", "No se pudo preparar el pedido.", 500);
    return NextResponse.json({ ok: true, orderId: result.data, total: Number(totalQuery.data.total || 0), publicKey: process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY || null });
  } catch (error) {
    return apiInternalError("create_public_order", error);
  }
}
