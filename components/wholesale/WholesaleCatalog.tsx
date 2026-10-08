"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { VehicleFinder } from "@/components/public/VehicleFinder";
import { WholesaleProductCard } from "@/components/wholesale/WholesaleProductCard";
import { findWholesaleVehicleMatches, filterWholesaleCatalogProducts, productFromWholesaleItem, uniqueWholesaleCatalogProducts } from "@/lib/wholesale-catalog-search";
import type { WholesaleVehicleMatch } from "@/lib/wholesale-catalog-search";
import { getPublicVehicleTypes, searchPublicVehicleCompatibilities } from "@/lib/supabase/vehicle-compatibility";
import { addWholesaleProduct, setWholesaleQuantity } from "@/lib/wholesale-order-selection";
import type { PendingWholesaleRequest, WholesaleOrderSelection } from "@/lib/wholesale-order-selection";
import type { WholesaleCatalogItem } from "@/lib/wholesale-server";

export function WholesaleCatalog() {
  const router = useRouter();
  const [products, setProducts] = useState<WholesaleCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [vehicleResults, setVehicleResults] = useState<WholesaleVehicleMatch[] | null>(null);
  const [vehicleLoading, setVehicleLoading] = useState(false);
  const [vehicleError, setVehicleError] = useState("");
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [selection, setSelection] = useState<WholesaleOrderSelection>({});
  const selectionRef = useRef<WholesaleOrderSelection>({});
  const [orderMessage, setOrderMessage] = useState("");
  const [orderError, setOrderError] = useState("");
  const pendingRequest = useRef<PendingWholesaleRequest>(null);
  const submissionInFlight = useRef(false);

  const uniqueProducts = useMemo(() => uniqueWholesaleCatalogProducts(products), [products]);
  const visibleProducts = useMemo(() => filterWholesaleCatalogProducts(uniqueProducts, query, category), [uniqueProducts, query, category]);
  const categories = useMemo(() => [...new Set(uniqueProducts.map(product => product.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")), [uniqueProducts]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/wholesale/catalog", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (response.status === 401) { router.replace("/mayoristas/ingresar"); return; }
        if (!body.ok) throw new Error(body.error || "No se pudo cargar el catálogo.");
        setProducts(body.data || []);
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No se pudo cargar el catálogo."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [router]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setVehicleResults(null);
    setVehicleError("");
    if (!query.trim() || visibleProducts.length) return;

    setVehicleLoading(true);
    try {
      const types = await getPublicVehicleTypes();
      if (!types) throw new Error("No se pudieron consultar las compatibilidades.");
      const compatibilityLists = await Promise.all(types.map(type => searchPublicVehicleCompatibilities(type)));
      if (compatibilityLists.some(rows => rows === null)) throw new Error("No se pudieron consultar las compatibilidades.");
      const compatibilities = compatibilityLists.flatMap(rows => rows || []);
      setVehicleResults(findWholesaleVehicleMatches(query, uniqueProducts, compatibilities));
    } catch {
      setVehicleResults(null);
      setVehicleError("No pudimos consultar las compatibilidades. Intentá nuevamente.");
    } finally {
      setVehicleLoading(false);
    }
  }

  function clearSearch() {
    setQuery("");
    setCategory("");
    setVehicleResults(null);
    setVehicleError("");
  }

  async function logout() {
    setBusy(true);
    try {
      const response = await fetch("/api/wholesale/session/logout", { method: "POST" });
      if (!response.ok) { setError("No se pudo cerrar la sesión. Intentá nuevamente."); return; }
      router.replace("/mayoristas/ingresar"); router.refresh();
    } catch {
      setError("No se pudo cerrar la sesión. Intentá nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  const resultProducts = uniqueWholesaleCatalogProducts(visibleProducts.length ? visibleProducts : (vehicleResults || []).map(result => result.product));
  const hasActiveSearch = Boolean(query.trim() || category || vehicleResults !== null);
  const displayedProducts = hasActiveSearch || showAllProducts ? resultProducts : resultProducts.slice(0, 6);
  const compatibilityById = new Map((vehicleResults || []).map(result => [result.product.id, result.fitments.join(" · ")]));
  const selectedItems = Object.values(selection);
  const indicativeTotal = selectedItems.reduce((sum, item) => sum + item.product.wholesalePrice * item.quantity, 0);
  const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

  function addProduct(product: WholesaleCatalogItem) {
    if (submissionInFlight.current) return;
    const result = addWholesaleProduct(selectionRef.current, pendingRequest.current, product);
    if (!result.changed) return;
    selectionRef.current = result.selection;
    pendingRequest.current = result.pending;
    setOrderError(""); setOrderMessage(""); setSelection(result.selection);
  }

  function updateQuantity(productId: string, quantity: number) {
    if (submissionInFlight.current) return;
    const result = setWholesaleQuantity(selectionRef.current, pendingRequest.current, productId, quantity);
    if (!result.changed) return;
    selectionRef.current = result.selection;
    pendingRequest.current = result.pending;
    setOrderError(""); setOrderMessage(""); setSelection(result.selection);
  }

  async function submitOrder() {
    if (submissionInFlight.current || !selectedItems.length) return;
    submissionInFlight.current = true;
    setBusy(true); setOrderError(""); setOrderMessage("");
    const operation = pendingRequest.current || {
      key: crypto.randomUUID(),
      items: selectedItems.map(({ product, quantity }) => ({ productId: product.id, quantity })),
    };
    pendingRequest.current = operation;
    try {
      const response = await fetch("/api/wholesale/orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: operation.key, items: operation.items }),
      });
      const body = await response.json();
      if (response.status === 401) { router.replace("/mayoristas/ingresar"); return; }
      if (!response.ok || !body.ok) throw new Error(body.error || "No se pudo enviar la solicitud. Intentá nuevamente.");
      pendingRequest.current = null;
      selectionRef.current = {};
      setSelection({});
      setOrderMessage(`Solicitud ${body.orderNumber || "creada"}. DCL debe verificar disponibilidad y confirmar las condiciones antes de que exista una compra confirmada.`);
    } catch (cause) {
      setOrderError(cause instanceof Error ? cause.message : "No se pudo enviar la solicitud. Intentá nuevamente.");
    } finally { submissionInFlight.current = false; setBusy(false); }
  }

  return <main className="mx-auto min-h-[70vh] max-w-7xl px-4 py-7 text-white sm:px-6 sm:py-10 lg:px-8">
    <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:mb-8 sm:flex-row sm:items-center">
      <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.25em] text-red-300">DCL CREE LED</p><h1 className="mt-2 text-2xl font-black uppercase tracking-tight sm:text-4xl">Catálogo mayorista</h1><p className="mt-2 text-sm text-zinc-400">Precios exclusivos para clientes mayoristas.</p></div>
      <button type="button" disabled={busy} onClick={() => void logout()} className="min-h-11 shrink-0 rounded-full border border-white/20 px-4 text-sm font-semibold disabled:opacity-50">{busy ? "Saliendo…" : "Cerrar sesión"}</button>
    </div>

    <form onSubmit={event => void search(event)} className="mb-4 rounded-2xl border border-white/10 bg-zinc-950 p-3 sm:p-4">
      <label htmlFor="wholesale-search" className="sr-only">Buscar producto, conector o vehículo</label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input id="wholesale-search" type="search" value={query} onChange={event => { setQuery(event.target.value.slice(0, 120)); setVehicleResults(null); setVehicleError(""); }} placeholder="Buscá producto, conector o vehículo…" maxLength={120} className="min-h-12 min-w-0 flex-1 rounded-xl border border-white/15 bg-black px-4 text-base text-white placeholder:text-zinc-500 focus-visible:outline-2 focus-visible:outline-red-400" />
        <button type="submit" disabled={loading || vehicleLoading} className="min-h-12 rounded-full bg-red-600 px-6 text-sm font-bold text-white disabled:opacity-50">{vehicleLoading ? "Buscando…" : "Buscar"}</button>
      </div>
      {query && <button type="button" onClick={clearSearch} className="mt-3 min-h-11 px-2 text-sm text-red-300 underline">Limpiar búsqueda y filtros</button>}
    </form>

    {categories.length > 1 && <details className="mb-5 rounded-xl border border-white/10 px-4">
      <summary className="min-h-12 cursor-pointer py-3 text-sm font-semibold text-red-300">Filtrar por categoría</summary>
      <label htmlFor="wholesale-category" className="block pb-4 text-sm text-zinc-300">Categoría
        <select id="wholesale-category" value={category} onChange={event => { setCategory(event.target.value); setVehicleResults(null); }} className="mt-2 min-h-12 w-full rounded-xl border border-white/15 bg-zinc-950 px-3 text-base text-white sm:max-w-sm">
          <option value="">Todas las categorías</option>
          {categories.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
    </details>}

    <details className="mb-6 rounded-xl border border-white/10 px-4">
      <summary className="min-h-12 cursor-pointer py-3 text-sm font-semibold text-red-300">Buscar por vehículo</summary>
      <div className="pb-4 pt-2">
        <p className="mb-4 text-sm text-zinc-400">Elegí tipo, marca, modelo, año y posición para ver productos mayoristas compatibles.</p>
        <VehicleFinder products={uniqueProducts.map(productFromWholesaleItem)} wholesaleMode onWholesaleAdd={productId => {
          const product = uniqueProducts.find(item => item.id === productId);
          if (product) addProduct(product);
        }} />
      </div>
    </details>

    {loading && <p role="status" className="py-5 text-sm text-zinc-400">Cargando catálogo…</p>}
    {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-200">{error}</p>}
    {!loading && !error && vehicleLoading && <p role="status" className="py-5 text-sm text-zinc-400">Buscando compatibilidades…</p>}
    {!loading && !error && vehicleError && <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-sm text-amber-200">{vehicleError}</p>}
    {!loading && !error && !vehicleLoading && <>
      <div className="mb-4" aria-live="polite">
        <p className="text-sm text-zinc-400">{hasActiveSearch ? resultProducts.length : displayedProducts.length} producto(s){query ? ` para “${query}”` : " disponibles"}</p>
        {vehicleResults?.length ? <p className="mt-1 text-xs text-emerald-200">Compatibilidad encontrada en la base de vehículos.</p> : null}
      </div>
      {resultProducts.length > 0 ? <>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{displayedProducts.map(product => <WholesaleProductCard key={product.id} product={product} compatibility={compatibilityById.get(product.id)} onAdd={addProduct} selected={Boolean(selection[product.id])} />)}</div>
        {!hasActiveSearch && resultProducts.length > 6 && <div className="mt-6 flex justify-center">
          <button type="button" onClick={() => setShowAllProducts(value => !value)} className="min-h-12 rounded-full border border-white/20 px-6 text-sm font-semibold text-red-200 transition hover:border-red-400 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-red-400">
            {showAllProducts ? "Mostrar menos productos" : "Mostrar todos los productos"}
          </button>
        </div>}
      </>
        : <div className="rounded-2xl border border-white/10 p-5 text-sm leading-6 text-zinc-300">
          <p>{uniqueProducts.length === 0 ? "Por el momento no hay productos con precio mayorista disponible." : query ? "No encontramos productos ni compatibilidades para esta búsqueda." : "No hay productos para mostrar con estos filtros."}</p>
          {query && <p className="mt-2 text-zinc-400">Probá con el conector, el nombre del producto o una marca y modelo de vehículo.</p>}
        </div>}
    </>}
    {selectedItems.length > 0 && <section aria-label="Solicitud de pedido" className="mt-8 rounded-2xl border border-red-400/40 bg-zinc-950 p-4 sm:p-6">
      <h2 className="text-xl font-black">Tu solicitud</h2>
      <ul className="mt-4 divide-y divide-white/10">{selectedItems.map(({ product, quantity }) => <li key={product.id} className="flex flex-wrap items-center gap-3 py-3">
        <span className="min-w-0 flex-1 font-semibold">{product.name}<span className="block text-sm text-zinc-400">Subtotal orientativo: {money.format(product.wholesalePrice * quantity)}</span></span>
        <label className="text-sm text-zinc-300">Cantidad <input aria-label={`Cantidad de ${product.name}`} type="number" min={1} max={100} value={quantity} disabled={busy} onChange={event => updateQuantity(product.id, Math.min(100, Math.max(1, Number(event.target.value) || 1)))} className="ml-2 min-h-11 w-20 rounded-lg border border-white/20 bg-black px-2 text-white" /></label>
        <button type="button" disabled={busy} onClick={() => updateQuantity(product.id, 0)} className="min-h-11 px-3 text-sm text-red-300 underline">Quitar</button>
      </li>)}</ul>
      <p className="mt-3 text-right text-lg font-bold">Total orientativo: {money.format(indicativeTotal)}</p>
      <p className="mt-2 text-sm leading-6 text-zinc-400">Enviar crea una solicitud para revisión. DCL debe verificar disponibilidad y confirmar las condiciones antes de que exista una compra confirmada.</p>
      {orderError && <p role="alert" className="mt-3 rounded-lg bg-red-950/50 p-3 text-sm text-red-200">{orderError}</p>}
      <button type="button" disabled={busy} onClick={() => void submitOrder()} className="mt-4 min-h-12 w-full rounded-full bg-red-600 px-5 text-sm font-bold disabled:opacity-50 sm:w-auto">{busy ? "Enviando solicitud…" : "Enviar solicitud"}</button>
    </section>}
    {orderMessage && <p role="status" className="mt-5 rounded-xl border border-emerald-400/30 bg-emerald-950/30 p-4 text-sm leading-6 text-emerald-100">{orderMessage}</p>}
  </main>;
}
