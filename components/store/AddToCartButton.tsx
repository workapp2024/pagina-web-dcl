"use client";

import { useRef, useState } from "react";
import { analyticsEvents, capture } from "@/lib/analytics";
import { useCart, type CartProduct } from "./CartProvider";

export function AddToCartButton({ product }: { product: CartProduct }) {
  const { add, lines } = useCart();
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);

  async function handleAdd() {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    setMessage("");
    const quantity = (lines.find(item => item.id === product.id)?.quantity || 0) + 1;
    try {
      const response = await fetch(`/api/store/products/${encodeURIComponent(product.id)}/availability?quantity=${quantity}`);
      const body = await response.json();
      if (!response.ok || !body.available) {
        const reason = body.reason || "unavailable";
        capture(analyticsEvents.addToCartBlocked, { product_id: product.id, reason });
        setMessage(reason === "out_of_stock" ? "Sin stock disponible" : "Producto no disponible");
        return;
      }
      add(product);
      setMessage("Agregado");
    } catch {
      capture(analyticsEvents.addToCartBlocked, { product_id: product.id, reason: "network" });
      setMessage("No se pudo verificar el stock");
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }

  return <div className="flex flex-1 flex-col"><button type="button" disabled={checking} onClick={() => void handleAdd()} className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-red-500/60 px-3 py-2.5 text-[11px] font-bold uppercase tracking-[.1em] text-red-200 disabled:opacity-50">{checking ? "Verificando…" : "Agregar al carrito"}</button>{message&&<span aria-live="polite" className="mt-1 text-center text-[10px] text-zinc-400">{message}</span>}</div>;
}
