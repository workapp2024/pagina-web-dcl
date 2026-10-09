"use client";

import { useEffect, useRef } from "react";
import type { WholesaleOrderSelection } from "@/lib/wholesale-order-selection";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export function WholesaleCartDrawer({
  open, onClose, selection, busy, error, message, onQuantityChange, onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  selection: WholesaleOrderSelection;
  busy: boolean;
  error: string;
  message: string;
  onQuantityChange: (productId: string, quantity: number) => void;
  onSubmit: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const items = Object.values(selection);
  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
  const indicativeTotal = items.reduce((sum, item) => sum + item.product.wholesalePrice * item.quantity, 0);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  return <dialog
    ref={dialog}
    aria-labelledby="wholesale-cart-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    className="fixed inset-y-0 right-0 m-0 h-dvh max-h-none w-full max-w-lg overflow-y-auto border-0 bg-zinc-950 p-0 text-white shadow-2xl backdrop:bg-black/75"
  >
    <section className="flex min-h-full flex-col px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-5 sm:px-6">
      <header className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-300">Solicitud actual</p>
          <h2 id="wholesale-cart-title" className="mt-1 text-2xl font-black">Tu carrito</h2>
          <p className="mt-1 text-sm text-zinc-400">{totalUnits} {totalUnits === 1 ? "unidad" : "unidades"} · {items.length} {items.length === 1 ? "producto" : "productos"}</p>
        </div>
        <button type="button" onClick={onClose} className="min-h-11 shrink-0 rounded-full border border-white/20 px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-red-400">Cerrar</button>
      </header>

      {message && <p role="status" className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-950/30 p-4 text-sm leading-6 text-emerald-100">{message}</p>}

      {items.length ? <>
        <ul className="divide-y divide-white/10">
          {items.map(({ product, quantity }) => <li key={product.id} className="flex flex-wrap items-center gap-3 py-4">
            <span className="min-w-0 flex-1 font-semibold">{product.name}<span className="block text-sm text-zinc-400">Subtotal orientativo: {money.format(product.wholesalePrice * quantity)}</span></span>
            <label className="text-sm text-zinc-300">Cantidad <input aria-label={`Cantidad de ${product.name}`} type="number" min={1} max={100} value={quantity} disabled={busy} onChange={event => onQuantityChange(product.id, Math.min(100, Math.max(1, Number(event.target.value) || 1)))} className="ml-2 min-h-11 w-20 rounded-lg border border-white/20 bg-black px-2 text-white" /></label>
            <button type="button" disabled={busy} onClick={() => onQuantityChange(product.id, 0)} className="min-h-11 px-3 text-sm text-red-300 underline disabled:opacity-50">Quitar</button>
          </li>)}
        </ul>
        <p className="mt-3 text-right text-lg font-bold">Total orientativo: {money.format(indicativeTotal)}</p>
        <p className="mt-2 text-sm leading-6 text-zinc-400">Enviar crea una solicitud para revisión. DCL debe verificar disponibilidad y confirmar las condiciones antes de que exista una compra confirmada.</p>
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-950/50 p-3 text-sm text-red-200">{error}</p>}
        <button type="button" disabled={busy} onClick={onSubmit} className="mt-4 min-h-12 w-full rounded-full bg-red-600 px-5 text-sm font-bold disabled:opacity-50">{busy ? "Enviando solicitud…" : "Enviar solicitud"}</button>
      </> : <p className="py-8 text-sm leading-6 text-zinc-300">Todavía no agregaste productos. Buscá por producto, conector, categoría o vehículo para empezar.</p>}
    </section>
  </dialog>;
}
