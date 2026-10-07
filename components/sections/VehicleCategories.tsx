"use client";

import Link from "next/link";
import { useSiteContent } from "@/components/providers/SiteContentProvider";
import { ManagedImage } from "@/components/ui/ManagedImage";
import { productVehicleTypes, type ProductVehicleType } from "@/lib/product-taxonomy";
import { productFilterEventProperties } from "@/lib/product-filters";
import { analyticsEvents, capture } from "@/lib/analytics";
import { defaultSiteContent } from "@/lib/site-data";
import { publicText } from "@/lib/public-site-content";

export function VehicleCategories({ onSelect, homeVisibility = false }: { onSelect?: (type: ProductVehicleType) => void; homeVisibility?: boolean } = {}) {
  const { content } = useSiteContent();
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
    {productVehicleTypes.map(option => {
      const category = content.vehicleCategories.find(category => category.id === option.id);
      if (homeVisibility && category?.active === false) return null;
      const fallback = defaultSiteContent.vehicleCategories.find(category => category.id === option.id);
      const image = category?.image || fallback?.image;
      const title = publicText(category?.title, option.label);
      const description = publicText(category?.description, fallback?.description || "");
      const filters = { vehicleType: option.id };
      return <Link key={option.id} href={`/vehiculos?vehiculo=${option.id}`} onClick={event => { capture(analyticsEvents.homeVehicleSelected, productFilterEventProperties(filters)); if (onSelect && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onSelect(option.id); } }} className="group min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 transition hover:border-red-500/60">
        {image && <div className="flex h-28 items-center justify-center bg-zinc-950/50 p-2 sm:h-44"><ManagedImage source={image} alt="" className="max-h-full max-w-full object-contain" /></div>}
        <div className="min-w-0 p-3"><div className="flex min-h-8 items-center justify-between gap-2"><span className="min-w-0 text-base font-bold text-white [overflow-wrap:anywhere] sm:text-xl">{title}</span><span aria-hidden="true" className="shrink-0 text-red-400">→</span></div>{description && <p className="mt-1 text-xs leading-5 text-zinc-400 [overflow-wrap:anywhere]">{description}</p>}</div>
      </Link>;
    })}
  </div>;
}
