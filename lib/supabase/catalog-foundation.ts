import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createAdminServerClient } from "./server";
import { validateCatalogCategory, validateCatalogVehicleType, type CatalogCategory, type CatalogVehicleType, type CatalogFoundationSnapshot } from "@/lib/catalog-foundation";

// Scoped contract: no change to existing Product types, readers or SDK clients.
type Table<Row> = { Row: Row; Insert: Row; Update: Partial<Row>; Relationships: [] };
export type CatalogFoundationDatabase = { public: {
  Tables: {
    catalog_categories: Table<CatalogCategory>;
    catalog_vehicle_types: Table<CatalogVehicleType>;
    product_catalog_assignments: Table<{ product_id: string; category_id: string }>;
    product_catalog_vehicle_types: Table<{ product_id: string; vehicle_type_id: string }>;
    catalog_category_aliases: Table<{ alias: string; category_id: string }>;
  };
  Views: Record<string, never>; Functions: Record<string, never>;
} };
export type CatalogFoundationResult = { status: "disabled" | "unavailable" } | { status: "ready"; data: CatalogFoundationSnapshot };

// Preparation/diagnostic read only. No page or current catalog calls this function.
// Even with the flag enabled, this does NOT activate the new public taxonomy.
export async function readCatalogFoundation(): Promise<CatalogFoundationResult> {
  if (!(await isAdminAuthenticated("admin"))) throw new Error("Catalog foundation requires ADMIN access");
  if (process.env.DCL_CATALOG_FOUNDATION_READ_ENABLED !== "1") return { status: "disabled" };
  try {
    const db = createAdminServerClient() as unknown as SupabaseClient<CatalogFoundationDatabase>;
    const [categories, vehicleTypes] = await Promise.all([
      db.from("catalog_categories").select("*").order("sort_order").order("id"),
      db.from("catalog_vehicle_types").select("*").order("sort_order").order("id"),
    ]);
    if (categories.error || vehicleTypes.error) return { status: "unavailable" };
    return { status: "ready", data: {
      categories: (categories.data ?? []).map(validateCatalogCategory),
      vehicleTypes: (vehicleTypes.data ?? []).map(validateCatalogVehicleType),
    } };
  } catch { return { status: "unavailable" }; }
}
