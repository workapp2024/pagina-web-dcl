import { InvalidWebhookSignatureError, WebhookSignatureValidator } from "mercadopago";
import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/api";
import { createAdminServerClient } from "@/lib/supabase/server";

// Este handler recibe eventos payment de Checkout Pro. Los eventos Order de
// Card Payment Brick continúan en /api/payments/mercadopago/webhook.
type Payment = {
  id?: number | string;
  status?: string;
  external_reference?: string;
  transaction_amount?: number;
  currency_id?: string;
};

function developmentLog(event: string, details: Record<string, string | number | boolean | null>) {
  if (process.env.NODE_ENV !== "production") console.info(`[Checkout Pro webhook] ${event}`, details);
}

export async function POST(request: NextRequest) {
  const paymentId = request.nextUrl.searchParams.get("data.id");
  const type = request.nextUrl.searchParams.get("type");
  const signature = request.headers.get("x-signature");
  const requestId = request.headers.get("x-request-id");
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;

  developmentLog("received", { paymentId: paymentId || "missing", type: type || "missing" });
  if (type !== "payment" || !paymentId || !signature || !requestId || !secret) {
    developmentLog("rejected_parameters", { paymentId: paymentId || "missing", type: type || "missing", hasSignature: Boolean(signature), hasRequestId: Boolean(requestId), hasSecret: Boolean(secret) });
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  try {
    WebhookSignatureValidator.validate({ xSignature: signature, xRequestId: requestId, dataId: paymentId, secret });
    developmentLog("signature_valid", { paymentId });
  } catch (error) {
    developmentLog("signature_invalid", { paymentId, expectedValidationError: error instanceof InvalidWebhookSignatureError });
    return NextResponse.json({ ok: false }, { status: error instanceof InvalidWebhookSignatureError ? 401 : 500 });
  }

  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ ok: false }, { status: 503 });
  const provider = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!provider.ok) {
    developmentLog("payment_fetch_failed", { paymentId, providerStatus: provider.status });
    return NextResponse.json({ ok: false }, { status: 502 });
  }

  const payment = await provider.json() as Payment;
  if (!payment.id || !isUuid(payment.external_reference) || !Number.isFinite(Number(payment.transaction_amount)) || !payment.currency_id) {
    developmentLog("payment_invalid", { paymentId });
    return NextResponse.json({ ok: false }, { status: 502 });
  }

  const orderId = payment.external_reference;
  const db = createAdminServerClient();
  const { data: transaction } = await db
    .from("payment_transactions")
    .select("external_order_id")
    .eq("order_id", orderId)
    .eq("provider", "mercadopago")
    .single() as unknown as { data: { external_order_id: string | null } | null };
  if (!transaction?.external_order_id) {
    developmentLog("order_not_linked", { paymentId, orderId });
    return NextResponse.json({ ok: false }, { status: 409 });
  }

  const mappedStatus = payment.status === "approved"
    ? "processed"
    : payment.status === "rejected" || payment.status === "cancelled"
      ? "rejected"
      : "pending";
  const result = await db.rpc("complete_mercadopago_order", {
    p_order: orderId,
    p_external_order: transaction.external_order_id,
    p_payment: String(payment.id),
    p_amount: Number(payment.transaction_amount),
    p_currency: payment.currency_id,
    p_status: mappedStatus,
  } as never) as unknown as { data: string | null; error: { message: string } | null };
  if (result.error) {
    developmentLog("completion_failed", { paymentId, orderId, status: mappedStatus });
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  developmentLog("processed", { paymentId, orderId, status: mappedStatus, saleCreated: Boolean(result.data) });
  return NextResponse.json({ ok: true });
}
