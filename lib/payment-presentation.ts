import type { PaymentPresentationMethod } from "@/lib/site-data";

export const paymentPresentationMethodIds = ["mercadopago", "card", "transfer"] as const;
export const paymentCardBrands = [
  { id: "visa", name: "Visa" },
  { id: "mastercard", name: "Mastercard" },
  { id: "american_express", name: "American Express" },
  { id: "naranja_x", name: "Naranja X" },
  { id: "cabal", name: "Cabal" },
] as const;

function normalizeCardBrands(value: unknown) {
  const source = value === undefined ? paymentCardBrands.map((brand, index) => ({ ...brand, logoUrl: "", enabled: false, sortOrder: (index + 1) * 10 })) : value;
  if (!Array.isArray(source) || source.length !== paymentCardBrands.length) return null;
  const byId = new Map(source.map(entry => entry && typeof entry === "object" && !Array.isArray(entry) ? [String((entry as Record<string, unknown>).id), entry as Record<string, unknown>] as const : ["", {}] as const));
  if (byId.size !== paymentCardBrands.length) return null;
  const brands = [];
  for (const definition of paymentCardBrands) {
    const row = byId.get(definition.id);
    if (!row || row.name !== definition.name || typeof row.logoUrl !== "string" || row.logoUrl.length > 1000
      || (row.logoUrl && !isSafeLogoUrl(row.logoUrl)) || typeof row.enabled !== "boolean"
      || !Number.isInteger(row.sortOrder) || Number(row.sortOrder) < 0 || Number(row.sortOrder) > 1000) return null;
    brands.push({ ...definition, logoUrl: row.logoUrl, enabled: row.enabled, sortOrder: Number(row.sortOrder) });
  }
  return brands.sort((a, b) => a.sortOrder - b.sortOrder);
}

export function normalizePaymentPresentationMethods(value: unknown): PaymentPresentationMethod[] {
  if (!Array.isArray(value) || value.length > 3) return [];
  const seen = new Set<string>();
  const methods: PaymentPresentationMethod[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    if (!paymentPresentationMethodIds.includes(row.id as typeof paymentPresentationMethodIds[number]) || seen.has(String(row.id))) continue;
    if (typeof row.name !== "string" || !row.name.trim() || row.name.length > 60) continue;
    if (typeof row.logoUrl !== "string" || row.logoUrl.length > 1000 || (row.logoUrl && !isSafeLogoUrl(row.logoUrl))) continue;
    if (!["enabled", "showHome", "showWholesale", "showCheckout"].every(key => typeof row[key] === "boolean")) continue;
    if (!Number.isInteger(row.sortOrder) || Number(row.sortOrder) < 0 || Number(row.sortOrder) > 1000) continue;
    const cardBrands = row.id === "card" ? normalizeCardBrands(row.cardBrands) : undefined;
    if (row.id === "card" && !cardBrands) continue;
    seen.add(String(row.id));
    methods.push({
      id: row.id as PaymentPresentationMethod["id"], name: row.name.trim(), logoUrl: row.logoUrl,
      enabled: row.enabled as boolean, showHome: row.showHome as boolean,
      showWholesale: row.showWholesale as boolean, showCheckout: row.showCheckout as boolean,
      sortOrder: Number(row.sortOrder),
      ...(cardBrands ? { cardBrands } : {}),
    });
  }
  return methods.sort((a, b) => a.sortOrder - b.sortOrder);
}

export function isSafeLogoUrl(value: string) {
  if (value.startsWith("/") && !value.startsWith("//") && !value.split("/").includes("..")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}
