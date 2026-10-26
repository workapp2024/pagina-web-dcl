import { randomUUID } from "node:crypto";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { isSameOriginWrite } from "@/lib/store/buyer-session";
import { createAdminServerClient } from "@/lib/supabase/server";
import type { CatalogFoundationDatabase } from "@/lib/supabase/catalog-foundation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateCatalogCategory, validateCatalogVehicleType } from "@/lib/catalog-foundation";
import { readJsonObject } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function access(request?: Request) {
  if (!(await isAdminAuthenticated("admin"))) return json({ ok: false, error: "Acceso exclusivo para ADMIN." }, 401);
  if (request && !isSameOriginWrite(request)) return json({ ok: false, error: "Origen no autorizado." }, 403);
  if (process.env.DCL_CATALOG_ADMIN_ENABLED !== "1") return json({ ok: false, error: "La administración del catálogo nuevo no está habilitada." }, 503);
  return null;
}
const database = () => createAdminServerClient() as unknown as SupabaseClient<CatalogFoundationDatabase>;
function failure(error: { code?: string } | null) {
  if ((error?.code === "23503" || error?.code === "23001")) return json({ ok: false, error: "No se puede eliminar: tiene productos, subcategorías o enlaces asociados. No se reasignó ningún producto." }, 409);
  if (error?.code === "23505") return json({ ok: false, error: "Ese identificador o slug ya existe." }, 409);
  if (error?.code === "23514") return json({ ok: false, error: "Revisá la jerarquía, el estado y los valores ingresados. Solo se permite un nivel de subcategorías." }, 400);
  return json({ ok: false, error: "No se pudo completar la operación. Revisá el esquema y volvé a cargar." }, 503);
}
export async function GET() {
  const denied = await access(); if (denied) return denied;
  try {
    const db = database();
    const [categories, types] = await Promise.all([
      db.from("catalog_categories").select("*", { count: "exact" }).order("sort_order").order("id").limit(501),
      db.from("catalog_vehicle_types").select("*", { count: "exact" }).order("sort_order").order("id").limit(501),
    ]);
    if (categories.error || types.error) return failure(categories.error || types.error);
    if ((categories.count ?? 0) > 500 || (types.count ?? 0) > 500) return json({ ok: false, error: "El catálogo supera el límite de esta vista. No se muestran datos incompletos." }, 503);
    const categoryRows = await Promise.all((categories.data ?? []).map(async category => {
      const [products, aliases] = await Promise.all([
        db.from("product_catalog_assignments").select("product_id", { head: true, count: "exact" }).eq("category_id", category.id),
        db.from("catalog_category_aliases").select("alias", { head: true, count: "exact" }).eq("category_id", category.id),
      ]);
      if (products.error || aliases.error) throw new Error("Usage unavailable");
      return { ...validateCatalogCategory(category), usage: { products: products.count ?? 0, aliases: aliases.count ?? 0,
        children: (categories.data ?? []).filter(child => child.parent_id === category.id).length } };
    }));
    const vehicleTypes = await Promise.all((types.data ?? []).map(async type => {
      const usage = await db.from("product_catalog_vehicle_types").select("product_id", { head: true, count: "exact" }).eq("vehicle_type_id", type.id);
      if (usage.error) throw new Error("Usage unavailable");
      return { ...validateCatalogVehicleType(type), usage: { products: usage.count ?? 0 } };
    }));
    return json({ ok: true, categories: categoryRows, vehicleTypes });
  } catch { return failure(null); }
}
async function mutate(request: Request, operation: "create" | "update" | "delete") {
  const denied = await access(request); if (denied) return denied;
  const limited = rateLimit(request, "catalog-foundation-write", { limit: 30, windowMs: 60000 }); if (limited) return limited;
  const body = await readJsonObject(request);
  if (!body || !["category", "vehicle"].includes(String(body.kind)) || Object.keys(body).some(key => !["kind","value","expected"].includes(key))) return json({ ok: false, error: "Datos no válidos." }, 400);
  try {
    const db = database();
    const category = body.kind === "category";
    // The client cannot choose/reuse an identity when creating a record.
    const candidate = operation === "create" ? { ...(body.value as object), id: (category ? "category-" : "vehicle-") + randomUUID() } : body.value;
    // Strip neither fields nor invalid values: validators reject unknown input.
    if (operation !== "delete" && (!body.value || typeof body.value !== "object" || Array.isArray(body.value))) return json({ ok: false, error: "Datos no válidos." }, 400);
    let result;
    if (category) {
      const expected = operation === "create" ? null : validateCatalogCategory(body.expected);
      const value = operation === "delete" ? null : validateCatalogCategory(candidate);
      if (expected && value && expected.id !== value.id) return json({ ok: false, error: "El identificador no puede cambiar." }, 400);
      if (operation === "create") result = await db.from("catalog_categories").insert(value!).select("id").single();
      else {
        const { parent_id, ...match } = expected!;
        const q = operation === "delete" ? db.from("catalog_categories").delete().match(match) : db.from("catalog_categories").update(value!).match(match);
        result = await (parent_id === null ? q.is("parent_id", null) : q.eq("parent_id", parent_id)).select("id").maybeSingle();
      }
    } else {
      const expected = operation === "create" ? null : validateCatalogVehicleType(body.expected);
      const value = operation === "delete" ? null : validateCatalogVehicleType(candidate);
      if (expected && value && expected.id !== value.id) return json({ ok: false, error: "El identificador no puede cambiar." }, 400);
      if (operation === "create") result = await db.from("catalog_vehicle_types").insert(value!).select("id").single();
      else result = await (operation === "delete" ? db.from("catalog_vehicle_types").delete().match(expected!) : db.from("catalog_vehicle_types").update(value!).match(expected!)).select("id").maybeSingle();
    }
    if (result.error) return failure(result.error);
    if (!result.data) return json({ ok: false, error: "El registro cambió o ya no existe. Volvé a cargar antes de guardar." }, 409);
    return json({ ok: true }, operation === "create" ? 201 : 200);
  } catch (error) {
    if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && /Invalid|category cannot/.test(error.message)) return json({ ok: false, error: "Revisá los campos y el identificador. No se guardaron cambios." }, 400);
    return failure(null);
  }
}
export const POST = (request: Request) => mutate(request, "create");
export const PATCH = (request: Request) => mutate(request, "update");
export const DELETE = (request: Request) => mutate(request, "delete");
