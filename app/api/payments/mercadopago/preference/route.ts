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
    const windowResult = await db.rpc("get_order_payment_window" as never, { p_order: orderId } as never) as unknown as { data: string | null; error: unknown };
    if (windowResult.error) return apiError("INTERNAL_ERROR", "No se pudo verificar la reserva.", 503);
    if (!windowResult.data || !Number.isFinite(Date.parse(windowResult.data)) || Date.parse(windowResult.data) <= Date.now()) return apiError("RESERVATION_EXPIRED", "La reserva ya no permite iniciar el pago.", 409);
    const token = process.env.MERCADOPAGO_ACCESS_TOKEN; if (!token) throw new Error("Mercado Pago no configurado.");
    const baseUrl = checkoutProSiteUrl();
    const resultUrl = new URL("/checkout/resultado", baseUrl);
    // Checkout Pro usa una notificación payment propia de la preferencia. El
    // webhook global de Orders API permanece separado en /mercadopago/webhook.
    const notificationUrl = new URL("/api/payments/mercadopago/checkout-pro-webhook", baseUrl).toString();
    const expiration = new Date(windowResult.data).toISOString();
    // Reuse a linked preference without extending its reservation deadline.
    if (transaction.external_order_id) {
      const existingResponse = await fetch(`https://api.mercadopago.com/checkout/preferences/${encodeURIComponent(transaction.external_order_id)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const existing = await existingResponse.json() as { init_point?: string; expires?: boolean; expiration_date_to?: string; external_reference?: string };
      const deadline = Date.parse(existing.expiration_date_to || "");
      if (!existingResponse.ok || !existing.init_point || existing.external_reference !== orderId || !existing.expires || !Number.isFinite(deadline) || deadline > Date.parse(expiration) || deadline <= Date.now()) return apiError("RESERVATION_EXPIRED", "La preferencia anterior ya no permite continuar de forma segura.", 409);
      const rechecked = await db.rpc("get_order_payment_window" as never, { p_order: orderId } as never) as unknown as { data: string | null; error: unknown };
      if (rechecked.error || !rechecked.data || !Number.isFinite(Date.parse(rechecked.data)) || deadline > Date.parse(rechecked.data) || deadline <= Date.now()) return apiError("RESERVATION_EXPIRED", "La reserva ya no permite continuar.", 409);
      return NextResponse.json({ ok: true, checkoutUrl: existing.init_point });
    }
    const response = await fetch("https://api.mercadopago.com/checkout/preferences", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Idempotency-Key": transaction.external_idempotency_key }, body: JSON.stringify({ external_reference: order.id, items: [{ id: order.id, title: "Pedido DCL Cree LED", quantity: 1, currency_id: order.currency, unit_price: Number(order.total) }], back_urls: { success: `${resultUrl}?result=success&order=${order.id}`, pending: `${resultUrl}?result=pending&order=${order.id}`, failure: `${resultUrl}?result=failure&order=${order.id}` }, auto_return: "approved", notification_url: notificationUrl, expires: true, expiration_date_to: expiration, metadata: { local_order_id: order.id } }) });
    const preference = await response.json() as { id?: string; init_point?: string; sandbox_init_point?: string; message?: string };
    if (!response.ok || !preference.id || !preference.init_point) return NextResponse.json({ ok: false, error: preference.message || "No se pudo abrir Mercado Pago." }, { status: 502 });
    developmentLog("preference_created", { preferenceId: preference.id, orderId: order.id });
    const { data: linked, error } = await db.from("payment_transactions").update({ external_order_id: preference.id } as never).eq("id", transaction.id).or(`external_order_id.is.null,external_order_id.eq.${preference.id}`).select("id").maybeSingle();
    if (error || !linked) return apiError("BAD_REQUEST", "Otro intento ya preparó el pago. Reintentá para recuperar la preferencia vinculada.", 409);
    const finalWindow = await db.rpc("get_order_payment_window" as never, { p_order: orderId } as never) as unknown as { data: string | null; error: unknown };
    if (finalWindow.error || !finalWindow.data || !Number.isFinite(Date.parse(finalWindow.data)) || Date.parse(finalWindow.data) < Date.parse(expiration) || Date.parse(expiration) <= Date.now()) return apiError("RESERVATION_EXPIRED", "La reserva ya no permite continuar.", 409);
    developmentLog("preference_linked", { preferenceId: preference.id, orderId: order.id });
    return NextResponse.json({ ok: true, checkoutUrl: preference.init_point });
  } catch (error) { return apiInternalError("mercadopago_preference", error); }
}
