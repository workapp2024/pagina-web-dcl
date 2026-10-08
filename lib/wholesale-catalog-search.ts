import type { Product } from "@/lib/site-data";
import type { WholesaleCatalogItem } from "@/lib/wholesale-server";
import { filterCatalogProducts } from "@/lib/product-filters";
import { vehiclePositions, vehicleProductMatches } from "@/lib/vehicle-product-search";
import type { VehicleCompatibilityFull } from "@/lib/supabase/vehicle-compatibility";

function asSearchProduct(product: WholesaleCatalogItem): Product {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: 0,
    image: product.imageUrl,
    category: product.category,
    functions: product.functions as Product["functions"],
    vehicleTypes: product.vehicleTypes as Product["vehicleTypes"],
    featured: false,
    active: true,
    showInCatalog: true,
    href: "",
    ctaText: "",
    order: 0,
    connectorType: product.connectorType || undefined,
  };
}

export function filterWholesaleCatalogProducts(
  products: WholesaleCatalogItem[],
  query: string,
  category = "",
) {
  const candidates = products.map(asSearchProduct);
  const visibleIds = new Set(filterCatalogProducts(candidates, {
    classification: category ? { category } : {},
    query: query.trim().slice(0, 120),
    invalid: false,
  }).map(product => product.id));
  return uniqueWholesaleCatalogProducts(products).filter(product => visibleIds.has(product.id));
}

export function uniqueWholesaleCatalogProducts(products: WholesaleCatalogItem[]) {
  const byId = new Map<string, WholesaleCatalogItem>();
  for (const product of products) {
    if (!byId.has(product.id)) byId.set(product.id, product);
  }
  return [...byId.values()];
}

export function groupWholesaleVehicleMatches(
  matches: ReturnType<typeof vehicleProductMatches>,
  year: string,
) {
  const byId = new Map<string, { product: Product; fitments: Set<string> }>();
  for (const match of matches) {
    let grouped = byId.get(match.product.id);
    if (!grouped) {
      grouped = { product: match.product, fitments: new Set<string>() };
      byId.set(match.product.id, grouped);
    }
    grouped.fitments.add(`${match.row.brandName} ${match.row.modelName} ${year} · ${match.position.label} · ${match.connector}`);
  }
  return [...byId.values()].map(({ product, fitments }) => ({ product, fitments: [...fitments] }));
}

export type WholesaleVehicleMatch = {
  product: WholesaleCatalogItem;
  fitments: string[];
};

function normalizeSearchText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function queryPosition(tokens: string[]) {
  if (tokens.some(token => ["baja", "low"].includes(token))) return "low";
  if (tokens.some(token => ["alta", "high"].includes(token))) return "high";
  if (tokens.some(token => ["antiniebla", "fog"].includes(token))) return "fog";
  if (tokens.some(token => ["auxiliar", "auxiliares", "aux"].includes(token))) return "aux";
  return "";
}

export function findWholesaleVehicleMatches(
  query: string,
  products: WholesaleCatalogItem[],
  compatibilities: VehicleCompatibilityFull[],
): WholesaleVehicleMatch[] {
  const tokens = normalizeSearchText(query).split(" ").filter(Boolean);
  const year = tokens.find(token => /^\d{4}$/.test(token)) || "";
  const requestedPosition = queryPosition(tokens);
  const vehicleTerms = tokens.filter(token => token !== year
    && !["baja", "low", "alta", "high", "antiniebla", "fog", "auxiliar", "auxiliares", "aux"].includes(token));
  if (!vehicleTerms.length) return [];

  const uniqueProducts = uniqueWholesaleCatalogProducts(products);
  const searchProducts = uniqueProducts.map(asSearchProduct);
  const byId = new Map(uniqueProducts.map(product => [product.id, product]));
  const grouped = new Map<string, Set<string>>();
  for (const row of compatibilities) {
    const vehicleText = normalizeSearchText(`${row.brandName} ${row.modelName} ${row.vehicleType}`);
    if (!vehicleTerms.every(term => vehicleText.includes(term))) continue;
    const selectedYear = year || String(row.yearFrom);
    const matches = vehicleProductMatches(searchProducts, [row], selectedYear, requestedPosition);
    for (const match of matches) {
      const labels = grouped.get(match.product.id) ?? new Set<string>();
      const years = row.yearTo ? `${row.yearFrom}–${row.yearTo}` : `${row.yearFrom} en adelante`;
      labels.add(`${row.brandName} ${row.modelName} · ${years} · ${match.position.label}`);
      grouped.set(match.product.id, labels);
    }
  }
  return uniqueProducts.flatMap(product => {
    const fitments = grouped.get(product.id);
    return fitments ? [{ product: byId.get(product.id)!, fitments: [...fitments] }] : [];
  });
}

export function productFromWholesaleItem(product: WholesaleCatalogItem): Product {
  return { ...asSearchProduct(product), wholesalePrice: product.wholesalePrice };
}

export { vehiclePositions };
