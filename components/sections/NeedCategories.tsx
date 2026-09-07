"use client";

import Link from "next/link";
import { productNeeds } from "@/lib/product-taxonomy";
import { productCatalogHref, productFilterEventProperties } from "@/lib/product-filters";
import { analyticsEvents, capture } from "@/lib/analytics";

export function NeedCategories() {
  return <section id="necesidades" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-14 sm:px-6 lg:px-8">
    <div className="mb-7 max-w-2xl">
      <h2 className="text-3xl font-black uppercase tracking-tight text-white">¿Qué estás buscando?</h2>
      <p className="mt-3 text-sm leading-6 text-zinc-300">Elegí una necesidad y refiná por tipo de vehículo en el mismo catálogo.</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {productNeeds.map(need => <Link key={need.id} href={productCatalogHref(need.filters)} onClick={() => capture(analyticsEvents.homeNeedSelected, productFilterEventProperties(need.filters))} className="flex min-h-20 min-w-0 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-zinc-900 p-5 font-bold text-white transition hover:border-red-500/60">{need.label}<span aria-hidden="true" className="text-red-400">→</span></Link>)}
    </div>
    <Link href="/productos" className="mt-5 inline-flex min-h-12 items-center text-sm font-bold text-red-300 underline">Ver todos los productos</Link>
  </section>;
}
