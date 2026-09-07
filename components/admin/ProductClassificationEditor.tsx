"use client";
import { useState } from "react";
import type { Product } from "@/lib/site-data";
import { isProductCategory, productCategories, productFunctions, productVehicleTypes } from "@/lib/product-taxonomy";

type Classification = Pick<Product, "category" | "vehicleTypes" | "functions">;
export function ProductClassificationEditor({ product, onSaved }: { product: Product; onSaved: (value: Classification) => void }) {
  const [changes, setChanges] = useState<Partial<Classification>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const value = { ...product, ...changes };
  const pending = !value.vehicleTypes?.length || value.category === "General" || !isProductCategory(value.category);
  async function save() {
    if (busy || !Object.keys(changes).length) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/products", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: product.id, classification: changes }) });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.message || body.error || "No se pudo guardar.");
      onSaved({ category: body.data.category, vehicleTypes: body.data.vehicle_types ?? [], functions: body.data.functions ?? [] });
      setChanges({}); setMessage("Clasificación guardada.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar."); }
    finally { setBusy(false); }
  }
  return <fieldset disabled={busy} className="rounded-2xl border border-white/10 bg-black/20 p-4">
    <legend className="px-2 text-sm font-bold uppercase tracking-wider">Clasificación</legend>
    <p className="mb-4 text-xs text-zinc-400">Clasificación comercial; no confirma compatibilidad técnica. Se guarda por separado del resto del producto.</p>
    <label className="block text-sm">Categoría
      <select value={value.category} onChange={event => setChanges(previous => ({ ...previous, category: event.target.value }))} className="mt-2 min-h-12 w-full rounded-xl bg-zinc-900 px-3">
        {!isProductCategory(product.category) && <option value={product.category}>{product.category} — pendiente de revisión</option>}
        {productCategories.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <fieldset><legend className="text-sm font-bold">Función (opcional)</legend>{productFunctions.map(option => <label key={option.id} className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" checked={value.functions?.includes(option.id) ?? false} onChange={event => setChanges(previous => ({ ...previous, functions: event.target.checked ? [...(value.functions ?? []), option.id] : (value.functions ?? []).filter(item => item !== option.id) }))}/>{option.label}
      </label>)}</fieldset>
      <fieldset><legend className="text-sm font-bold">Tipo de vehículo</legend>{productVehicleTypes.map(option => <label key={option.id} className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" checked={value.vehicleTypes?.includes(option.id) ?? false} onChange={event => setChanges(previous => ({ ...previous, vehicleTypes: event.target.checked ? [...(value.vehicleTypes ?? []), option.id] : (value.vehicleTypes ?? []).filter(item => item !== option.id) }))}/>{option.label}
      </label>)}</fieldset>
    </div>
    {pending && <p className="mt-2 text-xs text-amber-200">Sin clasificar o pendiente de revisión. Continúa disponible en el catálogo general si está activo y visible.</p>}
    <button type="button" disabled={busy || !Object.keys(changes).length} onClick={() => void save()} className="mt-4 min-h-11 rounded-full bg-red-600 px-5 text-xs font-bold uppercase disabled:opacity-40">{busy ? "Guardando…" : "Guardar clasificación"}</button>
    {message && <p role="status" className="mt-3 text-sm text-zinc-300">{message}</p>}
  </fieldset>;
}
