export type CatalogCategory = {
  id: string; name: string; description: string; slug: string; parent_id: string | null;
  sort_order: number; active: boolean; form_profile: "lighting" | "general";
};
export type CatalogVehicleType = { id: string; name: string; sort_order: number; active: boolean };
export type CatalogFoundationSnapshot = { categories: CatalogCategory[]; vehicleTypes: CatalogVehicleType[] };
const identifier = /^[a-z][a-z0-9_-]{0,63}$/;
export function validateCatalogId(value: unknown): string {
  if (typeof value !== "string" || !identifier.test(value)) throw new Error("Invalid catalog identifier");
  return value;
}
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== "string" || value !== value.trim() || value.length > max || (!empty && !value)) throw new Error("Invalid catalog text");
  return value;
}
function base(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Invalid catalog fields");
  return value as Record<string, unknown>;
}
function position(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 2147483647) throw new Error("Invalid display order");
  return value;
}
function active(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid active state");
  return value;
}
export function validateCatalogCategory(value: unknown): CatalogCategory {
  const row = base(value, ["id","name","description","slug","parent_id","sort_order","active","form_profile"]);
  const id = validateCatalogId(row.id), slug = text(row.slug, 120);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new Error("Invalid category slug");
  const parent = row.parent_id === null ? null : validateCatalogId(row.parent_id);
  if (parent === id) throw new Error("A category cannot be its own parent");
  if (row.form_profile !== "lighting" && row.form_profile !== "general") throw new Error("Invalid form profile");
  return { id, name: text(row.name,120), description: text(row.description,2000,true), slug, parent_id: parent,
    sort_order: position(row.sort_order), active: active(row.active), form_profile: row.form_profile };
}
export function validateCatalogVehicleType(value: unknown): CatalogVehicleType {
  const row = base(value,["id","name","sort_order","active"]);
  return { id: validateCatalogId(row.id), name: text(row.name,120), sort_order: position(row.sort_order), active: active(row.active) };
}
export function validateCatalogDestinations(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Invalid destinations");
  const ids = value.map(validateCatalogId);
  if (new Set(ids).size !== ids.length || (ids.includes("universal") && ids.length !== 1)) throw new Error("Universal excludes particular destinations; duplicates are forbidden");
  // Existence and active state are checked against the database, never hardcoded.
  return ids;
}
