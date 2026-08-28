"use client";

import { NeedCategory } from "@/components/ui/NeedCategory";
import { useSiteContent } from "@/components/providers/SiteContentProvider";
import { needCategories } from "@/lib/site-data";

export function NeedCategories() {
  const { content } = useSiteContent();

  return (
    <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="mb-8 max-w-2xl">
        <h2 className="text-3xl font-black uppercase tracking-[-0.06em] text-white md:text-4xl">
          {content.siteSettings.needsSectionTitle}
        </h2>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
        {needCategories.map((category) => (
          <NeedCategory key={category.title} {...category} />
        ))}
      </div>
    </section>
  );
}
