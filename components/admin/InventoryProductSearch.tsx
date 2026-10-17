"use client";

import { useId, useState } from "react";
import { matchesAdminSearch } from "@/components/admin/SearchableList";

export type InventorySearchProduct = { id: string; name: string; stock: number; connectorType?: string | null };

export function InventoryProductSearch({ products, value, onChange, disabled }: {
  products: InventorySearchProduct[]; value: string; onChange: (id: string) => void; disabled?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const selected = products.find(product => product.id === value);
  const matches = query.trim() ? products.filter(product => matchesAdminSearch(query, [product.name, product.id, product.connectorType])) : [];
  return <div className="min-w-0 space-y-2">
    <label htmlFor={id} className="block text-sm text-zinc-300">Buscar producto</label>
    <input id={id} type="search" disabled={disabled} value={query} onChange={event => { setQuery(event.target.value); onChange(""); }} placeholder="Nombre, marca, código o ficha (H4, H7…)" className="min-h-11 w-full rounded-xl border border-white/10 bg-zinc-900 px-3 text-base" />
    <div aria-live="polite">
      {selected && <p className="rounded-xl border border-emerald-400/30 p-3 text-sm"><b>{selected.name}</b><span className="block break-all text-xs text-zinc-400">Código: {selected.id} · Stock del sector: {selected.stock}</span></p>}
      {query.trim() && !selected && <><ul className="max-h-64 overflow-y-auto divide-y divide-white/10">{matches.slice(0, 20).map(product => <li key={product.id}><button type="button" onClick={() => { onChange(product.id); setQuery(""); }} className="min-h-11 w-full rounded-xl p-3 text-left hover:bg-white/5"><b className="break-words text-sm">{product.name}</b><span className="block break-all text-xs text-zinc-400">Código: {product.id}{product.connectorType && ` · ${product.connectorType}`} · Stock del sector: {product.stock}</span></button></li>)}</ul><p className="text-xs text-zinc-400">{matches.length > 20 ? "Afiná la búsqueda para ver más coincidencias." : matches.length ? "Seleccioná el producto correcto para continuar." : "No hay coincidencias."}</p></>}
    </div>
  </div>;
}
