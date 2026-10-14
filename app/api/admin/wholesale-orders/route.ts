/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getAdminIdentity } from "@/lib/admin-auth";
import { apiError } from "@/lib/api";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";

const STATUSES = ["received", "in_review", "awaiting_customer", "confirmed", "rejected", "cancelled"] as const;
const PAGE_SIZE = 25;
const CUSTOMER_BATCH_SIZE = 500;

function isValidDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function guard() {
  const identity = await getAdminIdentity();
  if (identity?.role !== "ADMIN") return apiError("UNAUTHORIZED", "No autorizado.", 401);
  if (!isServiceRoleConfigured()) return apiError("CONFIGURATION_ERROR", "Administración no configurada.", 503);
  return null;
}

export async function GET(request: Request) {
  const blocked = await guard();
  if (blocked) return blocked;
  const params = new URL(request.url).searchParams;
  const page = Number(params.get("page") ?? "1");
  const status = params.get("status") ?? "all";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const customer = (params.get("customer") ?? "").trim().slice(0, 120);
  if (!Number.isInteger(page) || page < 1 || page > 100000 || (!["all", "attention"].includes(status) && !STATUSES.includes(status as typeof STATUSES[number])) ||
      (from && !isValidDateOnly(from)) || (to && !isValidDateOnly(to)) ||
      (from && to && from > to)) return apiError("BAD_REQUEST", "Filtros inválidos.", 400);

  try {
    const db = createAdminServerClient() as any;
    let customerIds: string[] | null = null;
    if (customer && !/^MW-[0-9]+$/i.test(customer)) {
      const matchedCustomerIds: string[] = [];
      for (let offset = 0; ; offset += CUSTOMER_BATCH_SIZE) {
        const found = await db.from("customers").select("id").ilike("full_name", `%${customer.replace(/[\\%_]/g, "\\$&")}%`).order("id").range(offset, offset + CUSTOMER_BATCH_SIZE - 1) as { data: { id: string }[] | null; error: { message: string } | null };
        if (found.error) throw new Error(found.error.message);
        const batch = found.data ?? [];
        matchedCustomerIds.push(...batch.map((row: { id: string }) => row.id));
        if (batch.length < CUSTOMER_BATCH_SIZE) break;
      }
      customerIds = matchedCustomerIds;
      if (!matchedCustomerIds.length) return NextResponse.json({ ok: true, data: [], pagination: { page, pageSize: PAGE_SIZE, total: 0, totalPages: 0 } }, { headers: { "Cache-Control": "no-store" } });
    }
    let query = db.from("wholesale_orders").select("id,order_number,customer_id,status,current_revision_id,created_at,confirmed_at", { count: "exact" });
    if (status === "attention") query = query.in("status", ["received", "in_review"]);
    else if (status !== "all") query = query.eq("status", status);
    if (from) query = query.gte("created_at", `${from}T00:00:00-03:00`);
    if (to) query = query.lt("created_at", `${to}T00:00:00-03:00`);
    if (/^MW-[0-9]+$/i.test(customer)) query = query.eq("order_number", customer.toUpperCase());
    if (customerIds) query = query.in("customer_id", customerIds);
    const start = (page - 1) * PAGE_SIZE;
    const orders = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(start, start + PAGE_SIZE - 1) as { data: { id: string; order_number: string; customer_id: string; current_revision_id: string; status: string; created_at: string; confirmed_at: string | null }[] | null; count: number | null; error: { message: string } | null };
    if (orders.error) throw new Error(orders.error.message);
    const rows = orders.data ?? [];
    const customerIdSet = [...new Set(rows.map(row => row.customer_id))];
    const revisionIds = [...new Set(rows.map(row => row.current_revision_id))];
    const [customers, revisions] = await Promise.all([
      customerIdSet.length ? db.from("customers").select("id,full_name").in("id", customerIdSet) : Promise.resolve({ data: [], error: null }),
      revisionIds.length ? db.from("wholesale_order_revisions").select("id,total_amount,currency,status").in("id", revisionIds) : Promise.resolve({ data: [], error: null }),
    ]) as [{ data: { id: string; full_name: string }[] | null; error: { message: string } | null }, { data: { id: string; total_amount: string | number; status?: string; currency: string }[] | null; error: { message: string } | null }];
    if (customers.error || revisions.error) throw new Error(customers.error?.message ?? revisions.error?.message ?? "No se pudieron completar los pedidos.");
    const customerNames = new Map((customers.data ?? []).map(row => [row.id, row.full_name]));
    const totals = new Map((revisions.data ?? []).map(row => [row.id, { total: Number(row.total_amount), currency: row.currency, revisionStatus: row.status }]));
    const data = rows.map(row => ({
      id: row.id, orderNumber: row.order_number, customerId: row.customer_id,
      customerName: customerNames.get(row.customer_id) ?? "Cliente", status: row.status,
      createdAt: row.created_at, confirmedAt: row.confirmed_at,
      ...(totals.get(row.current_revision_id) ?? { total: null, currency: null }),
    }));
    const total = orders.count ?? 0;
    return NextResponse.json({ ok: true, data, pagination: { page, pageSize: PAGE_SIZE, total, totalPages: Math.ceil(total / PAGE_SIZE) } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudieron cargar las solicitudes mayoristas.", 500);
  }
}

export async function POST() {
  return NextResponse.json({ ok: false, error: "METHOD_NOT_ALLOWED", message: "Método no permitido." }, { status: 405 });
}
