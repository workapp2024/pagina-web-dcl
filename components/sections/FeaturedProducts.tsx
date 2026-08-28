"use client";

import { ProductCard } from "@/components/ui/ProductCard";
import { useSiteContent } from "@/components/providers/SiteContentProvider";

export function FeaturedProducts() {
  const { content } = useSiteContent();

  return (
    <section id="productos" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <h2 className="text-3xl font-black uppercase tracking-[-0.06em] text-white md:text-4xl">
          {content.siteSettings.productsSectionTitle}
        </h2>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
        {content.products.filter((product) => product.featured && product.active).map((product) => (
          <ProductCard key={product.id} {...product} />
        ))}
      </div>
    </section>
  );
}
