import type { WholesaleCatalogItem } from "@/lib/wholesale-server";

export type WholesaleOrderSelection = Record<string, { product: WholesaleCatalogItem; quantity: number }>;
export type PendingWholesaleRequest = { key: string; items: { productId: string; quantity: number }[] } | null;

export function addWholesaleProduct(
  selection: WholesaleOrderSelection,
  pending: PendingWholesaleRequest,
  product: WholesaleCatalogItem,
) {
  if (selection[product.id]) return { selection, pending, changed: false };
  return {
    selection: { ...selection, [product.id]: { product, quantity: 1 } },
    pending: null,
    changed: true,
  };
}

export function setWholesaleQuantity(
  selection: WholesaleOrderSelection,
  pending: PendingWholesaleRequest,
  productId: string,
  quantity: number,
) {
  const current = selection[productId];
  if (!current || (quantity > 0 && current.quantity === quantity)) {
    return { selection, pending, changed: false };
  }
  const next = { ...selection };
  if (quantity < 1) delete next[productId];
  else next[productId] = { ...current, quantity };
  return { selection: next, pending: null, changed: true };
}
