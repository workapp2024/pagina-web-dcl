import "server-only";
import { isUuid } from "@/lib/api";
import { createAdminServerClient } from "@/lib/supabase/server";
import { commercialAnalyticsEnvironment } from "@/lib/commercial-analytics-config";

type DB = ReturnType<typeof createAdminServerClient>;
type Transaction = { id: string; order_id: string; external_order_id: string | null; external_idempotency_key: string; provider_request_started_at: string | null };
export type VerifiedOrder = {
  id?: string; type?: string; processing_mode?: string; external_reference?: string;
  currency?: string; country_code?: string; total_amount?: string | number; status?: string;
  transactions?: { payments?: Array<{ id?: string | number; status?: string; amount?: string | number }> };
};

async function findTransaction(db: DB, reference: unknown, expectedOrder?: string): Promise<Transaction> {
  if (!isUuid(reference)) throw new Error("Invalid provider reference");
  const columns = "id,order_id,external_order_id,external_idempotency_key,provider_request_started_at";
  const modern = await db.from("payment_transactions").select(columns).eq("provider", "mercadopago").eq("external_idempotency_key", reference).maybeSingle();
  if (modern.error) throw new Error("Payment lookup unavailable");
  let transaction = modern.data as unknown as Transaction | null;
  if (!transaction) {
    const legacy = await db.from("payment_transactions").select(columns).eq("provider", "mercadopago").eq("order_id", reference).maybeSingle();
    if (legacy.error) throw new Error("Payment lookup unavailable");
    transaction = legacy.data as unknown as Transaction | null;
    if (transaction?.provider_request_started_at) throw new Error("Legacy reference forbidden for new payment");
  }
  if (!transaction || (expectedOrder && transaction.order_id !== expectedOrder)) throw new Error("Payment reference mismatch");
  return transaction;
}

async function incident(db: DB, transaction: Transaction): Promise<never> {
  const result = await db.from("payment_transactions").update({ recovery_issue: "verification_failed" } as never).eq("id", transaction.id);
  if (result.error) throw new Error("Payment incident persistence failed");
  throw new Error("Provider payment verification failed");
}

async function complete(db: DB, transaction: Transaction, facts: {
  reference: string; flow: "orders" | "preference"; external: string; payment: string;
  amount: number; currency: string; status: string;
}) {
  const result = await db.rpc("reconcile_mercadopago_payment" as never, {
    p_order: transaction.order_id, p_transaction: transaction.id, p_reference: facts.reference,
    p_flow: facts.flow, p_external_order: facts.external, p_payment: facts.payment,
    p_amount: facts.amount, p_currency: facts.currency, p_status: facts.status,
    p_analytics_environment: commercialAnalyticsEnvironment(),
  } as never) as unknown as { data: { ok: boolean } | null; error: unknown };
  if (result.error || !result.data?.ok) throw new Error("Payment reconciliation requires retry or review");
}

export async function reconcileVerifiedOrder(db: DB, order: VerifiedOrder, externalId: string, expectedOrder?: string) {
  const transaction = await findTransaction(db, order.external_reference, expectedOrder);
  const payments = order.transactions?.payments;
  const payment = payments?.[0];
  // Orders responses expose country_code in versions without currency. Only AR is supported.
  const currency = order.currency ?? (order.country_code === "AR" ? "ARS" : undefined);
  if (order.id !== externalId || order.type !== "online" || order.processing_mode !== "automatic"
    || !currency || (order.country_code && order.country_code !== "AR") || !Number.isFinite(Number(order.total_amount)) || Number(order.total_amount) <= 0
    || payments?.length !== 1 || !payment?.id || !order.status
    || !["processed", "processing", "action_required", "created", "pending", "rejected", "cancelled"].includes(order.status)
    || (order.status === "processed" && !["processed", "approved"].includes(payment.status || ""))
    || (payment.amount !== undefined && Number(payment.amount) !== Number(order.total_amount))) return incident(db, transaction);
  return complete(db, transaction, {
    reference: order.external_reference!, flow: "orders", external: externalId, payment: String(payment.id),
    amount: Number(order.total_amount), currency,
    status: ["processed", "rejected", "cancelled"].includes(order.status) ? order.status : "pending",
  });
}

export async function providerGet(path: string, token: string): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error",
  });
  if (!response.ok) throw new Error("Provider verification unavailable");
  return response.json();
}

export async function reconcileCheckoutPro(db: DB, paymentId: string, token: string) {
  const payment = await providerGet(`/v1/payments/${encodeURIComponent(paymentId)}`, token);
  if (String(payment.id) !== paymentId) throw new Error("Provider payment ID mismatch");
  const transaction = await findTransaction(db, payment.external_reference);
  const origin = payment.order as { id?: string | number; type?: string } | undefined;
  // GET payment -> merchant order -> preference is provider-owned evidence, not redirect/query data.
  if (!origin?.id || origin.type !== "mercadopago") return incident(db, transaction);
  const merchant = await providerGet(`/merchant_orders/${encodeURIComponent(String(origin.id))}`, token);
  const merchantPayments = merchant.payments as Array<{ id?: string | number }> | undefined;
  if (String(merchant.id) !== String(origin.id) || merchant.external_reference !== payment.external_reference
    || typeof merchant.preference_id !== "string" || !merchant.preference_id
    || !merchantPayments?.some(p => String(p.id) === paymentId)
    || (transaction.external_order_id && transaction.external_order_id !== merchant.preference_id)) return incident(db, transaction);
  const preference = await providerGet(`/checkout/preferences/${encodeURIComponent(merchant.preference_id)}`, token);
  const metadata = preference.metadata as { local_order_id?: string; payment_transaction_id?: string } | undefined;
  if (preference.id !== merchant.preference_id || preference.external_reference !== payment.external_reference
    || (metadata?.local_order_id && metadata.local_order_id !== transaction.order_id)
    || (metadata?.payment_transaction_id && metadata.payment_transaction_id !== transaction.id)
    || !Number.isFinite(Number(payment.transaction_amount)) || typeof payment.currency_id !== "string"
    || !["approved", "pending", "in_process", "authorized", "in_mediation", "rejected", "cancelled"].includes(String(payment.status))) return incident(db, transaction);
  return complete(db, transaction, {
    reference: String(payment.external_reference), flow: "preference", external: merchant.preference_id,
    payment: paymentId, amount: Number(payment.transaction_amount), currency: payment.currency_id,
    status: payment.status === "approved" ? "processed" : payment.status === "rejected" || payment.status === "cancelled" ? "rejected" : "pending",
  });
}
