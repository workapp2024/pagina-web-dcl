import { NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/server";
import { apiError, apiInternalError, boundedString, isUuid, readJsonObject } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";

type MercadoPagoOrder = {
  id?: string;
  status?: string;
  currency?: string;
  total_amount?: string | number;
  external_reference?: string;
  message?: string;
  transactions?: { payments?: Array<{ id?: string; status?: string }> };
};

type MercadoPagoErrorDiagnostic = {
  error?: string;
  message?: string;
  code?: string;
  cause?: string | string[];
};
type LocalOrder = { total: number | string; currency: string };
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

function localStatus(status?: string): "pending" | "approved" | "rejected" | "error" {
  if (status === "processed") return "approved";
  if (status === "rejected" || status === "cancelled") return "rejected";
  return "pending";
}

export async function POST(request: Request) {
  const limited = rateLimit(request, "mercadopago-order", { limit: 10, windowMs: 60 * 1000 });
  if (limited) return limited;
  try {
    const body = await readJsonObject(request);
    if (!body) return apiError("BAD_REQUEST", "Datos de pago inválidos.", 400);
    const orderId = body.orderId;
    const token = boundedString(body.token, 4096, { required: true });
    const paymentMethodId = boundedString(body.payment_method_id, 80, { required: true });
    const paymentType = boundedString(body.payment_type, 80, { required: true });
    const installments = Number(body.installments);
    const payer = body.payer && typeof body.payer === "object" ? body.payer as Record<string, unknown> : {};
    const payerEmail = boundedString(payer.email, 254, { required: true });

    if (!isUuid(orderId) || !token || !paymentMethodId || !paymentType || !payerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail) || !Number.isInteger(installments) || installments < 1 || installments > 36) {
      return NextResponse.json({ ok: false, error: "Datos de pago incompletos." }, { status: 400 });
    }

    const db = createAdminServerClient();
    const orderQuery = await db.from("orders").select("total,currency").eq("id", orderId).single() as unknown as { data: LocalOrder | null };
    const transactionQuery = await db
      .from("payment_transactions")
      .select("id,external_idempotency_key,external_order_id")
      .eq("order_id", orderId)
      .eq("provider", "mercadopago")
      .single() as unknown as { data: LocalTransaction | null };
    const order = orderQuery.data;
    const transaction = transactionQuery.data;
    if (!order || !transaction) throw new Error("Pedido no encontrado.");

    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken) throw new Error("Mercado Pago no configurado.");

    const amount = Number(order.total).toFixed(2);
    const mercadoPagoRequest = {
      type: "online",
      processing_mode: "automatic",
      total_amount: amount,
      external_reference: orderId,
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
        { ok: false, error: mercadoPagoOrder.message || "No se pudo procesar el pago.", retryAfter },
        { status: response.status === 429 || response.status === 423 ? 503 : 400 },
      );
    }
    if (
      !mercadoPagoOrder.id ||
      mercadoPagoOrder.external_reference !== orderId ||
      Number(mercadoPagoOrder.total_amount) !== Number(order.total) ||
      (mercadoPagoOrder.currency && mercadoPagoOrder.currency !== order.currency)
    ) {
      throw new Error("La respuesta de Mercado Pago no coincide con el pedido local.");
    }

    const payment = mercadoPagoOrder.transactions?.payments?.[0];
    const { error } = await db
      .from("payment_transactions")
      .update({
        external_order_id: mercadoPagoOrder.id,
        external_payment_id: payment?.id ?? null,
        status: localStatus(mercadoPagoOrder.status),
      } as never)
      .eq("id", transaction.id)
      .or(`external_order_id.is.null,external_order_id.eq.${mercadoPagoOrder.id}`);
    if (error) throw new Error("No se pudo vincular la operación de Mercado Pago.");

    return NextResponse.json({ ok: true, data: mercadoPagoOrder });
  } catch (error) {
    return apiInternalError("mercadopago_order_creation", error);
  }
}
