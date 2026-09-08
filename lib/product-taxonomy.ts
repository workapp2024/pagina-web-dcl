// Category IDs retain their stored labels to preserve existing catalog URLs and display.
export const productCategories = [
  { id: "General", label: "Sin clasificar", slug: "general" },
  { id: "Iluminación frontal", label: "Iluminación frontal", slug: "iluminacion-frontal" },
  { id: "Auxiliar", label: "Iluminación auxiliar", slug: "auxiliar" },
  { id: "Accesorios", label: "Accesorios", slug: "accesorios" },
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

export const commercialCategories = productCategories.filter(option => option.id !== "General");
export const productNeeds: { id: string; label: string; filters: ProductClassificationFilters }[] = [
  { id: "high", label: "Luces altas", filters: { function: "high" } },
  { id: "low", label: "Luces bajas", filters: { function: "low" } },
  { id: "fog", label: "Antinieblas", filters: { function: "fog" } },
  ...commercialCategories.filter(option => option.id === "Auxiliar" || option.id === "Accesorios")
    .map(option => ({ id: option.slug, label: option.id === "Auxiliar" ? "Auxiliares" : option.label, filters: { category: option.id } })),
];

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

// Read legacy fog categories through the same contract until the data migration runs.
export function normalizeCommercialClassification(category: string, functions: readonly string[] = []) {
  return {
    category: category === "Antiniebla" ? "Auxiliar" : category,
    functions: normalizeProductFunctions(category === "Antiniebla" ? [...functions, "fog"] : functions),
  };
}

export function accessoryVehicleLabel(product: { category: string; vehicleTypes?: readonly string[] }) {
  if (product.category !== "Accesorios") return undefined;
  const destinations = productVehicleTypes.filter(option => product.vehicleTypes?.includes(option.id));
  return !destinations.length || destinations.length === productVehicleTypes.length
    ? "Uso universal" : `Para ${destinations.map(option => option.label).join(" · ")}`;
}

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
  const classification = normalizeCommercialClassification(product.category, product.functions);
  const universal = product.category === "Accesorios" && !product.vehicleTypes?.length;
  return (!filters.category || classification.category === filters.category)
    && (!filters.vehicleType || universal || Boolean(product.vehicleTypes?.includes(filters.vehicleType)))
    && (!filters.function || classification.functions.includes(filters.function))
    && (!filters.connectorType || (Boolean(connectorKey(filters.connectorType)) && Boolean(product.connectorType) && connectorKey(product.connectorType!) === connectorKey(filters.connectorType)));
}
