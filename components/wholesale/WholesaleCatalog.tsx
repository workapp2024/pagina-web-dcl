"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ManagedImage } from "@/components/ui/ManagedImage";
import type { WholesaleCatalogItem } from "@/lib/wholesale-server";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export function WholesaleCatalog() {
  const router = useRouter();
  const [products, setProducts] = useState<WholesaleCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  return <main className="mx-auto min-h-[70vh] max-w-7xl px-4 py-8 text-white sm:px-6 sm:py-12 lg:px-8">
    <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
      <div><p className="text-xs font-bold uppercase tracking-[0.25em] text-red-300">DCL CREE LED</p><h1 className="mt-2 text-3xl font-black uppercase tracking-tight sm:text-4xl">Catálogo mayorista</h1><p className="mt-2 text-sm text-zinc-400">Precios exclusivos para clientes mayoristas.</p></div>
      <button type="button" disabled={busy} onClick={() => void logout()} className="min-h-11 rounded-full border border-white/20 px-4 text-sm font-semibold disabled:opacity-50">{busy ? "Saliendo…" : "Cerrar sesión"}</button>
    </div>
    {loading && <p className="text-sm text-zinc-400">Cargando catálogo…</p>}
    {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-200">{error}</p>}
    {!loading && !error && products.length === 0 && <p className="rounded-2xl border border-white/10 p-6 text-zinc-300">Por el momento no hay productos con precio mayorista disponible.</p>}
    {!loading && !error && products.length > 0 && <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{products.map(product => <article key={product.id} className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950">
      <div className="flex h-52 items-center justify-center bg-zinc-900 p-4"><ManagedImage source={product.imageUrl} alt={product.name} className="max-h-full max-w-full object-contain" /></div>
      <div className="p-5"><p className="text-xs font-semibold uppercase tracking-widest text-red-300">{product.category || "DCL"}</p><h2 className="mt-2 text-xl font-bold">{product.name}</h2>{product.connectorType && <p className="mt-2 text-sm text-zinc-400">Conector: {product.connectorType}</p>}<p className="mt-3 line-clamp-3 text-sm leading-6 text-zinc-300">{product.description}</p><p className="mt-5 text-2xl font-black">{money.format(product.wholesalePrice)}</p></div>
    </article>)}</div>}
  </main>;
}
