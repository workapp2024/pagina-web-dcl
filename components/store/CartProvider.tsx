/* eslint-disable react-hooks/set-state-in-effect */
"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { analyticsEvents, capture } from "@/lib/analytics";
import { CART_KEY, consumeCart, readStoredCart } from "@/lib/store/cart-persistence";
import type { OrderItemInput } from "@/lib/store/order-input";
export type CartProduct = { id: string; name: string; price: number; image: string; href: string; category?: string };
export type CartLine = CartProduct & { quantity: number };
type Cart = { lines: CartLine[]; ready: boolean; add: (product: CartProduct) => void; remove: (id: string) => void; change: (id: string, quantity: number) => void; consumePurchasedItems: (number: string, items: OrderItemInput[]) => Promise<void>; count: number; total: number; revision: number };
const Context = createContext<Cart | null>(null);
export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]), [ready, setReady] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    const sync = () => { try { setLines(readStoredCart(localStorage).lines); } catch { setLines([]); } };
    sync(); setReady(true);
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const mutate = useCallback(async (change: (current: CartLine[]) => CartLine[]) => {
    const write = () => {
      const cart = readStoredCart(localStorage);
      const next = { ...cart, lines: change(cart.lines) };
      localStorage.setItem(CART_KEY, JSON.stringify(next));
      setLines(next.lines); setRevision(value => value + 1);
    };
    if (navigator.locks) await navigator.locks.request("dcl-cart", write); else write();
  }, []);
  const consumePurchasedItems = useCallback(async (number: string, items: OrderItemInput[]) => {
    const write = () => setLines(consumeCart(localStorage, number, items).lines);
    if (navigator.locks) await navigator.locks.request("dcl-cart", write); else write();
  }, []);
  const value = useMemo<Cart>(() => ({
    lines, ready, revision, consumePurchasedItems,
    add: product => { capture(analyticsEvents.addToCart, { product_id: product.id, category: product.category, quantity: 1 }); void mutate(current => current.some(item => item.id === product.id) ? current.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item) : [...current, { ...product, quantity: 1 }]); },
    remove: id => { capture(analyticsEvents.removeFromCart, { product_id: id }); void mutate(current => current.filter(item => item.id !== id)); },
    change: (id, quantity) => { void mutate(current => quantity < 1 ? current.filter(item => item.id !== id) : current.map(item => item.id === id ? { ...item, quantity } : item)); },
    count: lines.reduce((sum, item) => sum + item.quantity, 0), total: lines.reduce((sum, item) => sum + item.price * item.quantity, 0),
  }), [lines, ready, revision, consumePurchasedItems, mutate]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useCart() { const value = useContext(Context); if (!value) throw new Error("CartProvider requerido"); return value; }
