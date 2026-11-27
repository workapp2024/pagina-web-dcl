"use client";
import { useId, useState } from "react";
import Link from "next/link";
import { VehicleFinder } from "@/components/public/VehicleFinder";
import type { Product } from "@/lib/site-data";
import { productCatalogHref } from "@/lib/product-filters";
import { productVehicleTypes, type ProductVehicleType } from "@/lib/product-taxonomy";

export function SmartProductSearch({ products, initialConnector = "", initialVehicle }: { products: Product[]; initialConnector?: string; initialVehicle?: ProductVehicleType }) {
  const id = useId();
  const [mode, setMode] = useState<"connector" | "vehicle">(initialVehicle && !initialConnector ? "vehicle" : "connector");
  const [connector, setConnector] = useState(initialConnector);
  const [vehicle, setVehicle] = useState<ProductVehicleType>(initialVehicle ?? "auto");
  const available = [...new Set(products.filter(p => p.active && p.showInCatalog).map(p => p.connectorType?.trim().toUpperCase()).filter((v): v is string => Boolean(v)))].sort();
  const popular = ["H1","H4","H7","H11","9005","9006"].filter(c => available.includes(c));
  const suggestions = available.filter(c => c.includes(connector.trim().toUpperCase())).slice(0, 8);
  const selected = productVehicleTypes.find(v => v.id === vehicle);
  const tab = (active: boolean) => "min-h-16 rounded-xl border p-3 text-sm font-bold transition focus-visible:outline-2 focus-visible:outline-red-400 " + (active ? "border-red-500 bg-red-950/50 text-white" : "border-white/15 bg-zinc-900 text-zinc-300");
  return <div className="min-w-0 space-y-4 rounded-2xl border border-white/10 bg-zinc-950 p-4 sm:p-5">
    <div><h2 className="text-xl font-black text-white sm:text-2xl">Encontrá tu LED ideal</h2><p className="mt-1 text-sm text-zinc-400">Elegí cómo querés buscar tu iluminación.</p></div>
    <div className="grid grid-cols-2 gap-2" aria-label="Modo de búsqueda">
      <button type="button" aria-pressed={mode === "connector"} className={tab(mode === "connector")} onClick={() => setMode("connector")}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="mx-auto mb-1 h-6 w-6"><path d="M9 3v5m6-5v5M7 8h10v3a5 5 0 0 1-5 5v5m-5-10a5 5 0 0 0 5 5"/></svg>Por conector</button>
      <button type="button" aria-pressed={mode === "vehicle"} className={tab(mode === "vehicle")} onClick={() => setMode("vehicle")}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="mx-auto mb-1 h-6 w-6"><path d="m5 10 2-5h10l2 5M4 17v3m16-3v3M3 10h18v7H3zM7 13h2m6 0h2"/></svg>Por vehículo</button>
    </div>
    {mode === "connector" ? <form action="/productos" method="get" className="space-y-3">
      <label htmlFor={id} className="block text-sm font-semibold text-zinc-200">¿Qué conector necesitás?</label>
      <input id={id} name="conector" type="search" list={id+"-list"} required maxLength={30} value={connector} onChange={e => setConnector(e.target.value)} placeholder="Ej.: H7, H4, H11..." className="min-h-12 w-full min-w-0 rounded-xl border border-white/20 bg-black px-3 text-base text-white"/>
      <datalist id={id+"-list"}>{available.map(c => <option key={c} value={c}/>)}</datalist>
      {(connector.trim() ? suggestions : popular.length ? popular : available.slice(0,6)).length > 0 && <div><p className="mb-2 text-xs text-zinc-400">{connector.trim() ? "Conectores disponibles" : "Conectores populares"}</p><div className="flex flex-wrap gap-2">{(connector.trim() ? suggestions : popular.length ? popular : available.slice(0,6)).map(c => <Link key={c} href={productCatalogHref({connectorType:c})} className="inline-flex min-h-11 items-center rounded-lg border border-white/15 bg-zinc-900 px-3 text-sm font-bold text-white hover:border-red-500">{c}</Link>)}</div></div>}
      <button type="submit" className="min-h-12 w-full rounded-xl bg-red-600 px-4 text-sm font-bold text-white">Buscar productos</button>
    </form> : <div className="space-y-3">
      <p className="text-sm font-semibold">Tipo de vehículo</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{productVehicleTypes.map(v => <button key={v.id} type="button" aria-pressed={vehicle === v.id} onClick={() => setVehicle(v.id)} className={tab(vehicle === v.id)}>{v.label}</button>)}</div>
      <VehicleFinder key={vehicle} initialType={selected?.label} products={products}/>
    </div>}
  </div>;
}
