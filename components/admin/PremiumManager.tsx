"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ManagedImage } from "@/components/ui/ManagedImage";
import { MAX_PREMIUM_PRODUCTS, movePremiumProduct, readPremiumResponse, validatePremiumSelection, type PremiumOption, type PremiumSelection } from "@/lib/premium";

const money = (value: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(value);
const button = "min-h-11 rounded-xl border border-white/15 px-3 text-sm font-bold disabled:opacity-40";

async function fetchPremiumSnapshot(signal?: AbortSignal) {
  const response = await fetch("/api/admin/premium", { cache: "no-store", signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || "No se pudo cargar Premium.");
  return readPremiumResponse(body);
}

function ProductSummary({ product }: { product: PremiumOption }) {
  return <div className="flex min-w-0 items-center gap-3">
    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-black p-2"><ManagedImage source={product.image} alt={product.name} className="max-h-full object-contain" loading="lazy" /></div>
    <div className="min-w-0"><p className="break-words font-bold">{product.name}</p><p className="text-sm text-zinc-400">{money(product.price)}</p>{(!product.active || !product.showInCatalog) && <p className="text-sm text-amber-300">Oculto en la web</p>}</div>
  </div>;
}

export function PremiumManager() {
  const [saved, setSaved] = useState<PremiumSelection | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [products, setProducts] = useState<PremiumOption[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const inFlight = useRef(false);
  const dirty = saved !== null && JSON.stringify(ids) !== JSON.stringify(saved.productIds);

  const receive = useCallback((data: Awaited<ReturnType<typeof fetchPremiumSnapshot>>) => {
    setSaved(data.selection); setIds(data.selection.productIds); setProducts(data.products); setConflict(false); setError(""); setMessage("");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchPremiumSnapshot(controller.signal)
      .then(data => { if (!controller.signal.aborted) receive(data); })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "No se pudo cargar Premium."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [receive]);

  async function reload() {
    if (dirty && !window.confirm("¿Descartar los cambios locales y cargar la selección guardada?")) return;
    setBusy(true); setError(""); setMessage("");
    try { receive(await fetchPremiumSnapshot()); }
    catch (error) { setError(error instanceof Error ? error.message : "No se pudo cargar Premium."); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!saved || inFlight.current || busy || conflict) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/premium", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productIds: ids, revision: saved.revision }) });
      const body = await response.json();
      if (!response.ok) { if (response.status === 409) setConflict(true); throw new Error(body.message || "No se pudo guardar Premium."); }
      const selection = validatePremiumSelection(body.selection);
      setSaved(selection); setIds(selection.productIds);
      setMessage("Selección guardada. La Home se actualizará en aproximadamente un minuto.");
    } catch (error) { setError(error instanceof Error ? error.message : "No se pudo guardar Premium."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  const byId = new Map(products.map(product => [product.id, product]));
  const available = products.filter(product => product.active && product.showInCatalog && !ids.includes(product.id) && product.name.toLocaleLowerCase("es").includes(query.trim().toLocaleLowerCase("es")));
  return <section aria-labelledby="premium-admin-title" className="mt-8 rounded-3xl border border-white/10 bg-zinc-950/80 p-5 sm:p-6">
    <h2 id="premium-admin-title" className="text-2xl font-black">Productos Premium</h2>
    <p className="mt-2 text-sm text-zinc-400">Elegí productos del catálogo y ordenalos para la Home. Sus imágenes y precios se mantienen actualizados desde Productos.</p>
    {error && <p role="alert" className="mt-4 rounded-xl border border-amber-400/30 p-3 text-sm text-amber-200">{error}</p>}
    <p role="status" className="mt-3 text-sm text-zinc-400">{busy ? "Cargando o guardando Premium…" : message || (dirty ? "Tenés cambios sin guardar." : "")}</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <button type="button" disabled={busy} className={button} onClick={() => void reload()}>Recargar selección</button>
      <button type="button" disabled={busy || !dirty || conflict} className={`${button} bg-red-600 text-white`} onClick={() => void save()}>Guardar selección</button>
    </div>
    {saved && <fieldset disabled={busy || conflict} className="mt-6 grid min-w-0 gap-8 lg:grid-cols-2">
      <div className="min-w-0"><h3 className="text-lg font-bold">Seleccionados · {ids.length}/{MAX_PREMIUM_PRODUCTS}</h3>
        {!ids.length && <p className="mt-4 rounded-xl border border-dashed border-white/15 p-5 text-sm text-zinc-400">Sin productos seleccionados. La sección Premium no se mostrará en la Home.</p>}
        <ol className="mt-4 space-y-3">{ids.map((id, index) => {
          const product = byId.get(id);
          return <li key={id} className="rounded-2xl border border-white/10 p-3">
            {product ? <ProductSummary product={product} /> : <p className="text-sm text-amber-300">Producto eliminado. Quitalo de la selección para guardar.</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2"><span className="mr-auto text-sm text-zinc-400">Posición {index + 1}</span>
              <button type="button" className={button} disabled={index === 0} aria-label={`Subir ${product?.name || "producto eliminado"}`} onClick={() => setIds(previous => movePremiumProduct(previous, index, -1))}>↑ Subir</button>
              <button type="button" className={button} disabled={index === ids.length - 1} aria-label={`Bajar ${product?.name || "producto eliminado"}`} onClick={() => setIds(previous => movePremiumProduct(previous, index, 1))}>↓ Bajar</button>
              <button type="button" className={button} aria-label={`Quitar ${product?.name || "producto eliminado"}`} onClick={() => setIds(previous => previous.filter(value => value !== id))}>Quitar</button>
            </div>
          </li>;
        })}</ol>
      </div>
      <div className="min-w-0"><h3 className="text-lg font-bold">Agregar del catálogo</h3>
        <label className="mt-4 block text-sm">Buscar por nombre<input type="search" value={query} onChange={event => setQuery(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-white/15 bg-zinc-900 px-3 text-base" /></label>
        <p className="mt-2 text-sm text-zinc-400">Solo productos activos y visibles. {available.length} disponibles para agregar.</p>
        <ul className="mt-4 max-h-[36rem] space-y-3 overflow-y-auto">{available.map(product => <li key={product.id} className="rounded-2xl border border-white/10 p-3"><ProductSummary product={product} /><button type="button" disabled={ids.length >= MAX_PREMIUM_PRODUCTS} className={`${button} mt-3 w-full`} onClick={() => setIds(previous => previous.includes(product.id) || previous.length >= MAX_PREMIUM_PRODUCTS ? previous : [...previous, product.id])}>Agregar {product.name}</button></li>)}</ul>
        {ids.length >= MAX_PREMIUM_PRODUCTS && <p className="mt-3 text-sm text-amber-300">Alcanzaste el límite de {MAX_PREMIUM_PRODUCTS} productos.</p>}
      </div>
    </fieldset>}
  </section>;
}
