import { NextResponse } from "next/server";
import { apiError, apiInternalError, boundedString, isUuid, readJsonObject } from "@/lib/api";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";

type CustomerRow = { id: string; full_name: string; phone: string | null; email: string | null; document_number: string | null; notes: string; created_at: string; updated_at: string; archived_at: string | null };
type SaleRow = { id: string; customer_id: string; total: number; status: string; created_at: string };
type VehicleRow = { id: string; customer_id: string; brand_name: string; model_name: string; year: number | null; plate: string | null };
type WarrantyRow = { id: string; customer_id: string; status: string; warranty_claims?: { status: string }[] };

async function guard() {
  if (!(await isAdminAuthenticated())) return apiError("UNAUTHORIZED", "No autorizado.", 401);
  if (!isServiceRoleConfigured()) return apiError("CONFIGURATION_ERROR", "Falta configurar el acceso al servidor.", 503);
  return null;
}

export async function GET(request: Request) {
  const blocked = await guard(); if (blocked) return blocked;
  try {
    const params = new URL(request.url).searchParams;
    const view = params.get("view") || "active";
    if (view !== "active" && view !== "archived") return apiError("BAD_REQUEST", "Vista inválida.", 400);
    const rawQuery = boundedString(params.get("q"), 80);
    if (rawQuery === null) return apiError("BAD_REQUEST", "Búsqueda demasiado larga.", 400);
    const q = rawQuery.replace(/[,%()]/g, " ").trim();
    const page = Math.max(1, Number(params.get("page") || 1) | 0);
    const limit = 20;
    const db = createAdminServerClient();
    let query = db.from("customers")
      .select("id,full_name,phone,email,document_number,notes,created_at,updated_at,archived_at", { count: "exact" })
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    query = view === "active" ? query.is("archived_at", null) : query.not("archived_at", "is", null);
    if (q) query = query.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%,document_number.ilike.%${q}%`);
    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    const customers = (data || []) as unknown as CustomerRow[];
    const ids = customers.map(row => row.id);
    const [sales, vehicles, warranties] = await Promise.all([
      ids.length ? db.from("sales").select("id,customer_id,total,status,created_at").in("customer_id", ids).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      ids.length ? db.from("customer_vehicles").select("id,customer_id,brand_name,model_name,year,plate").in("customer_id", ids) : Promise.resolve({ data: [], error: null }),
      ids.length ? db.from("warranties").select("id,customer_id,status,warranty_claims(status)").in("customer_id", ids) : Promise.resolve({ data: [], error: null }),
    ]);
    if (sales.error || vehicles.error || warranties.error) throw new Error(sales.error?.message || vehicles.error?.message || warranties.error?.message);
    const saleRows = (sales.data || []) as unknown as SaleRow[];
    const vehicleRows = (vehicles.data || []) as unknown as VehicleRow[];
    const warrantyRows = (warranties.data || []) as unknown as WarrantyRow[];
    const result = customers.map(customer => {
      const purchases = saleRows.filter(sale => sale.customer_id === customer.id);
      return {
        ...customer,
        sales: purchases,
        vehicles: vehicleRows.filter(vehicle => vehicle.customer_id === customer.id),
        warranties: warrantyRows.filter(warranty => warranty.customer_id === customer.id),
        total: purchases.filter(sale => sale.status === "completed").reduce((sum, sale) => sum + Number(sale.total), 0),
        lastPurchase: purchases[0]?.created_at || null,
      };
    });
    return NextResponse.json({ ok: true, data: result, pagination: { page, limit, total: count || 0 } });
  } catch (error) { return apiInternalError("admin_customers_list", error); }
}

export async function POST(request: Request) {
  const blocked = await guard(); if (blocked) return blocked;
  const body = await readJsonObject(request);
  if (!body || typeof body.action !== "string") return apiError("BAD_REQUEST", "Acción inválida.", 400);
  const action = body.action;
  if (!["create", "edit", "archive", "restore", "delete"].includes(action)) return apiError("BAD_REQUEST", "Acción inválida.", 400);
  const customerId = body.customerId;
  if (action !== "create" && !isUuid(customerId)) return apiError("BAD_REQUEST", "Cliente inválido.", 400);
  let data: Record<string, string | null> = {};
  if (action === "create" || action === "edit") {
    const fullName = boundedString(body.fullName, 160, { required: true });
    const phone = boundedString(body.phone, 50);
    const email = boundedString(body.email, 255);
    const documentNumber = boundedString(body.documentNumber, 40);
    const notes = boundedString(body.notes, 1000);
    if (!fullName || phone === null || email === null || documentNumber === null || notes === null || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return apiError("BAD_REQUEST", "Revisá los datos del cliente.", 400);
    }
    data = { full_name: fullName, phone: phone || null, email: email || null, document_number: documentNumber || null, notes };
  }
  try {
    const db = createAdminServerClient();
    const { data: result, error } = await db.rpc("admin_manage_customer" as never, {
      p_action: action, p_customer: action === "create" ? null : customerId, p_data: data,
    } as never) as unknown as { data: Record<string, unknown> | null; error: { message: string } | null };
    if (error) {
      if (error.message.includes("CUSTOMER_NOT_FOUND")) return apiError("NOT_FOUND", "Cliente no encontrado.", 404);
      if (error.message.includes("CUSTOMER_HAS_DEPENDENCIES") || error.message.includes("foreign key constraint")) {
        return apiError("BAD_REQUEST", "El cliente tiene vehículos o historial relacionado. Archivá el cliente en lugar de eliminarlo.", 409);
      }
      if (error.message.includes("CUSTOMER_INVALID")) return apiError("BAD_REQUEST", "Revisá los datos del cliente.", 400);
      throw new Error(error.message);
    }
    return NextResponse.json({ ok: true, data: result });
  } catch (error) { return apiInternalError("admin_customer_mutation", error); }
}
