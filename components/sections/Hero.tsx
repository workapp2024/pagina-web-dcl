"use client";

import { useSiteContent } from "@/components/providers/SiteContentProvider";
import { WhatsAppButton } from "@/components/ui/WhatsAppButton";
import { ManagedImage } from "@/components/ui/ManagedImage";

export function Hero() {
  const { content } = useSiteContent();

  return (
    <section id="inicio" className="relative overflow-hidden border-b border-white/10 bg-black">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(239,68,68,0.18),transparent_35%),linear-gradient(120deg,_rgba(255,255,255,0.04),transparent_50%)]" />
      <div className="absolute inset-0 overflow-hidden opacity-50">
        <ManagedImage
          source={content.siteSettings.heroImage}
          alt="Fondo Hero DCL Cree LED"
          className="h-full w-full object-cover object-center"
        />
      </div>

      <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:py-24">
        <div className="flex flex-col justify-center">
          <span className="mb-5 inline-flex w-fit rounded-full border border-red-500/40 bg-red-600/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.28em] text-red-300">
            ILUMINACIÓN CREE LED
          </span>
          <h1 className="max-w-xl text-4xl font-black uppercase leading-[0.95] tracking-[-0.08em] text-white sm:text-5xl lg:text-7xl">
            {content.siteSettings.heroTitle}
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-zinc-200">
            {content.siteSettings.heroSubtitle}
          </p>

          <div className="mt-8 flex flex-col gap-4 sm:flex-row">
            <a
              href="#vehiculos"
              className="inline-flex items-center justify-center rounded-full bg-red-600 px-6 py-3.5 text-sm font-bold uppercase tracking-[0.14em] text-white transition hover:bg-red-500"
            >
              {content.siteSettings.heroPrimaryCta}
            </a>
            <a
              href="#productos"
              className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/5 px-6 py-3.5 text-sm font-bold uppercase tracking-[0.14em] text-white transition hover:border-red-500/70 hover:text-red-300"
            >
              {content.siteSettings.heroSecondaryCta}
            </a>
          </div>
        </div>

        <div className="flex items-end justify-center lg:justify-end">
          <div className="w-full max-w-md rounded-[2rem] border border-white/10 bg-black/40 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.6)] backdrop-blur-sm">
            <div className="rounded-[1.5rem] border border-white/10 bg-zinc-950 p-5">
              <div className="mb-5 flex items-center justify-between gap-3">
                <ManagedImage source={content.siteSettings.logo} alt="DCL Cree LED" className="h-12 w-auto" />
                <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-red-300">
                  Premium
                </span>
              </div>

              <div className="rounded-[1.5rem] bg-[radial-gradient(circle_at_center,_rgba(239,68,68,0.2),transparent_45%)] p-5">
                <div className="rounded-[1.25rem] border border-white/10 bg-black p-4">
                  {content.products[0]?.image ? (
                    <div className="mb-5 flex h-36 w-full items-center justify-center overflow-hidden rounded-xl bg-zinc-950/60 p-2">
                      <ManagedImage source={content.products[0].image} alt={content.products[0].name} className="max-h-full max-w-full object-contain" />
                    </div>
                  ) : null}
                  <div className="space-y-3">
                    <div className="h-3 w-2/3 rounded-full bg-zinc-700" />
                    <div className="h-3 w-full rounded-full bg-zinc-800" />
                    <div className="h-3 w-5/6 rounded-full bg-zinc-800" />
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-zinc-400">Rendimiento</div>
                  <div className="mt-1 text-2xl font-black uppercase tracking-[-0.06em] text-white">CREE</div>
                </div>
                <WhatsAppButton className="px-4 py-2.5 text-[10px]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
