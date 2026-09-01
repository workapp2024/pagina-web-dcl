import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createAdminServerClient } from "@/lib/supabase/server";

export async function GET() {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ ok: false }, { status: 401 });
  const db = createAdminServerClient();
  const [warranties, saleItems] = await Promise.all([
    db
      .from("warranties")
      .select("id,status,starts_at,expires_at,notes,created_at,sale_item_id,customer_id,warranty_claims(id,status,description,resolution,created_at),customers(full_name,phone),sale_items(product_name,quantity,unit_price,sales(id,created_at))")
      .order("created_at", { ascending: false }),
    db
      .from("sale_items")
      .select("id,product_name,quantity,unit_price,sale_id,sales(customer_id,customer_vehicle_id,created_at,customers(full_name,phone))")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  const error = warranties.error || saleItems.error;
  return error
    ? NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    : NextResponse.json({ ok: true, warranties: warranties.data, saleItems: saleItems.data });
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ ok: false }, { status: 401 });
  const body = await request.json();
  const saleItemId = String(body.saleItemId ?? "");
  if (!saleItemId) return NextResponse.json({ ok: false, error: "Seleccioná un producto vendido." }, { status: 400 });
  const db = createAdminServerClient();
  const item: any = await db.from("sale_items").select("id,sales(customer_id,customer_vehicle_id)").eq("id", saleItemId).single();
  const sale = item.data?.sales;
  if (item.error || !sale?.customer_id) return NextResponse.json({ ok: false, error: "Venta no encontrada." }, { status: 404 });
  const result: any = await db
    .from("warranties")
    .insert({
      sale_item_id: saleItemId,
      customer_id: sale.customer_id,
      customer_vehicle_id: sale.customer_vehicle_id ?? null,
      expires_at: body.expiresAt || null,
      notes: String(body.notes ?? ""),
    } as never)
    .select("id")
    .single();
  return result.error
    ? NextResponse.json({ ok: false, error: result.error.message }, { status: 500 })
    : NextResponse.json({ ok: true, id: result.data.id });
}

export async function PATCH(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ ok: false }, { status: 401 });
  const body = await request.json();
  const db = createAdminServerClient();
  if (body.kind === "warranty") {
    const { error } = await db
      .from("warranties")
      .update({ status: body.status, expires_at: body.expiresAt || null, notes: String(body.notes ?? "") } as never)
      .eq("id", body.id);
    return error ? NextResponse.json({ ok: false, error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
  }
  if (body.kind === "claim") {
    const { error } = await db
      .from("warranty_claims")
      .update({ status: body.status, resolution: body.resolution || null } as never)
      .eq("id", body.id);
    return error ? NextResponse.json({ ok: false, error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
  }
  if (body.kind === "new_claim" && body.warrantyId && String(body.description ?? "").trim()) {
    const { error } = await db.from("warranty_claims").insert({ warranty_id: body.warrantyId, description: String(body.description).trim() } as never);
    return error ? NextResponse.json({ ok: false, error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, error: "Acción inválida." }, { status: 400 });
}
