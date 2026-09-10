import type { Product } from "@/lib/site-data";
import { legacyProductCategories, matchesProductClassification, productCategories, productFunctions, productVehicleTypes, type ProductClassificationFilters } from "@/lib/product-taxonomy";

export type CatalogParams = Record<string, string | string[] | undefined>;
export type CatalogFilters = { classification: ProductClassificationFilters; query: string; invalid: boolean };

// Stored labels and old category links remain valid; new links use stable slugs.
export function categoryParam(category: string) {
  return productCategories.find(option => option.id === category)?.slug ?? category;
}

export function parseProductFilters(params: CatalogParams): CatalogFilters {
  let invalid = false;
  const read = (key: string) => {
    const value = params[key];
    if (Array.isArray(value)) { invalid = true; return ""; }
    return value ?? "";
  };
  const classification: ProductClassificationFilters = {};
  const vehicle = read("vehiculo"), category = read("categoria"), fn = read("funcion"), connector = read("conector"), query = read("q").trim();
  if (vehicle) {
    const option = productVehicleTypes.find(option => option.id === vehicle);
    if (option) classification.vehicleType = option.id; else invalid = true;
  }
  if (category) {
    const option = productCategories.find(option => option.slug === category || option.id === category);
    if (option) classification.category = option.id;
    else if (category === "antiniebla" || category === "Antiniebla") classification.function = "fog";
    else if (legacyProductCategories.some(value => value === category)) classification.category = category;
    else invalid = true;
  }
  if (fn) {
    const option = productFunctions.find(option => option.id === fn);
    if (option && (!classification.function || classification.function === option.id)) classification.function = option.id; else invalid = true;
  }
  if (connector) {
    if (/^[a-z0-9][a-z0-9 -]{0,29}$/i.test(connector)) classification.connectorType = connector;
    else invalid = true;
  }
  if (query.length > 120) invalid = true;
  return { classification, query: query.slice(0, 120), invalid };
}

export function productCatalogHref(filters: ProductClassificationFilters = {}, query = "") {
  const params = new URLSearchParams();
  if (filters.vehicleType) params.set("vehiculo", filters.vehicleType);
  if (filters.category) params.set("categoria", categoryParam(filters.category));
  if (filters.function) params.set("funcion", filters.function);
  if (filters.connectorType) params.set("conector", filters.connectorType);
  if (query.trim()) params.set("q", query.trim());
  return `/productos${params.size ? `?${params}` : ""}`;
}

export function filterCatalogProducts(products: Product[], filters: CatalogFilters) {
  if (filters.invalid) return [];
  const needle = filters.query.toLowerCase();
  const connectorSearch = products.some(product => product.connectorType?.toLowerCase() === needle) ? filters.query : undefined;
  return products.filter(product => product.active && product.showInCatalog
    && matchesProductClassification(product, filters.classification)
    && (!connectorSearch || matchesProductClassification(product, { connectorType: connectorSearch }))
    && (!needle || [product.name, product.description, product.category, product.connectorType,
      ...productFunctions.filter(option => product.functions?.includes(option.id)).map(option => option.label)
    ].some(value => value?.toLowerCase().includes(needle))));
}

export function productFilterLabels(filters: ProductClassificationFilters) {
  return [productVehicleTypes.find(option => option.id === filters.vehicleType)?.label,
    productCategories.find(option => option.id === filters.category)?.label ?? filters.category,
    productFunctions.find(option => option.id === filters.function)?.label,
    filters.connectorType ? `Conector ${filters.connectorType}` : undefined].filter(Boolean).join(" · ");
}

// Only controlled taxonomy values; never query text, connector input or URLs.
export function productFilterEventProperties(filters: ProductClassificationFilters) {
  return {
    ...(productVehicleTypes.some(option => option.id === filters.vehicleType) ? { vehicle_type: filters.vehicleType } : {}),
    ...(productCategories.some(option => option.id === filters.category) ? { category: categoryParam(filters.category!) } : {}),
    ...(productFunctions.some(option => option.id === filters.function) ? { function: filters.function } : {}),
  };
}
