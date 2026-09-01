import { InvalidWebhookSignatureError, WebhookSignatureValidator } from "mercadopago";
import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/server";

type MercadoPagoOrder = {
  id?: string;
  external_reference?: string;
  currency?: string;
  total_amount?: string | number;
  status?: string;
  transactions?: { payments?: Array<{ id?: string | number }> };
};

function isMercadoPagoOrder(value: unknown, externalOrderId: string): value is MercadoPagoOrder {
  if (!value || typeof value !== "object") return false;
  const order = value as MercadoPagoOrder;
  return order.id === externalOrderId && Boolean(order.external_reference) && Boolean(order.currency);
}

export async function POST(request: NextRequest) {
  let stage = "request_received";
  const type = request.nextUrl.searchParams.get("type");
  const externalOrderId = request.nextUrl.searchParams.get("data.id");
  const xSignature = request.headers.get("x-signature");
  const xRequestId = request.headers.get("x-request-id");
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;

  if (!type || !externalOrderId || !xSignature || !xRequestId || !secret) {
    console.warn("Mercado Pago webhook rejected", {
      stage: "required_parameters",
      hasExternalOrderId: Boolean(externalOrderId),
      hasSignature: Boolean(xSignature),
      hasRequestId: Boolean(xRequestId),
      hasSecret: Boolean(secret),
      type,
    });
    return NextResponse.json({ ok: false, error: "Missing webhook parameters." }, { status: 400 });
  }
  if (type !== "order") {
    console.warn("Mercado Pago webhook rejected", { stage: "query_validation", reason: "unsupported_type", type });
    return NextResponse.json({ ok: false, error: "Unsupported notification type." }, { status: 400 });
  }

  try {
    stage = "signature_validation";
    WebhookSignatureValidator.validate({ xSignature, xRequestId, dataId: externalOrderId, secret });
  } catch (error) {
    if (error instanceof InvalidWebhookSignatureError) {
      console.warn("Mercado Pago webhook rejected", { stage, reason: error.reason, requestId: error.requestId });
      return NextResponse.json({ ok: false, error: "Invalid webhook signature." }, { status: 401 });
    }
    console.error("Mercado Pago webhook validator failed", { stage, error: error instanceof Error ? error.name : "unknown_error" });
    return NextResponse.json({ ok: false, error: "Webhook validation failed." }, { status: 500 });
  }

  // The body is not part of signature validation or order processing.
  // It is parsed only as best-effort diagnostics; malformed JSON is ignored.
  try {
    stage = "optional_body_parsing";
    const rawBody = await request.text();
    if (rawBody) JSON.parse(rawBody);
  } catch {
    console.warn("Mercado Pago webhook body ignored", { stage, reason: "invalid_or_unavailable_json", hasExternalOrderId: true });
  }

  try {
    stage = "mercadopago_order_fetch";
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken) {
      console.error("Mercado Pago webhook unavailable", { stage, reason: "missing_access_token" });
      return NextResponse.json({ ok: false, error: "Payment provider is not configured." }, { status: 503 });
    }
    const response = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(externalOrderId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (response.status === 404) {
      console.warn("Mercado Pago webhook ignored", { stage, reason: "external_order_not_found", externalOrderId });
      return NextResponse.json({ ok: true, ignored: "external_order_not_found" });
    }
    if (!response.ok) {
      console.error("Mercado Pago webhook provider error", { stage, status: response.status });
      return NextResponse.json({ ok: false, error: "Could not verify payment order." }, { status: 502 });
    }

    let order: unknown;
    try {
      order = await response.json();
    } catch {
      console.error("Mercado Pago webhook provider error", { stage, reason: "invalid_order_response" });
      return NextResponse.json({ ok: false, error: "Could not verify payment order." }, { status: 502 });
    }
    if (!isMercadoPagoOrder(order, externalOrderId)) {
      console.error("Mercado Pago webhook provider error", { stage, reason: "inconsistent_order_response" });
      return NextResponse.json({ ok: false, error: "Could not verify payment order." }, { status: 502 });
    }

    stage = "local_order_completion";
    const payment = order.transactions?.payments?.[0];
    const db = createAdminServerClient();
    const result: any = await db.rpc("complete_mercadopago_order", {
      p_order: order.external_reference,
      p_external_order: order.id,
      p_payment: payment?.id ? String(payment.id) : "",
      p_amount: Number(order.total_amount),
      p_currency: order.currency,
      p_status: order.status,
    } as never);
    if (result.error) throw new Error(result.error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Mercado Pago webhook failed", {
      stage,
      externalOrderId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ ok: false, error: "Webhook processing failed." }, { status: 500 });
  }
}
