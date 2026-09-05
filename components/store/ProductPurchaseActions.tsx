"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { analyticsEvents, capture } from "@/lib/analytics";
import { AddToCartButton } from "./AddToCartButton";
import { useCart, type CartProduct } from "./CartProvider";

type StockLevel = "loading" | "available" | "low" | "out" | "error";

export function ProductPurchaseActions({ product, compact = false }: { product: CartProduct; compact?: boolean }) {
  const router = useRouter();
  const { add, lines } = useCart();
  const [stock, setStock] = useState<StockLevel>("loading");
  const [buying, setBuying] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/store/products/${encodeURIComponent(product.id)}/availability?quantity=1`)
      .then(response => { if (!response.ok) throw new Error("Disponibilidad no confirmada"); return response.json(); })
      .then(body => { if (active) setStock(body.available ? body.stockLevel === "low" ? "low" : "available" : "out"); })
      .catch(() => { if (active) setStock("error"); });
    return () => { active = false; };
  }, [product.id]);

  async function buyNow() {
    if (inFlight.current || !["available", "low"].includes(stock)) return;
    inFlight.current = true;
    setBuying(true);
    const quantity = (lines.find(line => line.id === product.id)?.quantity || 0) + 1;
    try {
      const response = await fetch(`/api/store/products/${encodeURIComponent(product.id)}/availability?quantity=${quantity}`);
      const body = await response.json();
      if (!response.ok) { setStock("error"); return; }
      if (!body.available) { setStock("out"); return; }
      capture(analyticsEvents.buyNowClicked, { product_id: product.id });
      add(product);
      router.push("/carrito");
    } catch { setStock("error"); }
    finally { inFlight.current = false; setBuying(false); }
  }

  const label = stock === "loading" ? "Verificando disponibilidad…" : stock === "low" ? "Últimas unidades" : stock === "out" ? "Sin stock" : stock === "error" ? "Disponibilidad no confirmada" : "Disponible";
  return <div className={compact ? "space-y-2" : "mt-7 space-y-3"}>
    <p aria-live="polite" className={`text-sm font-bold ${stock === "out" || stock === "error" ? "text-amber-300" : stock === "low" ? "text-orange-300" : "text-emerald-300"}`}>{label}</p>
    {stock !== "out" && <div className="grid gap-3 sm:grid-cols-2"><AddToCartButton product={product}/><button type="button" disabled={buying || stock === "loading" || stock === "error"} onClick={() => void buyNow()} className="min-h-12 rounded-full bg-red-600 px-5 text-xs font-bold uppercase tracking-[.1em] text-white disabled:opacity-50">{buying ? "Verificando…" : "Comprar ahora"}</button></div>}
  </div>;
}
