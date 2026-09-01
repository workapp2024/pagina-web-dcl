import { NextResponse } from "next/server";
import { apiInternalError, boundedString } from "@/lib/api";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";

async function guard() {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });
  if (!isServiceRoleConfigured()) return NextResponse.json({ ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY." }, { status: 500 });
  return null;
}

function periodStart(period: string) {
  if (period === "all") return null;
  const date = new Date();
  if (period === "today") date.setHours(0, 0, 0, 0);
  else if (period === "week") date.setDate(date.getDate() - 7);
  else date.setMonth(date.getMonth() - 1);
  return date.toISOString();
}

export async function GET(request: Request) {
  const blocked = await guard(); if (blocked) return blocked;
  try {
    const params = new URL(request.url).searchParams;
    const db = createAdminServerClient();
    const page = Math.max(1, Number(params.get("page") || 1) | 0);
    const limit = Math.min(100, Math.max(10, Number(params.get("limit") || 50) | 0));
    let query: any = db.from("orders").select("id,customer_id,status,fulfillment_method,shipping_address,notes,payment_method,currency,total,created_at", { count: "exact" }).order("created_at", { ascending: false }).range((page - 1) * limit, page * limit - 1);
    const start = periodStart(params.get("period") || "month"); if (start) query = query.gte("created_at", start);
    if (params.get("status") && params.get("status") !== "all") query = query.eq("status", params.get("status"));
    const { data: orders, error, count } = await query; if (error) throw new Error(error.message);
    const ids = (orders || []).map((row: any) => row.id), customerIds = [...new Set((orders || []).map((row: any) => row.customer_id))];
    const [customersResult, itemsResult, paymentsResult]: any[] = await Promise.all([
      customerIds.length ? db.from("customers").select("id,full_name,phone,email").in("id", customerIds) : Promise.resolve({ data: [] }),
      ids.length ? db.from("order_items").select("order_id,product_name,quantity,line_total").in("order_id", ids) : Promise.resolve({ data: [] }),
      ids.length ? db.from("payment_transactions").select("order_id,sale_id,status,provider,external_order_id").in("order_id", ids) : Promise.resolve({ data: [] }),
    ]);
    if (customersResult.error || itemsResult.error || paymentsResult.error) throw new Error(customersResult.error?.message || itemsResult.error?.message || paymentsResult.error?.message);
    const customerById = new Map((customersResult.data || []).map((row: any) => [row.id, row]));
    const itemsByOrder = new Map<string, any[]>(); for (const item of itemsResult.data || []) itemsByOrder.set((item as any).order_id, [...(itemsByOrder.get((item as any).order_id) || []), item]);
    const paymentByOrder = new Map((paymentsResult.data || []).map((row: any) => [(row as any).order_id, row]));
    const needle = (boundedString(params.get("q"), 80) || "").toLowerCase();
    const rows = (orders || []).map((order: any) => ({ ...order, customer: customerById.get(order.customer_id), items: itemsByOrder.get(order.id) || [], payment: paymentByOrder.get(order.id) || null })).filter((row: any) => !needle || [row.id, row.customer?.full_name, row.customer?.phone, ...row.items.map((item: any) => item.product_name)].some(value => String(value || "").toLowerCase().includes(needle)));
    return NextResponse.json({ ok: true, data: rows, pagination: { page, limit, total: count || 0 } });
  } catch (error) { return apiInternalError("admin_orders_list", error); }
}
