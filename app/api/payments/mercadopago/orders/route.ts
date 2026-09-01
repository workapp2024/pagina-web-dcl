import { NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/server";

type MercadoPagoOrder = {
  id?: string;
  status?: string;
  currency?: string;
  total_amount?: string | number;
  external_reference?: string;
  message?: string;
  transactions?: { payments?: Array<{ id?: string; status?: string }> };
};

function localStatus(status?: string): "pending" | "approved" | "rejected" | "error" {
  if (status === "processed") return "approved";
  if (status === "rejected" || status === "cancelled") return "rejected";
  return "pending";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const orderId = String(body.orderId ?? "");
    const token = String(body.token ?? "");
    const paymentMethodId = String(body.payment_method_id ?? "");
    const paymentType = String(body.payment_type ?? "");
    const installments = Number(body.installments);
    const payerEmail = String(body.payer?.email ?? "").trim();

    if (!orderId || !token || !paymentMethodId || !paymentType || !payerEmail || !Number.isInteger(installments) || installments < 1) {
      return NextResponse.json({ ok: false, error: "Datos de pago incompletos." }, { status: 400 });
    }

    const db = createAdminServerClient();
    const orderQuery: any = await db.from("orders").select("total,currency").eq("id", orderId).single();
    const transactionQuery: any = await db
      .from("payment_transactions")
      .select("id,external_idempotency_key,external_order_id")
      .eq("order_id", orderId)
      .eq("provider", "mercadopago")
      .single();
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
      payer: { email: payerEmail, identification: body.payer?.identification },
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
    const mercadoPagoOrder = (await response.json()) as MercadoPagoOrder;
    if (!response.ok) {
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
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Error de pago." }, { status: 400 });
  }
}
