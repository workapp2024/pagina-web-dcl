import { NextResponse } from "next/server";
import { apiError, apiInternalError, isUuid, readJsonObject } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminServerClient } from "@/lib/supabase/server";

type Order = { id: string; total: number | string; currency: string; payment_method: string };
type Transaction = { id: string; external_idempotency_key: string; external_order_id: string | null };

function developmentLog(event: string, details: Record<string, string>) {
  if (process.env.NODE_ENV !== "production") console.info(`[Checkout Pro] ${event}`, details);
}

function checkoutProSiteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (!configured) throw new Error("NEXT_PUBLIC_SITE_URL no está configurada.");
  const siteUrl = new URL(configured);
  if (siteUrl.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(siteUrl.hostname)) {
    throw new Error("NEXT_PUBLIC_SITE_URL debe ser una URL pública HTTPS.");
  }
  return siteUrl.origin;
}

export async function POST(request: Request) {
  const limited = rateLimit(request, "mercadopago-preference", { limit: 10, windowMs: 60_000 }); if (limited) return limited;
  try {
    const body = await readJsonObject(request); const orderId = body?.orderId;
    if (!isUuid(orderId)) return apiError("BAD_REQUEST", "Pedido inválido.", 400);
    const db = createAdminServerClient();
    const { data: order } = await db.from("orders").select("id,total,currency,payment_method").eq("id", orderId).single() as unknown as { data: Order | null };
    const { data: transaction } = await db.from("payment_transactions").select("id,external_idempotency_key,external_order_id").eq("order_id", orderId).eq("provider", "mercadopago").single() as unknown as { data: Transaction | null };
    if (!order || !transaction || order.payment_method !== "mercadopago") return apiError("BAD_REQUEST", "El pedido no admite Checkout Pro.", 400);
    const token = process.env.MERCADOPAGO_ACCESS_TOKEN; if (!token) throw new Error("Mercado Pago no configurado.");
    const baseUrl = checkoutProSiteUrl();
    const resultUrl = new URL("/checkout/resultado", baseUrl);
    // Checkout Pro usa una notificación payment propia de la preferencia. El
    // webhook global de Orders API permanece separado en /mercadopago/webhook.
    const notificationUrl = new URL("/api/payments/mercadopago/checkout-pro-webhook", baseUrl).toString();
    const response = await fetch("https://api.mercadopago.com/checkout/preferences", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Idempotency-Key": transaction.external_idempotency_key }, body: JSON.stringify({ external_reference: order.id, items: [{ id: order.id, title: "Pedido DCL Cree LED", quantity: 1, currency_id: order.currency, unit_price: Number(order.total) }], back_urls: { success: `${resultUrl}?result=success&order=${order.id}`, pending: `${resultUrl}?result=pending&order=${order.id}`, failure: `${resultUrl}?result=failure&order=${order.id}` }, auto_return: "approved", notification_url: notificationUrl, metadata: { local_order_id: order.id } }) });
    const preference = await response.json() as { id?: string; init_point?: string; sandbox_init_point?: string; message?: string };
    if (!response.ok || !preference.id || !preference.init_point) return NextResponse.json({ ok: false, error: preference.message || "No se pudo abrir Mercado Pago." }, { status: 502 });
    developmentLog("preference_created", { preferenceId: preference.id, orderId: order.id });
    const { error } = await db.from("payment_transactions").update({ external_order_id: preference.id } as never).eq("id", transaction.id).or(`external_order_id.is.null,external_order_id.eq.${preference.id}`); if (error) throw new Error("No se pudo vincular la preferencia.");
    developmentLog("preference_linked", { preferenceId: preference.id, orderId: order.id });
    return NextResponse.json({ ok: true, checkoutUrl: preference.init_point });
  } catch (error) { return apiInternalError("mercadopago_preference", error); }
}
