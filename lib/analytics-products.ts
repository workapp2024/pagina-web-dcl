import "server-only";
import { getAnalyticsDetail } from "@/lib/posthog-admin";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import type { RankingResult } from "@/lib/analytics-v2";

export async function getStoreProductRanking(kind: "products" | "cart", from: number, to: number): Promise<RankingResult> {
  const result = await getAnalyticsDetail(kind, from, to);
  if (result.status !== "ok") return { status: "unavailable" };
  const rows = result.data.rows.slice(0, 5);
  const names = new Map<string, string>();
  if (rows.length && isServiceRoleConfigured()) {
    try {
      const { data, error } = await createAdminServerClient().from("products").select("id,name").in("id", rows.map(row => row.productId!));
      if (!error) for (const product of (data || []) as { id: string; name: string }[]) names.set(product.id, product.name);
    } catch { /* Captured IDs remain valid even if catalog labels are unavailable. */ }
  }
  return { status: "ok", rows: rows.map(row => ({ key: row.productId!, label: names.get(row.productId!) || `Producto ${row.productId}`, count: Number(row.values[0]) })) };
}
