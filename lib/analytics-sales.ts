import "server-only";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import type { RankingRow } from "@/lib/analytics-v2";

type Sale = { id: string; status: string; total: number | string; created_at: string };
type Payment = { sale_id: string | null; order_id: string };
type Item = { id: string; sale_id: string; product_id: string | null; product_name: string; quantity: number; created_at: string };
export type StoreSalesResult = { status: "ok"; purchases: number; amount: number; products: RankingRow[] }
  | { status: "unavailable" };

// The same deduplicated set drives purchases, revenue and units. Archiving is
// intentionally irrelevant; public origin requires the existing FK linkage.
export function aggregateStoreSales(sales: Sale[], payments: Payment[], orders: { id: string }[], items: Item[], from: number, to: number): StoreSalesResult {
  const orderIds = new Set(orders.map(order => order.id));
  const linkedIds = new Set(payments.filter(payment => payment.sale_id && orderIds.has(payment.order_id)).map(payment => payment.sale_id));
  const valid = new Map(sales.filter(sale => sale.status === "completed" && linkedIds.has(sale.id)
    && Date.parse(sale.created_at) >= from * 1000 && Date.parse(sale.created_at) < to * 1000).map(sale => [sale.id, sale]));
  let cents = 0;
  for (const sale of valid.values()) {
    if ((typeof sale.total !== "number" && typeof sale.total !== "string") || String(sale.total).trim() === "") throw new Error("Invalid sale total");
    const total = Number(sale.total);
    const value = Math.round(total * 100);
    if (!Number.isFinite(total) || total < 0 || !Number.isSafeInteger(value) || Math.abs(total * 100 - value) > .0001) throw new Error("Invalid sale total");
    cents += value;
    if (!Number.isSafeInteger(cents)) throw new Error("Invalid sales sum");
  }
  const products = new Map<string, RankingRow>();
  const seenItems = new Set<string>();
  // Pick the latest available historical name, never the current catalog name.
  for (const item of [...items].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))) {
    if (!valid.has(item.sale_id) || seenItems.has(item.id)) continue;
    seenItems.add(item.id);
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) throw new Error("Invalid sale quantity");
    const key = item.product_id || `item:${item.id}`;
    const row = products.get(key) || { key, label: item.product_name || "Producto sin nombre histórico", count: 0 };
    row.count += item.quantity;
    if (!Number.isSafeInteger(row.count)) throw new Error("Invalid units sum");
    products.set(key, row);
  }
  return { status: "ok", purchases: valid.size, amount: cents / 100,
    products: [...products.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, 5) };
}

type ReadPage = { data: unknown; error: unknown; count: number | null };
async function allRows<T>(read: (offset: number) => PromiseLike<ReadPage>): Promise<T[]> {
  const rows: T[] = [];
  let expected: number | undefined;
  for (;;) {
    const result = await read(rows.length);
    if (result.error || !Array.isArray(result.data) || result.count === null || !Number.isSafeInteger(result.count) || result.count < 0 || result.count > 100_000
      || (expected !== undefined && expected !== result.count)) throw new Error("Incomplete analytics read");
    expected = result.count;
    rows.push(...result.data as T[]);
    if (rows.length === result.count) return rows;
    if (!result.data.length || rows.length > result.count) throw new Error("Incomplete analytics read");
  }
}
const batches = (ids: string[]) => Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) => ids.slice(index * 100, index * 100 + 100));

export async function getStoreSales(from: number, to: number): Promise<StoreSalesResult> {
  if (!isServiceRoleConfigured()) return { status: "unavailable" };
  try {
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new Error("Invalid dates");
    const db = createAdminServerClient();
    const sales = await allRows<Sale>(offset => db.from("sales").select("id,status,total,created_at", { count: "exact" })
      .eq("status", "completed").gte("created_at", new Date(from * 1000).toISOString()).lt("created_at", new Date(to * 1000).toISOString())
      .order("id").range(offset, offset + 499));
    const payments: Payment[] = [];
    for (const ids of batches([...new Set(sales.map(sale => sale.id))])) {
      payments.push(...await allRows<Payment>(offset => db.from("payment_transactions" as never).select("sale_id,order_id", { count: "exact" })
        .in("sale_id", ids).order("id").range(offset, offset + 499)));
    }
    const orders: { id: string }[] = [];
    for (const ids of batches([...new Set(payments.map(payment => payment.order_id))])) {
      orders.push(...await allRows<{ id: string }>(offset => db.from("orders" as never).select("id", { count: "exact" })
        .in("id", ids).order("id").range(offset, offset + 499)));
    }
    const orderIds = new Set(orders.map(order => order.id));
    const validIds = [...new Set(payments.filter(payment => orderIds.has(payment.order_id) && payment.sale_id).map(payment => payment.sale_id!))];
    const items: Item[] = [];
    for (const ids of batches(validIds)) {
      items.push(...await allRows<Item>(offset => db.from("sale_items").select("id,sale_id,product_id,product_name,quantity,created_at", { count: "exact" })
        .in("sale_id", ids).order("id").range(offset, offset + 499)));
    }
    return aggregateStoreSales(sales, payments, orders, items, from, to);
  } catch {
    // Never expose service-role errors, personal data, or misleading partial totals.
    return { status: "unavailable" };
  }
}
