import type { CartLine } from "@/components/store/CartProvider";
import type { OrderItemInput } from "@/lib/store/order-input";
export const CART_KEY = "dcl-public-cart-v1";
export type StoredCart = { lines: CartLine[]; consumedOrders: string[] };
export function readStoredCart(storage: Storage): StoredCart {
  const value = JSON.parse(storage.getItem(CART_KEY) || "[]");
  const lines = Array.isArray(value) ? value : value.lines;
  if (!Array.isArray(lines)) throw new Error("Carrito inválido");
  return { lines, consumedOrders: !Array.isArray(value) && Array.isArray(value.consumedOrders) ? value.consumedOrders : [] };
}
export function consumeCart(storage: Storage, orderNumber: string, items: OrderItemInput[]) {
  const cart = readStoredCart(storage);
  if (cart.consumedOrders.includes(orderNumber)) return cart;
  const purchased = new Map(items.map(item => [item.productId, item.quantity]));
  const lines = cart.lines.flatMap(line => {
    const quantity = Math.max(0, line.quantity - (purchased.get(line.id) || 0));
    return quantity ? [{ ...line, quantity }] : [];
  });
  const next = { lines, consumedOrders: [...cart.consumedOrders, orderNumber] };
  // One atomic storage write for quantities AND consumption marker. A crash or
  // lost response cannot consume the same order twice, including newly added units.
  storage.setItem(CART_KEY, JSON.stringify(next));
  return next;
}
