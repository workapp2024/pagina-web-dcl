import type { WholesaleCatalogItem } from "@/lib/wholesale-server";

export type WholesaleOrderSelection = Record<string, { product: WholesaleCatalogItem; quantity: number }>;
export type WholesaleOrderAttempt = {
  attemptId: string;
  status: "open" | "created";
  createdAt: string;
  items: Array<{ productId: string; quantity: number }>;
  order: null | {
    id: string;
    orderNumber: string;
    status: string;
    createdAt: string;
    confirmedAt: string | null;
    items: Array<{ productId: string; name: string; quantity: number; unitPrice: number; lineTotal: number; currency: string }>;
  };
};

export const WHOLESALE_SELECTION_STORAGE_KEY = "dcl-wholesale-selection-v1";

type StoredSelectionItem = { productId: string; quantity: number };

export function serializeWholesaleSelection(selection: WholesaleOrderSelection) {
  const items: StoredSelectionItem[] = Object.entries(selection)
    .filter(([productId, item]) => productId === item.product.id
      && Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 100)
    .map(([productId, item]) => ({ productId, quantity: item.quantity }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
  return JSON.stringify(items);
}

export function restoreWholesaleSelection(serialized: string | null, products: WholesaleCatalogItem[]): WholesaleOrderSelection {
  if (!serialized) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { return {}; }
  if (!Array.isArray(parsed) || parsed.length > 50) return {};

  const available = new Map(products.map(product => [product.id, product]));
  const restored: WholesaleOrderSelection = {};
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    if (Object.keys(item).sort().join(",") !== "productId,quantity"
      || typeof item.productId !== "string" || !Number.isInteger(item.quantity)
      || Number(item.quantity) < 1 || Number(item.quantity) > 100 || Object.hasOwn(restored, item.productId)) continue;
    const product = available.get(item.productId);
    if (product) restored[product.id] = { product, quantity: Number(item.quantity) };
  }
  return restored;
}

export function restoreWholesaleSelectionFromStorage(
  storage: Pick<Storage, "getItem">,
  products: WholesaleCatalogItem[],
) {
  try { return restoreWholesaleSelection(storage.getItem(WHOLESALE_SELECTION_STORAGE_KEY), products); }
  catch { return {}; }
}

export function persistWholesaleSelection(
  storage: Pick<Storage, "setItem" | "removeItem">,
  selection: WholesaleOrderSelection,
) {
  try {
    if (Object.keys(selection).length) storage.setItem(WHOLESALE_SELECTION_STORAGE_KEY, serializeWholesaleSelection(selection));
    else storage.removeItem(WHOLESALE_SELECTION_STORAGE_KEY);
  } catch {
    // Private browsing and storage limits must not block catalog or order actions.
  }
}

export function addWholesaleProduct(
  selection: WholesaleOrderSelection,
  product: WholesaleCatalogItem,
) {
  if (selection[product.id]) return { selection, changed: false };
  return {
    selection: { ...selection, [product.id]: { product, quantity: 1 } },
    changed: true,
  };
}

export function setWholesaleQuantity(
  selection: WholesaleOrderSelection,
  productId: string,
  quantity: number,
) {
  const current = selection[productId];
  if (!current || (quantity > 0 && current.quantity === quantity)) {
    return { selection, changed: false };
  }
  const next = { ...selection };
  if (quantity < 1) delete next[productId];
  else next[productId] = { ...current, quantity };
  return { selection: next, changed: true };
}
