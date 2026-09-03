/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useRadio } from "@/components/layout/RadioPlayer";
import { useSiteContent } from "@/components/providers/SiteContentProvider";
import { CartLink } from "@/components/store/CartLink";
import { WhatsAppButton } from "@/components/ui/WhatsAppButton";
import { analyticsEvents, capture } from "@/lib/analytics";

const navItems = [
  { label: "Inicio", href: "/" },
  { label: "Productos", href: "/productos" },
  { label: "Vehículos", href: "/vehiculos" },
  { label: "DCL Music", href: "/music" },
  { label: "Promociones", href: "/#promociones" },
  { label: "Nosotros", href: "/#nosotros" },
  { label: "Contacto", href: "/#contacto" },
];

export function Header() {
  const { content } = useSiteContent();
  const radio = useRadio();
  const mobileMenu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const menu = mobileMenu.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.removeAttribute("open");
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        mobileMenu.current?.removeAttribute("open");
        mobileMenu.current?.querySelector<HTMLElement>("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const closeMenu = () => mobileMenu.current?.removeAttribute("open");
  const playing = radio.status === "playing" || radio.status === "loading" || radio.status === "stalled";
  const logo = <img src={content.siteSettings.logo} alt="DCL Cree LED" className="h-11 max-w-[7.5rem] object-contain object-left sm:h-14 sm:max-w-none md:h-16" />;

  return <header className="sticky top-0 z-50 border-b border-white/10 bg-black/95 pt-[env(safe-area-inset-top)]">
    <details ref={mobileMenu} className="group relative lg:hidden">
      <summary aria-label="Abrir o cerrar menú" className="absolute right-3 top-3 z-10 grid h-11 w-11 cursor-pointer list-none place-items-center rounded-full border border-white/15 bg-zinc-950 text-xl text-white sm:right-6"><span className="group-open:hidden" aria-hidden="true">☰</span><span className="hidden group-open:inline" aria-hidden="true">×</span></summary>
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-1.5 px-3 py-3 sm:gap-2 sm:px-6">
        <Link href="/" className="flex min-w-0 shrink items-center" aria-label="DCL Cree LED inicio" onClick={closeMenu}>{logo}</Link>
        <div className="flex shrink-0 items-center gap-1"><Link href="/music" aria-label="Abrir DCL Music" className="grid h-11 w-9 place-items-center text-lg text-red-300">♫</Link>{playing&&<button type="button" onClick={radio.pause} aria-label={`Pausar ${radio.station?.name}`} className="grid h-11 w-9 place-items-center rounded-full border border-white/15 text-white">Ⅱ</button>}<CartLink/><span className="h-11 w-11 shrink-0" aria-hidden="true"/></div>
      </div>
      <nav className="grid border-t border-white/10 bg-zinc-950 px-3 py-3 shadow-[0_16px_30px_rgba(0,0,0,.35)] sm:grid-cols-2 sm:px-6" aria-label="Navegación móvil">{navItems.map(item => <Link key={item.label} href={item.href} onClick={() => { capture(analyticsEvents.navigationClick,{destination:item.href,source:"header"}); closeMenu(); }} className="flex min-h-12 items-center rounded-xl px-4 text-base font-semibold text-zinc-100 active:bg-red-600/20">{item.label}</Link>)}<WhatsAppButton source="header" label="WhatsApp" className="mt-2 min-h-12 w-full sm:col-span-2"/></nav>
    </details>
    <div className="mx-auto hidden max-w-7xl items-center justify-between gap-4 px-8 py-3 lg:flex">
      <Link href="/" className="flex shrink-0 items-center" aria-label="DCL Cree LED inicio">{logo}</Link>
      <nav className="flex items-center gap-7 text-sm font-medium text-zinc-200" aria-label="Navegación principal">{navItems.map(item => <Link key={item.label} href={item.href} onClick={() => capture(analyticsEvents.navigationClick,{destination:item.href,source:"header"})} className="transition hover:text-red-400">{item.label}</Link>)}</nav>
      <div className="flex shrink-0 items-center gap-2">{radio.available&&<div className="flex items-center rounded-full border border-white/15 bg-zinc-950"><Link href="/music" className="flex h-11 items-center gap-2 px-3 text-xs font-bold text-zinc-200" aria-label="Abrir DCL Music"><span className="text-red-300">♫</span>{playing?<span>{radio.station?.name} · En vivo</span>:<span>DCL Music</span>}</Link>{playing&&<button type="button" onClick={radio.pause} aria-label={`Pausar ${radio.station?.name}`} className="h-11 border-l border-white/15 px-3 text-xs font-bold text-white">Pausa</button>}</div>}<CartLink/><WhatsAppButton label="WhatsApp"/></div>
    </div>
  </header>;
}
