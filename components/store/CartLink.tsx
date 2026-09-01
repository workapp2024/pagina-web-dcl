"use client";
import { useCart } from "./CartProvider";
export function CartLink(){const {count}=useCart();return <a href="/carrito" className="rounded-full border border-white/15 px-3 py-2 text-xs font-bold text-white">Carrito{count?` (${count})`:""}</a>}
