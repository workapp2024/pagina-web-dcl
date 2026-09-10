"use client";

import Link from "next/link";
import { useSiteContent } from "@/components/providers/SiteContentProvider";
import { ManagedImage } from "@/components/ui/ManagedImage";
import { productVehicleTypes, type ProductVehicleType } from "@/lib/product-taxonomy";
import { productFilterEventProperties } from "@/lib/product-filters";
import { analyticsEvents, capture } from "@/lib/analytics";

export function VehicleCategories({ onSelect }: { onSelect?: (type: ProductVehicleType) => void } = {}) {
  const { content } = useSiteContent();
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
    {productVehicleTypes.map(option => {
      const image = content.vehicleCategories.find(category => category.id === option.id)?.image;
      const filters = { vehicleType: option.id };
      return <Link key={option.id} href={`/vehiculos?vehiculo=${option.id}`} onClick={event => { capture(analyticsEvents.homeVehicleSelected, productFilterEventProperties(filters)); if (onSelect && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onSelect(option.id); } }} className="group min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 transition hover:border-red-500/60">
        {image && <div className="flex h-28 items-center justify-center bg-zinc-950/50 p-2 sm:h-44"><ManagedImage source={image} alt="" className="max-h-full max-w-full object-contain" /></div>}
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-1 p-3"><span className="text-base font-bold text-white sm:text-xl">{option.label}</span><span aria-hidden="true" className="text-red-400">→</span></div>
      </Link>;
    })}
  </div>;
}
