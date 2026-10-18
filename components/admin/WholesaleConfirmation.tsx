"use client";

import { useState } from "react";

type Item = { productId: string; name: string; quantity: number };
type Inventory = { productId: string; available: number; reserved: number; onHand: number };

export function WholesaleConfirmation({ items, conditions, approved, busy, confirm }: {
  items: Item[]; conditions: string; approved: boolean; busy: boolean; confirm: () => void;
}) {
  const [inventory, setInventory] = useState<Inventory[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  async function check() {
    setLoading(true); setInventory(null); setError(""); setReviewed(false);
    try {
      const response = await fetch("/api/admin/wholesale-inventory", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.data?.products)) throw new Error("No se pudo comprobar el stock. Actualizá la consulta antes de confirmar.");
      setInventory(body.data.products);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo comprobar el stock."); }
    finally { setLoading(false); }
  }
  const sufficient = inventory !== null && items.length > 0 && items.every(item => {
    const stock = inventory.find(row => row.productId === item.productId);
    return stock && Number.isFinite(stock.available) && stock.available >= item.quantity;
  });
  return <section className="w-full space-y-3 rounded-xl border border-emerald-300/20 p-4" aria-label="Confirmar pedido">
    <h3 className="font-bold text-emerald-100">Confirmar pedido</h3>
    {approved&&<p className="text-sm text-emerald-200">✓ Propuesta aceptada por el cliente</p>}
    <details className="text-sm"><summary className="min-h-11 cursor-pointer py-3">Condiciones y detalle de disponibilidad</summary><p className="whitespace-pre-wrap text-zinc-400">{conditions || "Sin condiciones adicionales"}</p><p className="mt-2 text-zinc-400">Confirmar reserva stock. El servidor vuelve a comprobar la disponibilidad; no registra cobros ni entregas.</p></details>
    <div className="text-sm"><button type="button" disabled={busy || loading} onClick={() => void check()} className="min-h-11 rounded-xl border border-white/15 px-4">{loading ? "Consultando…" : "Comprobar disponibilidad"}</button>
        {inventory && <ul className="mt-3 divide-y divide-white/10">{items.map(item => { const stock = inventory.find(row => row.productId === item.productId); return <li key={item.productId} className="py-2">{item.name} · solicitadas {item.quantity} · disponibles {stock?.available ?? "sin información"}{stock && <span className="block text-xs text-zinc-400">Existencia {stock.onHand} · reservadas {stock.reserved}</span>}{(!stock || stock.available < item.quantity) && <p className="text-amber-200">Stock insuficiente: resolver la disponibilidad o revisar la propuesta antes de confirmar.</p>}</li>; })}</ul>}
        {error && <p role="alert" className="mt-2 text-red-200">{error}</p>}
    </div>
    <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} />Revisé productos, cantidades y condiciones.</label><button type="button" disabled={busy || loading || !sufficient || !reviewed} onClick={confirm} className="min-h-12 w-full rounded-xl border border-emerald-300/30 bg-emerald-300/10 px-4 font-semibold disabled:opacity-40">{busy ? "Confirmando…" : "Confirmar pedido"}</button>
  </section>;
}
