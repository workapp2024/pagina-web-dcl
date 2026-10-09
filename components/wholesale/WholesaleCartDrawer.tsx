"use client";

import { useEffect, useRef, useState } from "react";
import { getWholesaleSelectionTotals, parseWholesaleQuantityDraft } from "@/lib/wholesale-order-selection";
import type { WholesaleOrderSelection } from "@/lib/wholesale-order-selection";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function WholesaleCartItem({
  product, quantity, busy, onQuantityChange,
}: {
  product: WholesaleOrderSelection[string]["product"];
  quantity: number;
  busy: boolean;
  onQuantityChange: (productId: string, quantity: number) => void;
}) {
  const [edit, setEdit] = useState({ quantity, draft: String(quantity), invalid: false });
  const draft = edit.quantity === quantity ? edit.draft : String(quantity);
  const invalid = edit.quantity === quantity && edit.invalid;
  const inputId = `wholesale-quantity-${product.id}`;
  const hintId = `${inputId}-hint`;

  function commitDraft() {
    const parsed = parseWholesaleQuantityDraft(draft);
    if (parsed === null) {
      setEdit({ quantity, draft: String(quantity), invalid: true });
      return;
    }
    setEdit({ quantity: parsed, draft: String(parsed), invalid: false });
    onQuantityChange(product.id, parsed);
  }

  function adjustQuantity(delta: number) {
    const parsed = parseWholesaleQuantityDraft(draft);
    const base = parsed ?? quantity;
    const next = Math.max(1, Math.min(100, base + delta));
    setEdit({ quantity: next, draft: String(next), invalid: false });
    onQuantityChange(product.id, next);
  }

  return <li className="rounded-xl border border-white/10 bg-zinc-900 p-3 sm:p-4">
    <div className="min-w-0">
      <h3 className="break-words text-base font-bold leading-6 text-white">{product.name}</h3>
      <div className="mt-1 grid grid-cols-2 gap-2 text-sm">
        <p className="min-w-0 text-zinc-400"><span className="block text-xs uppercase tracking-wide text-zinc-500">Precio unitario</span>{money.format(product.wholesalePrice)}</p>
        <p className="min-w-0 text-right font-semibold text-white"><span className="block text-xs font-normal uppercase tracking-wide text-zinc-500">Subtotal</span>{money.format(product.wholesalePrice * quantity)}</p>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="mr-auto text-xs font-semibold uppercase tracking-wide text-zinc-400">Cantidad</span>
      <button type="button" aria-label={`Disminuir cantidad de ${product.name}`} disabled={busy || quantity <= 1} onClick={() => adjustQuantity(-1)} className="min-h-11 min-w-11 rounded-lg border border-white/20 text-lg font-bold text-white focus-visible:outline-2 focus-visible:outline-[var(--red)] disabled:opacity-40">−</button>
      <input
        id={inputId}
        aria-label={`Cantidad de ${product.name}`}
        aria-invalid={invalid}
        aria-describedby={invalid ? hintId : undefined}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        value={draft}
        disabled={busy}
        onChange={event => setEdit({ quantity, draft: event.target.value, invalid: false })}
        onBlur={commitDraft}
        onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
        }}
        className="min-h-11 w-16 rounded-lg border border-white/20 bg-[var(--background)] px-2 text-center text-base font-bold text-white focus-visible:outline-2 focus-visible:outline-[var(--red)]"
      />
      <button type="button" aria-label={`Aumentar cantidad de ${product.name}`} disabled={busy || quantity >= 100} onClick={() => adjustQuantity(1)} className="min-h-11 min-w-11 rounded-lg border border-white/20 text-lg font-bold text-white focus-visible:outline-2 focus-visible:outline-[var(--red)] disabled:opacity-40">+</button>
      <button type="button" disabled={busy} onClick={() => onQuantityChange(product.id, 0)} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-[var(--red)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-[var(--red)] disabled:opacity-50">Eliminar</button>
    </div>
    {invalid && <p id={hintId} role="status" className="mt-2 text-xs text-amber-200">Ingresá un entero de 1 a 100. Se restauró la cantidad anterior.</p>}
  </li>;
}

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
  const { totalUnits, indicativeTotal } = getWholesaleSelectionTotals(selection);

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
    className="fixed inset-y-0 right-0 m-0 h-dvh max-h-none w-full max-w-lg overflow-y-auto border-0 bg-[var(--background)] p-0 text-white shadow-2xl backdrop:bg-black/75"
  >
    <section className="flex min-h-full flex-col px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-5 sm:px-6">
      <header className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--red)]">Solicitud actual</p>
          <h2 id="wholesale-cart-title" className="mt-1 text-2xl font-black">Tu carrito</h2>
          <p className="mt-1 text-sm text-zinc-400">{totalUnits} {totalUnits === 1 ? "unidad" : "unidades"} · {items.length} {items.length === 1 ? "producto" : "productos"}</p>
        </div>
        <button type="button" onClick={onClose} className="min-h-11 shrink-0 rounded-full border border-white/20 px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-[var(--red)]">Cerrar</button>
      </header>

      {message && <p role="status" className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-950/30 p-4 text-sm leading-6 text-emerald-100">{message}</p>}

      {items.length ? <>
        <ul className="mt-4 space-y-3">
          {items.map(({ product, quantity }) => <WholesaleCartItem key={product.id} product={product} quantity={quantity} busy={busy} onQuantityChange={onQuantityChange} />)}
        </ul>
        <p className="mt-3 text-right text-lg font-bold">Total orientativo: {money.format(indicativeTotal)}</p>
        <p className="mt-2 text-sm leading-6 text-zinc-400">Enviar crea una solicitud para revisión. DCL debe verificar disponibilidad y confirmar las condiciones antes de que exista una compra confirmada.</p>
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-950/50 p-3 text-sm text-red-200">{error}</p>}
        <button type="button" disabled={busy} onClick={onSubmit} className="mt-4 min-h-12 w-full rounded-full bg-[var(--red)] px-5 text-sm font-bold text-[var(--background)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--red)] disabled:opacity-50">{busy ? "Enviando solicitud…" : "Enviar solicitud"}</button>
      </> : <p className="py-8 text-sm leading-6 text-zinc-300">Todavía no agregaste productos. Buscá por producto, conector, categoría o vehículo para empezar.</p>}
    </section>
  </dialog>;
}
