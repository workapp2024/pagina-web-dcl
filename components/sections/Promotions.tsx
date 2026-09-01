"use client";

import { useSiteContent } from "@/components/providers/SiteContentProvider";
import { ManagedImage } from "@/components/ui/ManagedImage";
import { isWhatsAppUrl, whatsappUrl } from "@/lib/whatsapp";

export function Promotions() {
  const { content } = useSiteContent();

  return (
    <section id="promociones" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="mb-8 max-w-2xl">
        <h2 className="text-3xl font-black uppercase tracking-[-0.06em] text-white md:text-4xl">
          {content.siteSettings.promotionsSectionTitle}
        </h2>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {content.promotions.filter((promo) => promo.active).map((promo) => (
          <article key={promo.id} className="flex flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-zinc-900">
            <div className="relative flex h-64 w-full items-center justify-center overflow-hidden bg-zinc-950/70 p-3">
              <ManagedImage source={promo.image} alt={promo.title} className="max-h-full max-w-full object-contain" />
            </div>
            <div className="flex flex-1 flex-col p-5">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.24em] text-red-400">PROMO</div>
              <h3 className="text-2xl font-black uppercase tracking-[-0.05em] text-white">{promo.title}</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-300">{promo.description}</p>
              {promo.price ? <p className="mt-3 text-lg font-black text-red-400">{promo.price}</p> : null}
              <a
                href={isWhatsAppUrl(promo.ctaHref) ? whatsappUrl(`Hola DCL Cree LED, quiero consultar por ${promo.title}.`) : promo.ctaHref}
                target="_blank"
                rel="noreferrer"
                className="mt-auto inline-flex min-h-[44px] items-center justify-center rounded-full border border-red-500/50 bg-red-600/10 px-5 py-2.5 text-xs font-bold uppercase tracking-[0.16em] text-red-300 transition hover:bg-red-600/20"
              >
                {promo.ctaText}
              </a>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
