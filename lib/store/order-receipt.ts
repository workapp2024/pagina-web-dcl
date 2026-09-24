import "server-only";
import { createAdminServerClient } from "@/lib/supabase/server";

export type OrderReceipt = {
  orderNumber: string;
  soldAt: string;
  customerName: string;
  maskedPhone?: string;
  currency: string;
  total: number;
  paymentMethod: string;
  paymentStatus: "Aprobado" | "Reembolsado" | "Cancelado";
  status: "valid" | "refunded" | "cancelled";
  resolvedAt?: string;
  items: { name: string; quantity: number; unitPrice: number; lineTotal: number }[];
};
export type ReceiptResult =
  | { status: "ok"; receipt: OrderReceipt }
  | { status: "not_found" | "unavailable" | "incident"; message: string };

type Money = number | string;
type Order = {
  id: string; order_number: string; customer_id: string; status: string; operational_status: string;
  payment_method: string; currency: string; subtotal: Money; total: Money;
  customer_name_snapshot: string | null; customer_phone_snapshot: string | null;
};
type Payment = { id: string; order_id: string; sale_id: string | null; status: string; provider: string; amount: Money; currency: string };
type Sale = { id: string; customer_id: string; status: string; payment_method: string; subtotal: Money; total: Money; created_at: string; cancelled_at: string | null };
type Item = { id: string; sale_id: string; product_name: string; quantity: number; unit_price: Money; line_total: Money };
type Resolution = { order_id: string; payment_transaction_id: string | null; sale_id: string | null; resolution_type: string; created_at: string };
type ReceiptRecords = { order: Order; payments: Payment[]; sale: Sale | undefined; items: Item[]; resolutions: Resolution[]; salePayments: Payment[] };

const incident = (): ReceiptResult => ({ status: "incident", message: "No se puede generar el comprobante: los datos requieren revisión administrativa." });
const unavailable = (): ReceiptResult => ({ status: "unavailable", message: "Este pedido no tiene una venta registrada para emitir un comprobante de compra." });
const notFound = (): ReceiptResult => ({ status: "not_found", message: "Pedido no encontrado." });
export function isReceiptOrderNumber(value: unknown): value is string {
  return typeof value === "string" && /^DCL-[0-9]{6,19}$/.test(value);
}

// NUMERIC(12,2): compare integer cents, never floating-point sums or live prices.
function cents(value: Money): number {
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d{1,10}(?:\.\d{1,2})?$/.test(String(value))) throw new Error("Invalid amount");
  const [whole, fraction = ""] = String(value).split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) throw new Error("Invalid amount");
  return result;
}
const dateIsValid = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
function maskPhone(phone: string | null): string | undefined {
  const digits = typeof phone === "string" ? phone.replace(/\D/g, "") : "";
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : undefined;
}

