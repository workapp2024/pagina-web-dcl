"use client";
import { useCart, type CartProduct } from "./CartProvider";
export function AddToCartButton({product}:{product:CartProduct}){const {add}=useCart();return <button onClick={()=>add(product)} className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full border border-red-500/60 px-3 py-2.5 text-[11px] font-bold uppercase tracking-[.1em] text-red-200">Agregar al carrito</button>}
