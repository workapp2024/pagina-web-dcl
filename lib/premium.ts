import type { Product } from "@/lib/site-data";

export const MAX_PREMIUM_PRODUCTS = 24;
export type PremiumSelection = { productIds: string[]; revision: number };
export type PremiumOption = Pick<Product, "id" | "name" | "image" | "price" | "active" | "showInCatalog">;

export function isPremiumTableUnavailable(error: { code?: string; message?: string }) {
  return ["PGRST205", "42P01"].includes(error.code ?? "")
    && Boolean(error.message?.includes("premium_settings"));
}

export function readPremiumResponse(value: unknown): { selection: PremiumSelection; products: PremiumOption[] } {
  if (!value || typeof value !== "object" || !("selection" in value) || !("products" in value)) throw new Error("Respuesta Premium no válida.");
  const selection = validatePremiumSelection(value.selection);
  if (!Array.isArray(value.products)) throw new Error("Catálogo Premium no válido.");
  const products = value.products.map((item: unknown): PremiumOption => {
    if (!item || typeof item !== "object"
      || !("id" in item) || typeof item.id !== "string"
      || !("name" in item) || typeof item.name !== "string"
      || !("image" in item) || typeof item.image !== "string"
      || !("price" in item) || typeof item.price !== "number" || !Number.isFinite(item.price)
      || !("active" in item) || typeof item.active !== "boolean"
      || !("showInCatalog" in item) || typeof item.showInCatalog !== "boolean") throw new Error("Producto Premium no válido.");
    return { id: item.id, name: item.name, image: item.image, price: item.price, active: item.active, showInCatalog: item.showInCatalog };
  });
  return { selection, products };
}

export function validatePremiumSelection(value: unknown): PremiumSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Selección no válida.");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !["productIds", "revision"].includes(key))) throw new Error("Enviá únicamente la selección Premium.");
  const ids = body.productIds;
  if (!Array.isArray(ids) || ids.length > MAX_PREMIUM_PRODUCTS || ids.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id))) throw new Error("La selección contiene productos no válidos.");
  if (new Set(ids).size !== ids.length) throw new Error("No se permiten productos duplicados.");
  if (!Number.isInteger(body.revision) || Number(body.revision) < 0 || Number(body.revision) >= 2147483647) throw new Error("Recargá la selección antes de guardar.");
  return { productIds: [...ids], revision: body.revision as number };
}

// Read current catalog data by ID. Never copy prices/images or fall back to featured.
export function resolvePremiumProducts(ids: readonly string[], products: readonly Product[]): Product[] {
  const byId = new Map(products.filter(product => product.active && product.showInCatalog).map(product => [product.id, product]));
  return [...new Set(ids)].slice(0, MAX_PREMIUM_PRODUCTS).flatMap(id => {
    const product = byId.get(id);
    return product ? [product] : [];
  });
}

export function movePremiumProduct(ids: readonly string[], index: number, direction: -1 | 1) {
  const next = [...ids], target = index + direction;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
