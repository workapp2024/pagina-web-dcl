"use client";

import { useSiteContent } from "@/components/providers/SiteContentProvider";
import Link from "next/link";

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

      <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
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
            <Link
              href="/productos"
              className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/5 px-6 py-3.5 text-sm font-bold uppercase tracking-[0.14em] text-white transition hover:border-red-500/70 hover:text-red-300"
            >
              {content.siteSettings.heroSecondaryCta}
            </Link>
          </div>
        </div>

      </div>
    </section>
  );
}
