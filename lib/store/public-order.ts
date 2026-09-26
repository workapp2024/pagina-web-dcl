import "server-only";
import { createAdminServerClient } from "@/lib/supabase/server";
import { authorizedBuyerOrder } from "@/lib/store/buyer-session";

export type PublicOrder = {
  orderNumber: string;
  result: "approved" | "pending" | "rejected" | "review" | "cancelled" | "refunded";
  paymentReceived: boolean; paymentStatus: string; total: number; currency: string;
  paymentMethod: "transfer" | "card" | "mercadopago";
  transferDeclared: boolean; canPay: boolean;
  items: { name: string; quantity: number; unitPrice: number; lineTotal: number }[];
  transfer?: { alias: string; cbuCvu: string; holder: string; institution: string; instructions: string };
};
export function publicOrderResult(status: string, payment: string): PublicOrder["result"] {
  if (status === "refunded" && payment === "refunded") return "refunded";
  if (["stock_unavailable", "refund_required"].includes(status) || (payment === "approved" && !["paid", "completed"].includes(status))) return "review";
  if (status === "cancelled" && payment === "cancelled") return "cancelled";
  if (["paid", "completed"].includes(status) && payment === "approved") return "approved";
  if (status === "rejected" || ["rejected", "error"].includes(payment)) return "rejected";
  if (["pending_payment", "pending_manual_verification"].includes(status) && payment === "pending") return "pending";
  return "review";
}
type StoredOrder = { order_number: string; status: string; payment_method: PublicOrder["paymentMethod"]; total: number | string; currency: string; transfer_declared_at: string | null };
type StoredItem = { product_name: string; quantity: number; unit_price: string | number; line_total: string | number };
type StoredPayment = { status: string; currency: string; amount: number | string; provider: string };
type ReadResult<T> = { data: T | null; error: unknown };
function cents(value: string | number) {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(String(value))) throw new Error("Invalid order amount");
  return Math.round(Number(value) * 100);
}
export async function getPublicOrder(number: string): Promise<PublicOrder | null> {
  const id = await authorizedBuyerOrder(number);
  if (!id) return null;
  const db = createAdminServerClient();
  const [orderRead, paymentRead, itemRead] = await Promise.all([
    db.from("orders").select("order_number,status,payment_method,total,currency,transfer_declared_at").eq("id", id).single(),
    db.from("payment_transactions").select("status,currency,amount,provider").eq("order_id", id).single(),
    db.from("order_items").select("product_name,quantity,unit_price,line_total").eq("order_id", id).order("id").limit(51),
  ]) as unknown as [ReadResult<StoredOrder>, ReadResult<StoredPayment>, ReadResult<StoredItem[]>];
  if (orderRead.error || paymentRead.error || itemRead.error || !orderRead.data || !paymentRead.data || !itemRead.data) throw new Error("Order read failed");
  const order = orderRead.data as unknown as StoredOrder;
  const payment = paymentRead.data as unknown as { status: string; currency: string; amount: number | string; provider: string };
  const storedItems = itemRead.data as unknown as StoredItem[];
  if (!["transfer", "card", "mercadopago"].includes(order.payment_method) || !/^[A-Z]{3}$/.test(order.currency)
    || payment.currency !== order.currency || cents(payment.amount) !== cents(order.total)
    || payment.provider !== (order.payment_method === "transfer" ? "transfer" : "mercadopago")
    || storedItems.length < 1 || storedItems.length > 50) throw new Error("Inconsistent order");
  const items = storedItems.map(item => {
    if (!item.product_name?.trim() || !Number.isSafeInteger(item.quantity) || item.quantity < 1
      || cents(item.unit_price) * item.quantity !== cents(item.line_total)) throw new Error("Inconsistent order item");
    return { name: item.product_name, quantity: item.quantity, unitPrice: cents(item.unit_price) / 100, lineTotal: cents(item.line_total) / 100 };
  });
  if (storedItems.reduce((sum, item) => sum + cents(item.line_total), 0) !== cents(order.total)) throw new Error("Inconsistent order total");
  const result = publicOrderResult(order.status, payment.status);
  let canPay = false;
  if (result === "pending" && order.payment_method !== "transfer") {
    const window = await db.rpc("get_order_payment_window" as never, { p_order: id } as never) as unknown as ReadResult<string>;
    canPay = !window.error && typeof window.data === "string" && Date.parse(window.data) > Date.now();
  }
  let transfer: PublicOrder["transfer"];
  if (order.payment_method === "transfer" && result === "pending") {
    const { data, error } = await db.from("site_settings").select("transfer_alias,transfer_cbu_cvu,transfer_holder,transfer_institution,transfer_instructions").eq("id", 1).single() as unknown as ReadResult<{ transfer_alias: string; transfer_cbu_cvu: string; transfer_holder: string; transfer_institution: string; transfer_instructions: string }>;
    if (error || !data) throw new Error("Transfer settings unavailable");
    transfer = { alias: data.transfer_alias, cbuCvu: data.transfer_cbu_cvu, holder: data.transfer_holder,
      institution: data.transfer_institution, instructions: data.transfer_instructions };
  }
  return { orderNumber: order.order_number, result, paymentReceived: payment.status === "approved", paymentStatus: payment.status,
    total: cents(order.total) / 100, currency: order.currency, paymentMethod: order.payment_method,
    transferDeclared: Boolean(order.transfer_declared_at), canPay, items, ...(transfer ? { transfer } : {}) };
}
