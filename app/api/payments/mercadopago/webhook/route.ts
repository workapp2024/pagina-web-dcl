import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/server";

type SignatureValidation = { ok: true } | { ok: false; reason: string };

function validateSignature(request: Request, dataId: string): SignatureValidation {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET ?? "";
  const signature = request.headers.get("x-signature") ?? "";
  const requestId = request.headers.get("x-request-id") ?? "";
  const parts = new Map<string, string>();
  for (const part of signature.split(",")) {
    const separator = part.indexOf("=");
    if (separator > 0) parts.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  const timestamp = parts.get("ts");
  const received = parts.get("v1");
  if (!secret) return { ok: false, reason: "missing_webhook_secret" };
  if (!dataId || !requestId || !timestamp || !received) return { ok: false, reason: "missing_signature_fields" };
  if (!/^\d+$/.test(timestamp) || !/^[a-fA-F0-9]+$/.test(received)) return { ok: false, reason: "invalid_signature_format" };
  const expected = createHmac("sha256", secret)
    .update(`id:${dataId};request-id:${requestId};ts:${timestamp};`)
    .digest("hex");
  if (expected.length !== received.length) return { ok: false, reason: "signature_length_mismatch" };
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received))
    ? { ok: true }
    : { ok: false, reason: "signature_mismatch" };
}

function isOrderNotification(value: unknown, externalOrderId: string): boolean {
  if (!value || typeof value !== "object") return false;
  const notification = value as { type?: unknown; data?: { id?: unknown } };
  return notification.type === "order" && String(notification.data?.id ?? "") === externalOrderId;
}

export async function POST(request: Request) {
  let stage = "request_received";
  let externalOrderId = "";
  try {
    const url = new URL(request.url);
    externalOrderId = url.searchParams.get("data.id") ?? "";
    const type = url.searchParams.get("type");
    stage = "signature_validation";
    const signature = validateSignature(request, externalOrderId);
    if (!signature.ok) {
      console.warn("Mercado Pago webhook rejected", { stage, reason: signature.reason, hasExternalOrderId: Boolean(externalOrderId), type });
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    stage = "body_parsing";
    const rawBody = await request.text();
    let notification: unknown;
    try {
      notification = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      console.warn("Mercado Pago webhook rejected", { stage, reason: "invalid_json", hasExternalOrderId: Boolean(externalOrderId), type });
      return NextResponse.json({ ok: false, error: "Invalid JSON notification." }, { status: 400 });
    }
    if (
      type !== "order" ||
      !externalOrderId ||
      !isOrderNotification(notification, externalOrderId)
    ) {
      console.warn("Mercado Pago webhook rejected", { stage: "notification_validation", reason: "invalid_order_notification", hasExternalOrderId: Boolean(externalOrderId), type });
      return NextResponse.json({ ok: false, error: "Invalid order notification." }, { status: 400 });
    }

    stage = "mercadopago_order_fetch";
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken) throw new Error("Mercado Pago no configurado.");
    const response = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(externalOrderId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const order = await response.json();
    // El simulador de Webhooks permite usar un Data ID arbitrario. Después de
    // validar su firma, un 404 de Orders API no representa un pago ni un error
    // interno: se confirma la recepción y se omite sin llamar a la RPC.
    if (response.status === 404) {
      console.warn("Mercado Pago webhook ignored: external order not found", { externalOrderId });
      return NextResponse.json({ ok: true, ignored: "external_order_not_found" });
    }
    if (!response.ok || order.id !== externalOrderId || !order.external_reference || !order.currency) {
      throw new Error("No se pudo verificar la order de Mercado Pago.");
    }

    const payment = order.transactions?.payments?.[0];
    stage = "local_order_completion";
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
      externalOrderId: externalOrderId || undefined,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Error de webhook." }, { status: 500 });
  }
}
