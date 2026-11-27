"use client";

import Link from "next/link";
import { VehicleCategories } from "@/components/sections/VehicleCategories";
import { SmartProductSearch } from "@/components/public/SmartProductSearch";
import { useSiteContent } from "@/components/providers/SiteContentProvider";
import type { ProductVehicleType } from "@/lib/product-taxonomy";
import { publicText, publicPresentationDefaults } from "@/lib/public-site-content";

export function VehicleSelector({ initialVehicle, heading = "h2", homeVisibility = false }: { initialVehicle?: ProductVehicleType; heading?: "h1" | "h2"; homeVisibility?: boolean } = {}) {
  const { content } = useSiteContent();
  const Heading = heading;
  return <section id="vehiculos" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-10 sm:px-6 lg:px-8">
    <Heading className="mb-4 text-2xl font-black uppercase tracking-tight text-white [overflow-wrap:anywhere]">{publicText(content.siteSettings?.vehicleSectionTitle, publicPresentationDefaults.vehicleSectionTitle)}</Heading>
    <SmartProductSearch products={content.products} initialVehicle={initialVehicle} />
    {homeVisibility && <details className="mt-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-zinc-300">Explorar categorías de vehículos</summary><VehicleCategories homeVisibility /></details>}
    <Link href="/productos" className="mt-3 inline-flex min-h-12 items-center text-sm font-semibold text-red-300 underline">Ver todos los productos</Link>
  </section>;
}
