export type OrderItemInput = { productId: string; quantity: number };

// Shared by checkout and API. SQL repeats this validation at the trust boundary.
export function normalizeOrderItems(items: OrderItemInput[]): OrderItemInput[] {
  if (!items.length || items.length > 50) throw new Error("INVALID_QUANTITY");
  const quantities = new Map<string, number>();
  for (const item of items) {
    const id = item.productId.trim();
    if (!id || id.length > 64 || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) throw new Error("INVALID_QUANTITY");
    const quantity = (quantities.get(id) ?? 0) + item.quantity;
    if (quantity > 100) throw new Error("INVALID_QUANTITY");
    quantities.set(id, quantity);
  }
  return [...quantities].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([productId, quantity]) => ({ productId, quantity }));
}

export function checkoutFingerprint(items: OrderItemInput[], method: string | null, form: Record<string, string>) {
  return JSON.stringify({ items: normalizeOrderItems(items), method, form: Object.fromEntries(Object.entries(form).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, value.trim()])) });
}
