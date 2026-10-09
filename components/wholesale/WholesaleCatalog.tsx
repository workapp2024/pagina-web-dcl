"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { VehicleFinder } from "@/components/public/VehicleFinder";
import { WholesaleCartDrawer } from "@/components/wholesale/WholesaleCartDrawer";
import { WholesaleProductCard } from "@/components/wholesale/WholesaleProductCard";
import { findWholesaleVehicleMatches, filterWholesaleCatalogProducts, getWholesaleCatalogView, productFromWholesaleItem, uniqueWholesaleCatalogProducts } from "@/lib/wholesale-catalog-search";
import type { WholesaleVehicleMatch } from "@/lib/wholesale-catalog-search";
import { getPublicVehicleTypes, searchPublicVehicleCompatibilities } from "@/lib/supabase/vehicle-compatibility";
import { addWholesaleProduct, persistWholesaleSelection, restoreWholesaleSelection, restoreWholesaleSelectionFromStorage, serializeWholesaleSelection, setWholesaleQuantity, WHOLESALE_SELECTION_STORAGE_KEY } from "@/lib/wholesale-order-selection";
import type { WholesaleOrderAttempt, WholesaleOrderSelection } from "@/lib/wholesale-order-selection";
import type { WholesaleCatalogItem } from "@/lib/wholesale-server";

