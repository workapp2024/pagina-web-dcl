/* eslint-disable @typescript-eslint/no-explicit-any */
import {NextResponse} from "next/server";import {isAdminAuthenticated} from "@/lib/admin-auth";import {createAdminServerClient,isServiceRoleConfigured} from "@/lib/supabase/server";
export async function GET() {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ ok: false }, { status: 401 });
  if (!isServiceRoleConfigured()) return NextResponse.json({ ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY." }, { status: 500 });
  try {
    const db: any = createAdminServerClient();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const { data: activePeriod } = await db.from("financial_periods").select("starts_at").eq("status", "open").maybeSingle();
    const operationalStart = activePeriod?.starts_at || today.toISOString();
    const [sales, orders, products, installations, claims, customers, warranties] = await Promise.all([
      db.from("sales").select("id,total,created_at").eq("status", "completed").gte("created_at", operationalStart),
      db.from("orders").select("id,status").in("status", ["pending_payment", "paid", "stock_unavailable"]),
      db.from("products").select("id,name,stock,stock_min").eq("active", true),
      db.from("installations").select("id").eq("status", "pending"),
      db.from("warranty_claims").select("id").eq("status", "open"),
      db.from("customers").select("id", { count: "exact", head: true }).gte("created_at", operationalStart),
      db.from("warranties").select("id,expires_at").eq("status", "active").not("expires_at", "is", null).lte("expires_at", new Date(Date.now() + 7 * 86400000).toISOString()),
    ]);
    const rows = sales.data || []; const ids = rows.map((row: any) => row.id);
    const items = ids.length ? await db.from("sale_items").select("product_name,quantity,unit_cost").in("sale_id", ids) : { data: [] };
    const byProduct = new Map<string, number>(); let costs = 0;
    for (const item of items.data || []) { byProduct.set(item.product_name, (byProduct.get(item.product_name) || 0) + Number(item.quantity)); costs += Number(item.unit_cost || 0) * Number(item.quantity); }
    const revenue = rows.reduce((sum: number, row: any) => sum + Number(row.total), 0);
    return NextResponse.json({ ok: true, data: { periodSales: rows.length, periodRevenue: revenue, realizedProfit: revenue - costs, periodStart: operationalStart, pendingOrders: (orders.data || []).length, lowStock: (products.data || []).filter((row: any) => row.stock <= row.stock_min), pendingInstallations: (installations.data || []).length, openClaims: (claims.data || []).length, expiringWarranties: (warranties.data || []).length, newCustomers: customers.count || 0, topProducts: [...byProduct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5), recentSales: rows.slice(0, 6) } });
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "No se pudo cargar el resumen." }, { status: 500 }); }
}
