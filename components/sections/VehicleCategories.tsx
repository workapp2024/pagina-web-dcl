"use client";

import { useSiteContent } from "@/components/providers/SiteContentProvider";
import { ManagedImage } from "@/components/ui/ManagedImage";

export function VehicleCategories() {
  const { content } = useSiteContent();

  return (
    <section id="vehiculos" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="mb-8 max-w-2xl">
        <h2 className="text-3xl font-black uppercase tracking-[-0.06em] text-white md:text-4xl">
          {content.siteSettings.vehicleSectionTitle}
        </h2>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {content.vehicleCategories.filter((category) => category.active).map((category) => (
          <a
            key={category.id}
            href={category.href}
            className="group overflow-hidden rounded-[1.5rem] border border-white/10 bg-zinc-900"
          >
            <div className="relative flex h-52 w-full items-center justify-center overflow-hidden bg-zinc-950/50 p-2">
              <ManagedImage
                source={category.image}
                alt={category.title}
                className="max-h-full max-w-full object-contain transition duration-500 group-hover:scale-105"
              />
            </div>
            <div className="flex items-center justify-between p-4">
              <div>
                <span className="text-xl font-black uppercase tracking-[-0.05em] text-white">{category.title}</span>
                <p className="mt-1 text-sm text-zinc-400">{category.description}</p>
              </div>
              <span className="text-xl text-red-400">→</span>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