// Internal identifiers are used only for consistency checks, never copied into the DTO.
export function validateOrderReceipt({ order, payments, sale, items, resolutions, salePayments }: ReceiptRecords): ReceiptResult {
  try {
    if (!isReceiptOrderNumber(order.order_number) || payments.length !== 1) return incident();
    const payment = payments[0];
    if (payment.order_id !== order.id) return incident();
    if (!payment.sale_id) {
      return order.status === "completed" || resolutions.some(r => r.sale_id) ? incident() : unavailable();
    }
    if (!sale || sale.id !== payment.sale_id || sale.customer_id !== order.customer_id || salePayments.length !== 1
      || salePayments[0].id !== payment.id || salePayments[0].order_id !== order.id
      || salePayments[0].sale_id !== sale.id || salePayments[0].status !== payment.status
      || salePayments[0].provider !== payment.provider || salePayments[0].currency !== payment.currency
      || cents(salePayments[0].amount) !== cents(payment.amount) || !items.length) return incident();
    if (typeof order.customer_name_snapshot !== "string" || !order.customer_name_snapshot.trim()
      || order.customer_name_snapshot.length > 160) return incident(); // Never backfill from customers.
    if (!dateIsValid(sale.created_at) || !/^[A-Z]{3}$/.test(order.currency) || payment.currency !== order.currency) return incident();
    const expectedProvider = order.payment_method === "transfer" ? "transfer" : "mercadopago";
    if (!["transfer", "card", "mercadopago"].includes(order.payment_method) || payment.provider !== expectedProvider
      || sale.payment_method !== expectedProvider) return incident();
    const total = cents(sale.total);
    if ([order.total, order.subtotal, sale.subtotal, payment.amount].some(amount => cents(amount) !== total)) return incident();
    const ids = new Set<string>();
    let sum = 0;
    const receiptItems = items.map(item => {
      if (item.sale_id !== sale.id || !item.id || ids.has(item.id) || typeof item.product_name !== "string"
        || !item.product_name.trim() || item.product_name.length > 255 || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new Error("Invalid line");
      ids.add(item.id);
      const unitPrice = cents(item.unit_price), lineTotal = cents(item.line_total);
      if (!Number.isSafeInteger(unitPrice * item.quantity) || unitPrice * item.quantity !== lineTotal) throw new Error("Invalid line total");
      sum += lineTotal;
      return { name: item.product_name, quantity: item.quantity, unitPrice: unitPrice / 100, lineTotal: lineTotal / 100 };
    });
    if (sum !== total || !Number.isSafeInteger(sum)) return incident();
    // Only these resolutions are possible for an order with a historical sale.
    if (resolutions.some(r => r.order_id !== order.id || r.payment_transaction_id !== payment.id || r.sale_id !== sale.id
      || !["COMPLETE_STOCK_UNAVAILABLE", "REFUND_VERIFIED", "TRANSFER_APPROVAL_ERROR"].includes(r.resolution_type)
      || (r.resolution_type === "COMPLETE_STOCK_UNAVAILABLE" && payment.provider !== "mercadopago")
      || !dateIsValid(r.created_at) || Date.parse(r.created_at) < Date.parse(sale.created_at))) return incident();
    if (new Set(resolutions.map(r => r.resolution_type)).size !== resolutions.length) return incident();
    const reversals = resolutions.filter(r => r.resolution_type !== "COMPLETE_STOCK_UNAVAILABLE");
    let status: OrderReceipt["status"], paymentStatus: OrderReceipt["paymentStatus"], resolvedAt: string | undefined;
    if (order.status === "completed" && payment.status === "approved" && sale.status === "completed"
      && ["received", "preparing", "ready", "delivered"].includes(order.operational_status) && !sale.cancelled_at && !reversals.length) {
      status = "valid"; paymentStatus = "Aprobado";
    } else if (sale.status === "cancelled" && order.operational_status === "cancelled" && reversals.length === 1
      && dateIsValid(sale.cancelled_at) && Date.parse(sale.cancelled_at) >= Date.parse(sale.created_at)) {
      const resolution = reversals[0];
      if (order.status === "refunded" && payment.status === "refunded" && resolution.resolution_type === "REFUND_VERIFIED") {
        status = "refunded"; paymentStatus = "Reembolsado";
      } else if (order.status === "cancelled" && payment.status === "cancelled" && resolution.resolution_type === "TRANSFER_APPROVAL_ERROR"
        && order.payment_method === "transfer") {
        status = "cancelled"; paymentStatus = "Cancelado";
      } else return incident();
      resolvedAt = resolution.created_at;
    } else return incident();
    return { status: "ok", receipt: {
      orderNumber: order.order_number, soldAt: sale.created_at, customerName: order.customer_name_snapshot.trim(),
      ...(maskPhone(order.customer_phone_snapshot) ? { maskedPhone: maskPhone(order.customer_phone_snapshot) } : {}),
      currency: order.currency, total: total / 100, items: receiptItems, status, paymentStatus,
      paymentMethod: order.payment_method === "card" ? "Tarjeta (Mercado Pago)" : order.payment_method === "transfer" ? "Transferencia" : "Mercado Pago",
      ...(resolvedAt ? { resolvedAt } : {}),
    } };
  } catch { return incident(); }
}

// Callers authenticate first. Bounded, paginated reads also support the Orders list
// without one query per order. No customers, catalog, finance, RPC or writes.
async function loadReceipts(orderNumbers: string[]): Promise<Map<string, ReceiptResult>> {
  const numbers = [...new Set(orderNumbers.filter(isReceiptOrderNumber))];
  const result = new Map<string, ReceiptResult>(numbers.map(number => [number, notFound()]));
  if (!numbers.length) return result;
  if (numbers.length > 100) return new Map(numbers.map(number => [number, incident()]));
  try {
    const db = createAdminServerClient();
    async function read<T>(table: string, columns: string, field: string, values: string[]): Promise<T[]> {
      if (!values.length) return [];
      const rows: T[] = [];
      for (let offset = 0; offset < 10000; offset += 500) {
        const { data, error } = await db.from(table as never).select(columns).in(field, values).order("id").range(offset, offset + 499);
        if (error || !Array.isArray(data)) throw new Error("Receipt read failed");
        rows.push(...data as unknown as T[]);
        if (data.length < 500) return rows;
      }
      throw new Error("Receipt read limit exceeded");
    }
    const orders = await read<Order>("orders", "id,order_number,customer_id,status,operational_status,payment_method,currency,subtotal,total,customer_name_snapshot,customer_phone_snapshot", "order_number", numbers);
    const ids = orders.map(o => o.id);
    const payments = await read<Payment>("payment_transactions", "id,order_id,sale_id,status,provider,amount,currency", "order_id", ids);
    const saleIds = [...new Set(payments.flatMap(p => p.sale_id ? [p.sale_id] : []))];
    const [sales, items, resolutions, salePayments] = await Promise.all([
      read<Sale>("sales", "id,customer_id,status,payment_method,subtotal,total,created_at,cancelled_at", "id", saleIds),
      read<Item>("sale_items", "id,sale_id,product_name,quantity,unit_price,line_total", "sale_id", saleIds),
      read<Resolution>("order_resolutions", "order_id,payment_transaction_id,sale_id,resolution_type,created_at", "order_id", ids),
      read<Payment>("payment_transactions", "id,order_id,sale_id,status,provider,amount,currency", "sale_id", saleIds),
    ]);
    for (const order of orders) {
      const orderPayments = payments.filter(p => p.order_id === order.id);
      const saleId = orderPayments[0]?.sale_id;
      result.set(order.order_number, validateOrderReceipt({ order, payments: orderPayments, sale: sales.find(s => s.id === saleId),
        items: items.filter(i => i.sale_id === saleId), resolutions: resolutions.filter(r => r.order_id === order.id),
        salePayments: salePayments.filter(p => p.sale_id === saleId) }));
    }
  } catch {
    // Missing migration/query failures do not break the existing Orders screen.
    for (const number of numbers) result.set(number, incident());
  }
  return result;
}

export async function getOrderReceipt(orderNumber: string): Promise<ReceiptResult> {
  if (!isReceiptOrderNumber(orderNumber)) return notFound();
  return (await loadReceipts([orderNumber])).get(orderNumber) ?? notFound();
}

export async function getOrderReceiptAvailability(orderNumbers: string[]): Promise<Record<string, boolean>> {
  return Object.fromEntries([...(await loadReceipts(orderNumbers))].map(([number, result]) => [number, result.status === "ok"]));
}