export function WholesaleCatalog() {
  const router = useRouter();
  const [products, setProducts] = useState<WholesaleCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [category, setCategory] = useState("");
  const [vehicleResults, setVehicleResults] = useState<WholesaleVehicleMatch[] | null>(null);
  const [vehicleLoading, setVehicleLoading] = useState(false);
  const [vehicleError, setVehicleError] = useState("");
  const [selection, setSelection] = useState<WholesaleOrderSelection>({});
  const selectionRef = useRef<WholesaleOrderSelection>({});
  const [attempts, setAttempts] = useState<WholesaleOrderAttempt[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(true);
  const [attemptsError, setAttemptsError] = useState("");
  const [orders, setOrders] = useState<Array<{ id: string; order_number: string; status: string; created_at: string; confirmed_at: string | null; total_amount: number; currency: string; items: Array<{ productId: string; name: string; quantity: number; unitPrice: number; lineTotal: number; currency: string }> }>>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [orderMessage, setOrderMessage] = useState("");
  const [orderError, setOrderError] = useState("");
  const submissionInFlight = useRef(false);
  const selectionVersionRef = useRef(0);
  const catalogRequestRef = useRef(0);
  const attemptsRequestRef = useRef(0);
  const ordersRequestRef = useRef(0);

  const uniqueProducts = useMemo(() => uniqueWholesaleCatalogProducts(products), [products]);
  const categories = useMemo(() => [...new Set(uniqueProducts.map(product => product.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")), [uniqueProducts]);
  const catalogView = useMemo(() => getWholesaleCatalogView(uniqueProducts, appliedQuery, category, vehicleResults), [uniqueProducts, appliedQuery, category, vehicleResults]);

  const refreshAttempts = useCallback(async (signal?: AbortSignal) => {
    if (signal?.aborted) return;
    const requestId = ++attemptsRequestRef.current;
    setAttemptsLoading(true); setAttemptsError("");
    try {
      const response = await fetch("/api/wholesale/orders/attempts", { cache: "no-store", signal });
      if (response.status === 401) { router.replace("/mayoristas/ingresar"); return; }
      const body = await response.json();
      if (!response.ok || !body.ok || !Array.isArray(body.data)) throw new Error(body.error || "No se pudieron cargar los intentos recuperables.");
      if (requestId === attemptsRequestRef.current) setAttempts(body.data as WholesaleOrderAttempt[]);
    } catch (cause) {
      if (!signal?.aborted && requestId === attemptsRequestRef.current) setAttemptsError(cause instanceof Error ? cause.message : "No se pudieron cargar los intentos recuperables.");
    } finally { if (!signal?.aborted && requestId === attemptsRequestRef.current) setAttemptsLoading(false); }
  }, [router]);

  const refreshOrders = useCallback(async (signal?: AbortSignal) => {
    if (signal?.aborted) return;
    const requestId = ++ordersRequestRef.current;
    setOrdersLoading(true); setOrdersError("");
    try {
      const response = await fetch("/api/wholesale/orders?limit=25", { cache: "no-store", signal });
      if (response.status === 401) { router.replace("/mayoristas/ingresar"); return; }
      const body = await response.json();
      if (!response.ok || !body.ok || !Array.isArray(body.data)) throw new Error(body.error || "No se pudo cargar el historial.");
      if (requestId === ordersRequestRef.current) setOrders(body.data);
    } catch (cause) {
      if (!signal?.aborted && requestId === ordersRequestRef.current) setOrdersError(cause instanceof Error ? cause.message : "No se pudo cargar el historial.");
    } finally { if (!signal?.aborted && requestId === ordersRequestRef.current) setOrdersLoading(false); }
  }, [router]);

  useEffect(() => {
    const controller = new AbortController();
    const selectionVersion = selectionVersionRef.current;
    const requestId = ++catalogRequestRef.current;
    void fetch("/api/wholesale/catalog", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (controller.signal.aborted || requestId !== catalogRequestRef.current) return;
        if (response.status === 401) { router.replace("/mayoristas/ingresar"); return; }
        if (!body.ok) throw new Error(body.error || "No se pudo cargar el catálogo.");
        const catalog = Array.isArray(body.data) ? body.data as WholesaleCatalogItem[] : [];
        const restored = selectionVersion === selectionVersionRef.current
          ? restoreWholesaleSelectionFromStorage(window.localStorage, catalog)
          : restoreWholesaleSelection(serializeWholesaleSelection(selectionRef.current), catalog);
        selectionRef.current = restored;
        setSelection(restored);
        try { persistWholesaleSelection(window.localStorage, restored); } catch { /* Keep the catalog usable when storage is unavailable. */ }
        setProducts(catalog);
        setCatalogLoaded(true);
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No se pudo cargar el catálogo."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [catalogRetry, router]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => refreshAttempts(controller.signal));
    return () => controller.abort();
  }, [refreshAttempts]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => refreshOrders(controller.signal));
    return () => controller.abort();
  }, [refreshOrders]);

  useEffect(() => {
    function syncSelection(event: StorageEvent) {
      if (event.key !== WHOLESALE_SELECTION_STORAGE_KEY) return;
      if (!uniqueProducts.length) return;
      const restored = restoreWholesaleSelection(event.newValue, uniqueProducts);
      selectionVersionRef.current += 1;
      selectionRef.current = restored;
      setSelection(restored);
    }
    window.addEventListener("storage", syncSelection);
    return () => window.removeEventListener("storage", syncSelection);
  }, [uniqueProducts]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setVehicleResults(null);
    setVehicleError("");
    const nextQuery = query.trim();
    setAppliedQuery(nextQuery);
    if (!nextQuery || filterWholesaleCatalogProducts(uniqueProducts, nextQuery, category).length) return;

    setVehicleLoading(true);
    try {
      const types = await getPublicVehicleTypes();
      if (!types) throw new Error("No se pudieron consultar las compatibilidades.");
      const compatibilityLists = await Promise.all(types.map(type => searchPublicVehicleCompatibilities(type)));
      if (compatibilityLists.some(rows => rows === null)) throw new Error("No se pudieron consultar las compatibilidades.");
      const compatibilities = compatibilityLists.flatMap(rows => rows || []);
      const matches = findWholesaleVehicleMatches(nextQuery, uniqueProducts, compatibilities);
      const categoryMatches = category
        ? new Set(filterWholesaleCatalogProducts(matches.map(result => result.product), "", category).map(product => product.id))
        : null;
      setVehicleResults(categoryMatches ? matches.filter(result => categoryMatches.has(result.product.id)) : matches);
    } catch {
      setVehicleResults(null);
      setVehicleError("No pudimos consultar las compatibilidades. Intentá nuevamente.");
    } finally {
      setVehicleLoading(false);
    }
  }

  function clearSearch() {
    setQuery("");
    setAppliedQuery("");
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

  const resultProducts = catalogView.products;
  const hasActiveSearch = catalogView.active;
  const compatibilityById = new Map((vehicleResults || []).map(result => [result.product.id, result.fitments.join(" · ")]));
  const totalUnits = Object.values(selection).reduce((sum, item) => sum + item.quantity, 0);

  function saveSelection(next: WholesaleOrderSelection) {
    selectionVersionRef.current += 1;
    selectionRef.current = next;
    setSelection(next);
    try { persistWholesaleSelection(window.localStorage, next); } catch { /* Selection changes remain available in memory. */ }
  }

  function clearSubmittedSelection(submitted: WholesaleOrderSelection) {
    try {
      const savedSelection = window.localStorage.getItem(WHOLESALE_SELECTION_STORAGE_KEY);
      if (savedSelection && savedSelection !== serializeWholesaleSelection(submitted)) {
        const latest = restoreWholesaleSelectionFromStorage(window.localStorage, uniqueProducts);
        selectionRef.current = latest;
        setSelection(latest);
        return;
      }
    } catch { /* If storage is unavailable, clear the submitted in-memory selection. */ }
    saveSelection({});
  }

  function addProduct(product: WholesaleCatalogItem) {
    if (submissionInFlight.current) return;
    const result = addWholesaleProduct(selectionRef.current, product);
    if (!result.changed) return;
    saveSelection(result.selection);
    setOrderError(""); setOrderMessage("");
  }

  function updateQuantity(productId: string, quantity: number) {
    if (submissionInFlight.current) return;
    const result = setWholesaleQuantity(selectionRef.current, productId, quantity);
    if (!result.changed) return;
    saveSelection(result.selection);
    setOrderError(""); setOrderMessage("");
  }

  async function postAttempt(attemptId: string) {
    const response = await fetch("/api/wholesale/orders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptId }),
    });
    const body = await response.json();
    if (response.status === 401) { router.replace("/mayoristas/ingresar"); return false; }
    if (!response.ok || !body.ok) throw new Error(body.error || "No se pudo enviar la solicitud. Intentá nuevamente.");
    return true;
  }

  async function retryAttempt(attemptId: string) {
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    setBusy(true); setOrderError(""); setOrderMessage("");
    try {
      if (!await postAttempt(attemptId)) return;
      setOrderMessage("Solicitud creada. El carrito actual se conservó por separado.");
      await Promise.all([refreshAttempts(), refreshOrders()]);
    } catch (cause) {
      setOrderError(cause instanceof Error ? cause.message : "No se pudo enviar la solicitud. Intentá nuevamente.");
      void refreshAttempts().catch(() => undefined);
    } finally { submissionInFlight.current = false; setBusy(false); }
  }

  async function submitOrder(newIntent = false) {
    const currentSelection = selectionRef.current;
    if (submissionInFlight.current || !Object.keys(currentSelection).length) return;
    submissionInFlight.current = true;
    setBusy(true); setOrderError(""); setOrderMessage("");
    const items = Object.values(currentSelection).map(({ product, quantity }) => ({ productId: product.id, quantity }));
    try {
      const attemptResponse = await fetch("/api/wholesale/orders/attempts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newIntent ? { items, newIntent: true } : { items }),
      });
      const attemptBody = await attemptResponse.json();
      if (attemptResponse.status === 401) { router.replace("/mayoristas/ingresar"); return; }
      if (!attemptResponse.ok || !attemptBody.ok) throw new Error(attemptBody.error || "No se pudo iniciar el intento.");
      const attemptId = attemptBody.data?.attemptId;
      if (typeof attemptId !== "string") throw new Error("No se pudo recuperar el intento del servidor.");
      if (attemptBody.data?.recovered === true) {
        setOrderMessage(`Esta selección ya corresponde a la solicitud ${attemptBody.data.orderId || "existente"}. No se creó otra solicitud. Revisá las solicitudes recuperables o el historial.`);
        setCartOpen(true);
        await Promise.all([refreshAttempts(), refreshOrders()]);
        return;
      }
      if (!await postAttempt(attemptId)) return;
      clearSubmittedSelection(currentSelection);
      setOrderMessage("Solicitud creada. DCL debe verificar disponibilidad y confirmar las condiciones antes de que exista una compra confirmada.");
      setCartOpen(true);
      await Promise.all([refreshAttempts(), refreshOrders()]);
    } catch (cause) {
      setOrderError(cause instanceof Error ? cause.message : "No se pudo enviar la solicitud. Intentá nuevamente.");
      void refreshAttempts().catch(() => undefined);
    } finally { submissionInFlight.current = false; setBusy(false); }
  }

  async function closeAttempt(attemptId: string) {
    setBusy(true); setOrderError("");
    try {
      const response = await fetch("/api/wholesale/orders/attempts/abandon", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attemptId }),
      });
      const body = await response.json();
      if (response.status === 401) { router.replace("/mayoristas/ingresar"); return; }
      if (!response.ok || !body.ok) throw new Error(body.error || "No se pudo cerrar el intento.");
      await refreshAttempts();
    } catch (cause) {
      setOrderError(cause instanceof Error ? cause.message : "No se pudo cerrar el intento.");
      await Promise.all([refreshAttempts(), refreshOrders()]).catch(() => undefined);
    } finally { setBusy(false); }
  }

  async function acknowledgeAttempt(attemptId: string) {
    setBusy(true); setOrderError("");
    try {
      const response = await fetch("/api/wholesale/orders/attempts/acknowledge", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attemptId }),
      });
      const body = await response.json();
      if (response.status === 401) { router.replace("/mayoristas/ingresar"); return; }
      if (!response.ok || !body.ok) throw new Error(body.error || "No se pudo reconocer el resultado.");
      await Promise.all([refreshAttempts(), refreshOrders()]);
    } catch (cause) {
      setOrderError(cause instanceof Error ? cause.message : "No se pudo reconocer el resultado.");
      await refreshAttempts().catch(() => undefined);
    } finally { setBusy(false); }
  }

  return <main className="mx-auto min-h-[70vh] max-w-7xl px-4 py-7 text-white sm:px-6 sm:py-10 lg:px-8">
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.25em] text-red-300">DCL CREE LED</p><h1 className="mt-2 text-2xl font-black uppercase tracking-tight sm:text-4xl">Catálogo mayorista</h1><p className="mt-2 text-sm text-zinc-400">Precios exclusivos para clientes mayoristas.</p></div>
      <div className="flex w-full gap-2 sm:w-auto sm:shrink-0">
        <button type="button" onClick={() => setCartOpen(true)} aria-haspopup="dialog" aria-expanded={cartOpen} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full border border-red-400/60 px-3 text-sm font-bold text-white hover:bg-red-950/40 focus-visible:outline-2 focus-visible:outline-red-400 sm:flex-none sm:px-5">
          <span>Carrito</span><span aria-label={`${totalUnits} unidades`} className="rounded-full bg-red-600 px-2 py-0.5 text-xs">{totalUnits}</span>
        </button>
        <button type="button" disabled={busy} onClick={() => void logout()} className="min-h-12 flex-1 rounded-full border border-white/20 px-3 text-sm font-semibold disabled:opacity-50 sm:flex-none sm:px-5">{busy ? "Saliendo…" : "Cerrar sesión"}</button>
      </div>
    </div>

    {(attempts.length > 0 || attemptsLoading || attemptsError) && <section aria-label="Solicitudes recuperables" className="mb-6 space-y-3">
      {attemptsLoading && <p role="status" className="text-sm text-zinc-400">Cargando intentos recuperables…</p>}
      {attemptsError && <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-sm text-amber-100"><p role="alert">{attemptsError}</p><button type="button" onClick={() => void refreshAttempts()} className="mt-2 min-h-10 rounded-full border border-amber-200/40 px-4 font-semibold">Reintentar intentos</button></div>}
      {attempts.map(attempt => attempt.status === "open" ? <article key={attempt.attemptId} className="rounded-2xl border border-amber-300/40 bg-amber-950/20 p-4 sm:p-5">
        <h2 className="font-bold text-amber-100">Hay una solicitud pendiente de envío</h2>
        <p className="mt-1 text-sm leading-6 text-zinc-300">Este intento conserva los artículos originales. El carrito actual se mantiene aparte; para enviar una selección diferente, cerrá explícitamente este intento primero. El cierre solo funciona si todavía no se creó un pedido.</p>
        <ul className="mt-3 space-y-1 text-sm text-zinc-200">{attempt.items.map(item => {
          const product = uniqueProducts.find(candidate => candidate.id === item.productId);
          return <li key={item.productId}>{item.quantity} × {product?.name || item.productId}</li>;
        })}</ul>
        {orderError && <p role="alert" className="mt-3 text-sm text-red-200">{orderError}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void retryAttempt(attempt.attemptId)} className="min-h-11 rounded-full bg-amber-700 px-4 text-sm font-semibold text-white disabled:opacity-50">Reintentar este intento</button>
          <button type="button" disabled={busy} onClick={() => void closeAttempt(attempt.attemptId)} className="min-h-11 rounded-full border border-amber-200/40 px-4 text-sm font-semibold text-amber-100 disabled:opacity-50">Cerrar intento pendiente</button>
        </div>
      </article> : <article key={attempt.attemptId} className="rounded-2xl border border-emerald-300/40 bg-emerald-950/20 p-4 sm:p-5">
        <h2 className="font-bold text-emerald-100">Solicitud creada{attempt.order?.orderNumber ? ` · ${attempt.order.orderNumber}` : ""}</h2>
        <p className="mt-1 text-sm leading-6 text-zinc-300">El resultado se recuperó del servidor. Tu selección local permanece intacta hasta que decidas qué hacer.</p>
        {attempt.order?.items?.length ? <ul className="mt-3 space-y-1 text-sm text-zinc-200">{attempt.order.items.map(item => <li key={item.productId}>{item.quantity} × {item.name}</li>)}</ul> : null}
        {orderError && <p role="alert" className="mt-3 text-sm text-red-200">{orderError}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void acknowledgeAttempt(attempt.attemptId)} className="min-h-11 rounded-full border border-emerald-200/40 px-4 text-sm font-semibold text-emerald-100 disabled:opacity-50">Ya vi esta solicitud</button>
          <button type="button" disabled={busy || !Object.keys(selection).length} onClick={() => void submitOrder(true)} className="min-h-11 rounded-full bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50">Nueva solicitud con el carrito actual</button>
        </div>
      </article>)}
    </section>}

    {(ordersLoading || ordersError) && <section aria-label="Estado del historial" className="mb-3 rounded-xl border border-white/10 px-4 py-3">
      {ordersLoading && <p role="status" className="text-sm text-zinc-400">Cargando historial…</p>}
      {ordersError && <div className="text-sm text-amber-100"><p role="alert">{ordersError}</p><button type="button" onClick={() => void refreshOrders()} className="mt-2 min-h-10 rounded-full border border-amber-200/40 px-4 font-semibold">Reintentar historial</button></div>}
    </section>}
    {orders.length > 0 && <details className="mb-6 rounded-xl border border-white/10 px-4">
      <summary className="min-h-12 cursor-pointer py-3 text-sm font-semibold text-red-300">Solicitudes anteriores</summary>
      <ul className="divide-y divide-white/10 pb-2">{orders.map(order => <li key={order.id} className="py-3">
        <p className="font-semibold">{order.order_number} · {order.status}</p>
        <p className="mt-1 text-xs text-zinc-400">{new Date(order.created_at).toLocaleDateString("es-AR")} · {order.items.reduce((sum, item) => sum + item.quantity, 0)} unidades</p>
        <ul className="mt-2 space-y-1 text-sm text-zinc-300">{order.items.map(item => <li key={item.productId}>{item.quantity} × {item.name}</li>)}</ul>
      </li>)}</ul>
      {Object.keys(selection).length > 0 && <button type="button" disabled={busy} onClick={() => void submitOrder(true)} className="mb-3 min-h-11 rounded-full border border-red-300/50 px-4 text-sm font-semibold text-red-100 disabled:opacity-50">Crear otra solicitud con el carrito actual</button>}
    </details>}

    <form onSubmit={event => void search(event)} className="mb-4 rounded-2xl border border-white/10 bg-zinc-950 p-3 sm:p-4">
      <label htmlFor="wholesale-search" className="sr-only">Buscar producto, conector o vehículo</label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input id="wholesale-search" type="search" value={query} onChange={event => { setQuery(event.target.value.slice(0, 120)); setAppliedQuery(""); setVehicleResults(null); setVehicleError(""); }} placeholder="Buscá producto, conector o vehículo…" maxLength={120} className="min-h-12 min-w-0 flex-1 rounded-xl border border-white/15 bg-black px-4 text-base text-white placeholder:text-zinc-500 focus-visible:outline-2 focus-visible:outline-red-400" />
        <button type="submit" disabled={loading || vehicleLoading} className="min-h-12 rounded-full bg-red-600 px-6 text-sm font-bold text-white disabled:opacity-50">{vehicleLoading ? "Buscando…" : "Buscar"}</button>
      </div>
      {(query || appliedQuery || category || vehicleResults !== null) && <button type="button" onClick={clearSearch} className="mt-3 min-h-11 px-2 text-sm text-red-300 underline">Limpiar búsqueda y filtros</button>}
    </form>

    {categories.length > 1 && <details className="mb-5 rounded-xl border border-white/10 px-4">
      <summary className="min-h-12 cursor-pointer py-3 text-sm font-semibold text-red-300">Filtrar por categoría</summary>
      <label htmlFor="wholesale-category" className="block pb-4 text-sm text-zinc-300">Categoría
        <select id="wholesale-category" value={category} onChange={event => { setCategory(event.target.value); setAppliedQuery(query.trim()); setVehicleResults(null); setVehicleError(""); }} className="mt-2 min-h-12 w-full rounded-xl border border-white/15 bg-zinc-950 px-3 text-base text-white sm:max-w-sm">
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
    {error && <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-200"><p role="alert">{error}</p><button type="button" onClick={() => { setError(""); setLoading(true); setCatalogRetry(value => value + 1); }} className="mt-2 min-h-10 rounded-full border border-red-200/40 px-4 font-semibold">Reintentar catálogo</button></div>}
    {!loading && catalogLoaded && vehicleLoading && <p role="status" className="py-5 text-sm text-zinc-400">Buscando compatibilidades…</p>}
    {!loading && catalogLoaded && vehicleError && <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-sm text-amber-200">{vehicleError}</p>}
    {!loading && catalogLoaded && !vehicleLoading && hasActiveSearch && <>
      <div className="mb-4" aria-live="polite">
        <p className="text-sm text-zinc-400">{resultProducts.length} producto(s){appliedQuery ? ` para “${appliedQuery}”` : category ? ` en ${category}` : " compatibles"}</p>
        {vehicleResults?.length ? <p className="mt-1 text-xs text-emerald-200">Compatibilidad encontrada en la base de vehículos.</p> : null}
      </div>
      {resultProducts.length > 0 ? <>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{resultProducts.map(product => <WholesaleProductCard key={product.id} product={product} compatibility={compatibilityById.get(product.id)} onAdd={addProduct} selected={Boolean(selection[product.id])} />)}</div>
      </>
        : <div className="rounded-2xl border border-white/10 p-5 text-sm leading-6 text-zinc-300">
          <p>{uniqueProducts.length === 0 ? "Por el momento no hay productos con precio mayorista disponible." : appliedQuery ? "No encontramos productos ni compatibilidades para esta búsqueda." : "No hay productos para mostrar con esta categoría."}</p>
          {appliedQuery && <p className="mt-2 text-zinc-400">Probá con el conector, el nombre del producto o una marca y modelo de vehículo.</p>}
        </div>}
    </>}
    {!loading && catalogLoaded && !hasActiveSearch && <p className="rounded-2xl border border-white/10 bg-zinc-950/60 p-5 text-sm leading-6 text-zinc-300">Buscá por producto, conector, categoría o vehículo para ver opciones mayoristas.</p>}
    <WholesaleCartDrawer open={cartOpen} onClose={() => setCartOpen(false)} selection={selection} busy={busy} error={orderError} message={orderMessage} onQuantityChange={updateQuantity} onSubmit={() => void submitOrder()} />
  </main>;
}
