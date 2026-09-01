import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { apiError, apiInternalError, boundedString, isUuid, readJsonObject } from "@/lib/api";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";

async function guard() {
  if (!(await isAdminAuthenticated())) return apiError("UNAUTHORIZED", "No autorizado.", 401);
  if (!isServiceRoleConfigured()) return apiError("CONFIGURATION_ERROR", "La administración no está configurada.", 503);
  return null;
}

function start(period: string, custom?: string | null) {
  const date = new Date();
  if (period === "all") return null;
  if (period === "custom" && custom && !Number.isNaN(Date.parse(custom))) return custom;
  if (period === "today") date.setHours(0, 0, 0, 0);
  else if (period === "week") date.setDate(date.getDate() - 7);
  else date.setMonth(date.getMonth() - 1);
  return date.toISOString();
}

export async function GET(request: Request) {
  const blocked = await guard(); if (blocked) return blocked;
  try {
    const params = new URL(request.url).searchParams;
    const db: any = createAdminServerClient();
    const from = start(params.get("period") || "month", params.get("from"));
    let sales: any = db.from("sales").select("id,total,status,payment_method,created_at").order("created_at", { ascending: false }).limit(500);
    if (from) sales = sales.gte("created_at", from);
    const { data: saleRows, error } = await sales; if (error) throw new Error(error.message);
    const ids = (saleRows || []).map((sale: any) => sale.id);
    const [items, cash]: any[] = await Promise.all([
      ids.length ? db.from("sale_items").select("sale_id,quantity,unit_cost").in("sale_id", ids) : Promise.resolve({ data: [] }),
      db.from("cash_movements").select("id,movement_type,amount,description,occurred_at,sale_id").order("occurred_at", { ascending: false }).limit(500),
    ]);
    if (cash.error) return apiError("CONFIGURATION_ERROR", "Finanzas no está disponible en este entorno.", 503);
    const costBy = new Map<string, number>();
    for (const item of items.data || []) costBy.set(item.sale_id, (costBy.get(item.sale_id) || 0) + Number(item.unit_cost || 0) * Number(item.quantity));
    const completed = (saleRows || []).filter((sale: any) => sale.status === "completed");
    const revenue = completed.reduce((sum: number, sale: any) => sum + Number(sale.total), 0);
    const costs = completed.reduce((sum: number, sale: any) => sum + (costBy.get(sale.id) || 0), 0);
    const movements = cash.data || [];
    const cashBalance = movements.reduce((sum: number, movement: any) => sum + Number(movement.amount), 0);
    const byMethod = Object.entries(completed.reduce((all: Record<string, number>, sale: any) => ({ ...all, [sale.payment_method]: (all[sale.payment_method] || 0) + Number(sale.total) }), {}));
    return NextResponse.json({ ok: true, data: { revenue, costs, margin: revenue - costs, estimatedProfit: revenue - costs, cashBalance, byMethod, movements, sales: saleRows || [] } });
  } catch (error) { return apiInternalError("admin_finances_list", error); }
}

export async function POST(request: Request) {
  const blocked = await guard(); if (blocked) return blocked;
  const body = await readJsonObject(request);
  if (!body) return apiError("BAD_REQUEST", "La solicitud no tiene un formato válido.", 400);
  try {
    const db: any = createAdminServerClient(); let result: any;
    if (body.action === "cash") {
      const type = boundedString(body.type, 32, { required: true });
      const amount = Number(body.amount);
      const description = boundedString(body.description, 500, { required: true });
      if (!type || !["income", "expense", "cash_withdrawal", "cash_contribution", "adjustment", "refund"].includes(type) || !Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100_000_000 || !description) return apiError("BAD_REQUEST", "Revisá el movimiento de caja.", 400);
      result = await db.rpc("record_cash_movement", { p_type: type, p_amount: amount, p_description: description });
    } else if (body.action === "cancel_sale") {
      const reason = boundedString(body.reason, 500, { required: true });
      if (!isUuid(body.saleId) || !reason) return apiError("BAD_REQUEST", "Indicá una venta y el motivo de la anulación.", 400);
      result = await db.rpc("cancel_sale_with_reversal", { p_sale_id: body.saleId, p_reason: reason });
    } else if (body.action === "archive_sale") {
      if (!isUuid(body.saleId) || typeof body.archive !== "boolean") return apiError("BAD_REQUEST", "Datos de archivo inválidos.", 400);
      result = await db.rpc("archive_sale", { p_sale_id: body.saleId, p_archive: body.archive });
    } else return apiError("BAD_REQUEST", "Acción inválida.", 400);
    if (result?.error) {
      console.warn("Finance RPC rejected", { stage: "admin_finances_action", action: body.action, code: result.error.code });
      return apiError("BAD_REQUEST", "No se pudo registrar la operación solicitada.", 400);
    }
    return NextResponse.json({ ok: true });
  } catch (error) { return apiInternalError("admin_finances_action", error); }
}
