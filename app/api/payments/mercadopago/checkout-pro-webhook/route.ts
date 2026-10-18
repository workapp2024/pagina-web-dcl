import { reconcileCheckoutPro } from "@/lib/store/mercadopago-recovery";
import { scheduleAnalyticsFlush } from "@/lib/store/analytics-outbox";
import { InvalidWebhookSignatureError, WebhookSignatureValidator } from "mercadopago";
import { NextRequest, NextResponse } from "next/server";
import { createAdminServerClient } from "@/lib/supabase/server";
import { wholesaleCheckoutPreparedEnabled } from "@/lib/prepared-finance-features";
import { reconcileWholesaleCheckoutPayment } from "@/lib/wholesale-checkout";

// Este handler recibe eventos payment de Checkout Pro. Los eventos Order de
// Card Payment Brick continúan en /api/payments/mercadopago/webhook.

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
  try {
    const db = createAdminServerClient();
    let wholesale = false;
    await reconcileCheckoutPro(db, paymentId, token, async payment => {
      wholesale = true;
      if (!wholesaleCheckoutPreparedEnabled()) throw new Error("Wholesale checkout disabled");
      return reconcileWholesaleCheckoutPayment(db as unknown as Parameters<typeof reconcileWholesaleCheckoutPayment>[0], paymentId, token, payment);
    });
    if (!wholesale) scheduleAnalyticsFlush();
    return NextResponse.json({ ok: true });
  } catch {
    developmentLog("verification_or_recovery_failed", { paymentId });
    // Non-2xx retains retries without approving unverifiable payments.
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
