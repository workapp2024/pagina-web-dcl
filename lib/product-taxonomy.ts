// Category IDs retain their stored labels to preserve existing catalog URLs and display.
export const productCategories = [
  { id: "General", label: "Sin clasificar" },
  { id: "Iluminación frontal", label: "Iluminación frontal" },
  { id: "Antiniebla", label: "Antiniebla" },
  { id: "Auxiliar", label: "Auxiliar" },
  { id: "Accesorios", label: "Accesorios" },
] as const;
export const legacyProductCategories = ["Ópticas", "Opticas delanteras"] as const;
export const productVehicleTypes = [
  { id: "auto", label: "Auto" }, { id: "camioneta", label: "Camioneta" },
  { id: "moto", label: "Moto" }, { id: "camion", label: "Camión" },
] as const;
export const productFunctions = [
  { id: "high", label: "Alta" }, { id: "low", label: "Baja" }, { id: "fog", label: "Antiniebla" },
] as const;
export type ProductVehicleType = (typeof productVehicleTypes)[number]["id"];
export type ProductFunction = (typeof productFunctions)[number]["id"];

export function isProductCategory(value: unknown): value is (typeof productCategories)[number]["id"] {
  return productCategories.some(option => option.id === value);
}

function selection<T extends string>(value: unknown, options: readonly { id: T }[], label: string): T[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== "string" || !options.some(option => option.id === item))) {
    throw new Error(`Valores no válidos para ${label}.`);
  }
  return options.filter(option => value.includes(option.id)).map(option => option.id);
}

export function normalizeVehicleTypes(value: unknown): ProductVehicleType[] { return selection(value, productVehicleTypes, "tipos de vehículo"); }
export function normalizeProductFunctions(value: unknown): ProductFunction[] { return selection(value, productFunctions, "funciones"); }

export function buildProductClassificationPatch(value: unknown, existingCategory?: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Clasificación no válida.");
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([key]) => !["category", "vehicleTypes", "functions"].includes(key))) throw new Error("Enviá únicamente campos de clasificación.");
  const patch: { category?: string; vehicle_types?: ProductVehicleType[]; functions?: ProductFunction[] } = {};
  for (const [key, field] of entries) {
    if (key === "category") {
      // An existing legacy category may be retained, never assigned to another product.
      if (!isProductCategory(field) && !(field === existingCategory && legacyProductCategories.some(category => category === field))) throw new Error("Categoría no permitida. Seleccioná una categoría del listado.");
      patch.category = field as string;
    }
    if (key === "vehicleTypes") patch.vehicle_types = normalizeVehicleTypes(field);
    if (key === "functions") patch.functions = normalizeProductFunctions(field);
  }
  return patch;
}

type ClassifiedProduct = { category: string; vehicleTypes?: readonly string[]; functions?: readonly string[]; connectorType?: string };
export type ProductClassificationFilters = { category?: string; vehicleType?: ProductVehicleType; function?: ProductFunction; connectorType?: string };
const connectorKey = (value: string) => value.replace(/[^a-z0-9]/gi, "").toLowerCase();
// Commercial relevance only; never asserts exact vehicle fitment or stock availability.
export function matchesProductClassification(product: ClassifiedProduct, filters: ProductClassificationFilters): boolean {
  return (!filters.category || product.category === filters.category)
    && (!filters.vehicleType || Boolean(product.vehicleTypes?.includes(filters.vehicleType)))
    && (!filters.function || Boolean(product.functions?.includes(filters.function)))
    && (!filters.connectorType || (Boolean(connectorKey(filters.connectorType)) && Boolean(product.connectorType) && connectorKey(product.connectorType!) === connectorKey(filters.connectorType)));
}
