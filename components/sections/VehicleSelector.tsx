"use client";

import { useState } from "react";
import Link from "next/link";
import { VehicleCategories } from "@/components/sections/VehicleCategories";
import { VehicleFinder } from "@/components/public/VehicleFinder";
import { ConnectorField } from "@/components/public/ConnectorField";
import { useSiteContent } from "@/components/providers/SiteContentProvider";
import { productVehicleTypes, type ProductVehicleType } from "@/lib/product-taxonomy";

export function VehicleSelector({ initialVehicle, heading = "h2" }: { initialVehicle?: ProductVehicleType; heading?: "h1" | "h2" } = {}) {
  const { content } = useSiteContent();
  const [vehicle, setVehicle] = useState(initialVehicle);
  const [path, setPath] = useState<"connector" | "vehicle" | null>(null);
  const selected = productVehicleTypes.find(option => option.id === vehicle);
  const Heading = heading;
  const card = "min-h-28 rounded-2xl border border-white/15 bg-zinc-900 p-5 text-left transition hover:border-red-500/60 focus-visible:outline-2 focus-visible:outline-red-400";

  return <section id="vehiculos" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-14 sm:px-6 lg:px-8">
    <div className="mb-6 max-w-2xl">
      <Heading className="text-3xl font-black uppercase tracking-tight text-white">Encontrá el LED para tu vehículo</Heading>
      <p className="mt-3 text-sm text-zinc-300">{selected ? `${selected.label} · ${path === "connector" ? "Buscar por conector" : path === "vehicle" ? "Buscar por mi vehículo" : "¿Cómo querés buscar?"}` : "Para empezar, elegí tu tipo de vehículo."}</p>
    </div>
    {!selected ? <VehicleCategories onSelect={setVehicle} /> : <>
      <button type="button" onClick={() => { if (path) setPath(null); else setVehicle(undefined); }} className="mb-4 inline-flex min-h-12 items-center text-sm text-red-300 underline">← {path ? "Volver a las opciones" : "Cambiar vehículo"}</button>
      {!path && <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" className={card} onClick={() => setPath("connector")}><span className="block text-lg font-bold text-white">Ya sé qué lámpara necesito</span><span className="mt-2 block text-sm text-zinc-400">Buscar por conector: H7, H4, H11...</span></button>
        <button type="button" className={card} onClick={() => setPath("vehicle")}><span className="block text-lg font-bold text-white">No sé cuál lleva mi {selected.label.toLocaleLowerCase("es")}</span><span className="mt-2 block text-sm text-zinc-400">Buscar por marca, modelo y año</span></button>
      </div>}
      {path === "connector" && <form action="/productos" method="get" className="max-w-xl space-y-4 rounded-2xl border border-white/10 p-5">
        <ConnectorField products={content.products} id="finder-connectors" label="¿Qué conector buscás?" required />
        <button type="submit" className="min-h-12 w-full rounded-full bg-red-600 px-6 text-sm font-bold text-white sm:w-auto">Buscar lámparas</button>
      </form>}
      {path === "vehicle" && <VehicleFinder key={vehicle} initialType={selected.label} />}
    </>}
    <Link href="/productos" className="mt-5 inline-flex min-h-12 items-center text-sm font-semibold text-red-300 underline">Ver todos los productos</Link>
  </section>;
}
