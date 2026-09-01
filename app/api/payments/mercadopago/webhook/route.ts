import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/server";

function isValidSignature(request: Request, dataId: string) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET ?? "";
  const signature = request.headers.get("x-signature") ?? "";
  const requestId = request.headers.get("x-request-id") ?? "";
  const parts = Object.fromEntries(signature.split(",").map((part) => part.trim().split("=") as [string, string]));
  if (!secret || !requestId || !parts.ts || !parts.v1) return false;
  const expected = createHmac("sha256", secret)
    .update(`id:${dataId};request-id:${requestId};ts:${parts.ts};`)
    .digest("hex");
  return expected.length === parts.v1.length && timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const externalOrderId = url.searchParams.get("data.id") ?? "";
    const type = url.searchParams.get("type");
    const notification = await request.json();
    if (
      type !== "order" ||
      !externalOrderId ||
      String(notification?.type ?? "") !== "order" ||
      String(notification?.data?.id ?? "") !== externalOrderId ||
      !isValidSignature(request, externalOrderId)
    ) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken) throw new Error("Mercado Pago no configurado.");
    const response = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(externalOrderId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const order = await response.json();
    if (!response.ok || order.id !== externalOrderId || !order.external_reference || !order.currency) {
      throw new Error("No se pudo verificar la order de Mercado Pago.");
    }

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
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Error de webhook." }, { status: 500 });
  }
}
