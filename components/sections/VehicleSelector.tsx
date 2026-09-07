import Link from "next/link";
import { VehicleCategories } from "@/components/sections/VehicleCategories";

export function VehicleSelector() {
  return <section id="vehiculos" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-14 sm:px-6 lg:px-8">
    <div className="mb-7 max-w-2xl">
      <h2 className="text-3xl font-black uppercase tracking-tight text-white">¿Qué vehículo tenés?</h2>
      <p className="mt-3 text-sm leading-6 text-zinc-300">Elegí el tipo de vehículo. En el catálogo podés refinar por categoría y función, como Alta o Baja.</p>
    </div>
    <VehicleCategories />
    <p className="mt-5 text-sm leading-6 text-zinc-400">Clasificación comercial, sin confirmar compatibilidad exacta. Si conocés marca, modelo y año, <Link href="/vehiculos" className="inline-flex min-h-11 items-center text-red-300 underline">consultá el buscador técnico</Link>.</p>
  </section>;
}
