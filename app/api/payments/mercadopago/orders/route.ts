import { providerGet, reconcileVerifiedOrder, type VerifiedOrder } from "@/lib/store/mercadopago-recovery";
import { scheduleAnalyticsFlush } from "@/lib/store/analytics-outbox";
import { NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/server";
import { apiError, apiInternalError, boundedString, readJsonObject } from "@/lib/api";
import { authorizedBuyerOrder, buyerNotFound, isSameOriginWrite } from "@/lib/store/buyer-session";
import { rateLimit } from "@/lib/rate-limit";

type MercadoPagoOrder = VerifiedOrder & { message?: string };

type MercadoPagoErrorDiagnostic = {
  error?: string;
  message?: string;
  code?: string;
  cause?: string | string[];
};
type LocalOrder = { total: number | string; currency: string; payment_method: string };
type LocalTransaction = { id: string; external_idempotency_key: string; external_order_id: string | null };

function sanitizeDiagnosticValue(value: unknown, maxLength = 180): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;

  const sanitized = String(value).replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
  return sanitized || undefined;
}

function sanitizeCause(value: unknown): string | string[] | undefined {
  if (Array.isArray(value)) {
    const causes = value
      .map((item) => {
        if (typeof item === "object" && item !== null) {
          const cause = item as Record<string, unknown>;
          return sanitizeDiagnosticValue(cause.code ?? cause.message ?? cause.description);
        }
        return sanitizeDiagnosticValue(item);
      })
      .filter((item): item is string => Boolean(item))
      .slice(0, 5);
    return causes.length ? causes : undefined;
  }

  if (typeof value === "object" && value !== null) {
    const cause = value as Record<string, unknown>;
    return sanitizeDiagnosticValue(cause.code ?? cause.message ?? cause.description);
  }

  return sanitizeDiagnosticValue(value);
}

function getMercadoPagoErrorDiagnostic(value: unknown): MercadoPagoErrorDiagnostic {
  if (!value || typeof value !== "object") return {};
  const payload = value as Record<string, unknown>;
  return {
    error: sanitizeDiagnosticValue(payload.error),
    message: sanitizeDiagnosticValue(payload.message),
    code: sanitizeDiagnosticValue(payload.code),
    cause: sanitizeCause(payload.cause ?? payload.details),
  };
}


export async function POST(request: Request) {
  const limited = rateLimit(request, "mercadopago-order", { limit: 10, windowMs: 60 * 1000 });
  if (limited) return limited;
  if (!isSameOriginWrite(request)) return buyerNotFound();
  try {
    const body = await readJsonObject(request);
    if (!body) return apiError("BAD_REQUEST", "Datos de pago inválidos.", 400);
    const orderId = await authorizedBuyerOrder(body.orderNumber);
    if (!orderId) return buyerNotFound();
    const token = boundedString(body.token, 4096, { required: true });
    const paymentMethodId = boundedString(body.payment_method_id, 80, { required: true });
    const paymentType = boundedString(body.payment_type, 80, { required: true });
    const installments = Number(body.installments);
    const payer = body.payer && typeof body.payer === "object" ? body.payer as Record<string, unknown> : {};
    const payerEmail = boundedString(payer.email, 254, { required: true });

    if (!token || !paymentMethodId || !paymentType || !payerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail) || !Number.isInteger(installments) || installments < 1 || installments > 36) {
      return NextResponse.json({ ok: false, error: "Datos de pago incompletos." }, { status: 400 });
    }

    const db = createAdminServerClient();
    const orderQuery = await db.from("orders").select("total,currency,payment_method").eq("id", orderId).single() as unknown as { data: LocalOrder | null };
    const transactionQuery = await db
      .from("payment_transactions")
      .select("id,external_idempotency_key,external_order_id")
      .eq("order_id", orderId)
      .eq("provider", "mercadopago")
      .single() as unknown as { data: LocalTransaction | null };
    const order = orderQuery.data;
    const transaction = transactionQuery.data;
    if (!order || !transaction || order.payment_method !== "card") return buyerNotFound();
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken) throw new Error("Mercado Pago no configurado.");
    // Query known operations without another charge, even after reservation expiry.
    if (transaction.external_order_id) {
      const verified = await providerGet(`/v1/orders/${encodeURIComponent(transaction.external_order_id)}`, accessToken);
      await reconcileVerifiedOrder(db, verified, transaction.external_order_id, orderId);
      scheduleAnalyticsFlush();
      return NextResponse.json({ ok: true });
    }
    const paymentWindow = await db.rpc("get_order_payment_window" as never, { p_order: orderId } as never) as unknown as { data: string | null; error: unknown };
    if (paymentWindow.error) return apiError("INTERNAL_ERROR", "No se pudo verificar la reserva.", 503);
    if (!paymentWindow.data || !Number.isFinite(Date.parse(paymentWindow.data)) || Date.parse(paymentWindow.data) <= Date.now()) return apiError("RESERVATION_EXPIRED", "La reserva ya no permite iniciar un pago.", 409);

    const claim = await db.rpc("begin_mercadopago_request" as never, { p_order: orderId } as never);
    if (claim.error) throw new Error("No se pudo preparar el pago.");
    if (claim.data !== true) return NextResponse.json({ ok: false, code: "PAYMENT_RECOVERY_PENDING", message: "El pago requiere verificación. Consultá el estado del pedido; no vuelvas a pagar." }, { status: 409 });

    const amount = Number(order.total).toFixed(2);
    const mercadoPagoRequest = {
      type: "online",
      processing_mode: "automatic",
      total_amount: amount,
      external_reference: transaction.external_idempotency_key,
      payer: { email: payerEmail, identification: payer.identification },
      transactions: {
        payments: [{ amount, payment_method: { id: paymentMethodId, type: paymentType, token, installments } }],
      },
    };
    const response = await fetch("https://api.mercadopago.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": transaction.external_idempotency_key,
      },
      body: JSON.stringify(mercadoPagoRequest),
    });
    let mercadoPagoOrder: MercadoPagoOrder;
    try {
      mercadoPagoOrder = (await response.json()) as MercadoPagoOrder;
    } catch {
      console.error("Mercado Pago Orders API returned an unreadable response", {
        stage: "mercadopago_order_response_parsing",
        responseStatus: response.status,
        responseOk: response.ok,
      });
      return NextResponse.json({ ok: false, error: "Respuesta inválida de Mercado Pago." }, { status: 502 });
    }
    if (!response.ok) {
      const diagnostic = getMercadoPagoErrorDiagnostic(mercadoPagoOrder);
      console.warn("Mercado Pago Orders API rejected the order", {
        stage: "mercadopago_order_creation",
        responseStatus: response.status,
        responseOk: response.ok,
        ...diagnostic,
      });
      const retryAfter = response.headers.get("retry-after");
      return NextResponse.json(
        { ok: false, error: "No se pudo procesar el pago. Consultá el estado de tu pedido.", retryAfter },
        { status: response.status === 429 || response.status === 423 ? 503 : 400 },
      );
    }
    if (!mercadoPagoOrder.id) throw new Error("Respuesta de pago sin identificador.");
    await reconcileVerifiedOrder(db, mercadoPagoOrder, mercadoPagoOrder.id, orderId);

    scheduleAnalyticsFlush();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiInternalError("mercadopago_order_creation", error);
  }
}
