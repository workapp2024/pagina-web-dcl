"use client";

import { reasons } from "@/lib/site-data";
import { useSiteContent } from "@/components/providers/SiteContentProvider";

export function WhyUs() {
  const { content } = useSiteContent();

  return (
    <section id="nosotros" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="mb-8 max-w-2xl">
        <h2 className="text-3xl font-black uppercase tracking-[-0.06em] text-white md:text-4xl">
          {content.siteSettings.whyUsSectionTitle}
        </h2>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {reasons.map((reason) => (
          <article key={reason.title} className="rounded-[1.5rem] border border-white/10 bg-zinc-900/80 p-5">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-red-600/15 text-lg font-black text-red-400">
              {reason.title.slice(0, 1)}
            </div>
            <h3 className="text-xl font-black uppercase tracking-[-0.04em] text-white">{reason.title}</h3>
            <p className="mt-3 text-sm leading-6 text-zinc-300">{reason.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
