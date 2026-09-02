/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CartLink } from "@/components/store/CartLink";
import { useSiteContent } from "@/components/providers/SiteContentProvider";
import { WhatsAppButton } from "@/components/ui/WhatsAppButton";

const navItems = [
  { label: "Inicio", href: "/" }, { label: "Productos", href: "/productos" },
  { label: "Vehículos", href: "/vehiculos" }, { label: "Promociones", href: "/#promociones" },
  { label: "Nosotros", href: "/#nosotros" }, { label: "Contacto", href: "/#contacto" },
];

export function Header() {
  const { content } = useSiteContent();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", close); };
  }, [open]);
  return <header className="sticky top-0 z-50 border-b border-white/10 bg-black/90 backdrop-blur-xl">
    <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
      <Link href="/" className="flex items-center" aria-label="DCL Cree LED inicio" onClick={() => setOpen(false)}><img src={content.siteSettings.logo} alt="DCL Cree LED" className="h-12 w-auto sm:h-14 md:h-16" /></Link>
      <nav className="hidden items-center gap-7 text-sm font-medium text-zinc-200 md:flex" aria-label="Navegación principal">{navItems.map(item => <Link key={item.label} href={item.href} className="transition hover:text-red-400">{item.label}</Link>)}</nav>
      <div className="hidden items-center gap-3 md:flex"><CartLink /><WhatsAppButton label="WhatsApp" /></div>
      <div className="flex items-center gap-2 md:hidden"><CartLink /><button type="button" aria-label={open ? "Cerrar menú" : "Abrir menú"} aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setOpen(value => !value)} className="relative z-[70] flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-zinc-950 text-xl text-white">{open ? "×" : "☰"}</button></div>
    </div>
    {open && <div id="mobile-navigation" className="fixed inset-0 top-[69px] z-[60] md:hidden"><button type="button" aria-label="Cerrar menú" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/75" /><nav className="absolute inset-x-3 top-3 max-h-[calc(100svh-96px)] overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950 p-3 shadow-2xl" aria-label="Navegación móvil">{navItems.map(item => <Link key={item.label} href={item.href} onClick={() => setOpen(false)} className="flex min-h-12 items-center rounded-xl px-4 text-base font-semibold text-zinc-100 active:bg-red-600/20">{item.label}</Link>)}<WhatsAppButton label="WhatsApp" className="mt-3 w-full" /></nav></div>}
  </header>;
}
