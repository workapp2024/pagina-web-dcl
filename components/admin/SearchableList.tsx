"use client";

import { useId, useState, type ReactNode } from "react";

export function matchesAdminSearch(query: string, values: unknown[]) {
  const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  const text = values.map(normalize).join(" ");
  return normalize(query).trim().split(/\s+/).every(term => text.includes(term));
}

/** Presentation only: filtering never changes the underlying records. */
export function SearchableList<T>({ rows, searchText, children, label, placeholder, stock, loading, query: controlledQuery, onQueryChange, filters, hint, movement }: {
  rows: T[]; searchText: (row: T) => unknown[]; children: (rows: T[]) => ReactNode;
  label: string; placeholder: string; stock?: (row: T) => number; loading?: boolean;
  query?: string; onQueryChange?: (query: string) => void; filters?: ReactNode; hint?: string;
  movement?: { date: (row: T) => string; type: (row: T) => string; labels: Record<string, string> };
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [localQuery, setLocalQuery] = useState("");
  const [includeZero, setIncludeZero] = useState(false);
  const [page, setPage] = useState(1);
  const [movementType, setMovementType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = controlledQuery ?? localQuery;
  const searching = Boolean(query.trim());
  const visible = expanded || searching;
  const filtered = visible ? rows.filter(row => matchesAdminSearch(query, searchText(row)) && (!stock || searching || includeZero || stock(row) > 0) && (!movement || (
    (!movementType || movement.type(row) === movementType)
    && (!from || new Date(movement.date(row)) >= new Date(`${from}T00:00:00`))
    && (!to || new Date(movement.date(row)) <= new Date(`${to}T23:59:59.999`))
  ))) : [];
  const totalPages = Math.max(1, Math.ceil(filtered.length / 25));
  const currentPage = Math.min(page, totalPages);
  return <section className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1 text-sm text-zinc-300">Buscar {label.toLocaleLowerCase("es")}<input type="search" value={query} placeholder={placeholder} onChange={event => { (onQueryChange ?? setLocalQuery)(event.target.value); setPage(1); }} className="mt-2 min-h-11 w-full rounded-xl border border-white/15 bg-zinc-950 px-3 text-base" /></label>
      <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => { setExpanded(value => !value); setPage(1); }} className="min-h-11 rounded-xl border border-white/15 px-4 text-sm font-semibold">{expanded ? `Ocultar ${label.toLocaleLowerCase("es")}` : label === "Movimientos" ? "Ver movimientos" : label === "Historial" ? "Ver historial" : label === "Compatibilidades" ? "Ver compatibilidades" : `Ver todos los ${label.toLocaleLowerCase("es")}`}</button>
    </div>
    {stock && <label className="flex min-h-11 items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={includeZero} onChange={event => { setIncludeZero(event.target.checked); setPage(1); }} />Incluir productos con stock cero</label>}
    {filters}
    {movement && visible && <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-sm text-zinc-400">Tipo<select value={movementType} onChange={event => { setMovementType(event.target.value); setPage(1); }} className="mt-1 min-h-11 w-full rounded-xl bg-zinc-900 px-3"><option value="">Todos los tipos</option>{Object.entries(movement.labels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
      <label className="text-sm text-zinc-400">Desde<input type="date" value={from} onChange={event => { setFrom(event.target.value); setPage(1); }} className="mt-1 min-h-11 w-full rounded-xl bg-zinc-900 px-3" /></label>
      <label className="text-sm text-zinc-400">Hasta<input type="date" value={to} onChange={event => { setTo(event.target.value); setPage(1); }} className="mt-1 min-h-11 w-full rounded-xl bg-zinc-900 px-3" /></label>
    </div>}
    <div id={id}>
      {!visible ? <p className="text-sm text-zinc-500">Buscá para ver coincidencias o desplegá el listado.</p> : loading ? <p role="status" className="text-sm text-zinc-400">Consultando…</p> : <>
        {hint && <p className="mb-3 text-xs text-zinc-400">{hint}</p>}
        {!filtered.length ? <p role="status" className="text-sm text-zinc-400">No se encontraron coincidencias.</p> : children(filtered.slice((currentPage - 1) * 25, currentPage * 25))}
        {filtered.length > 25 && <nav aria-label={`Páginas de ${label.toLocaleLowerCase("es")}`} className="mt-4 flex flex-wrap items-center justify-end gap-3 text-sm"><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="min-h-11 px-3 disabled:opacity-40">Anterior</button><span>{currentPage} / {totalPages} · {filtered.length} resultados</span><button type="button" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)} className="min-h-11 px-3 disabled:opacity-40">Siguiente</button></nav>}
      </>}
    </div>
  </section>;
}
