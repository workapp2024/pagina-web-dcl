"use client";

import { useSiteContent } from "@/components/providers/SiteContentProvider";
import { WhatsAppButton } from "@/components/ui/WhatsAppButton";

const navItems = [
  { label: "Inicio", href: "#inicio" },
  { label: "Productos", href: "#productos" },
  { label: "Vehículos", href: "#vehiculos" },
  { label: "Promociones", href: "#promociones" },
  { label: "Nosotros", href: "#nosotros" },
  { label: "Contacto", href: "#contacto" },
];

export function Header() {
  const { content } = useSiteContent();

  const handleMobileMenuClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    const detailsElement = event.currentTarget.closest("details");
    if (detailsElement) {
      detailsElement.open = false;
    }
  };

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <a href="#inicio" className="flex items-center" aria-label="DCL Cree LED inicio">
          <img src={content.siteSettings.logo} alt="DCL Cree LED" className="h-12 w-auto sm:h-14 md:h-16" />
        </a>

        <nav className="hidden items-center gap-8 text-sm font-medium text-zinc-200 md:flex">
          {navItems.map((item) => (
            <a key={item.label} href={item.href} className="transition hover:text-red-400">
              {item.label}
            </a>
          ))}
        </nav>

        <div className="hidden md:block">
          <WhatsAppButton label="WhatsApp" />
        </div>

        <details className="group md:hidden">
          <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full border border-white/10 bg-white/5 text-xl text-white">
            ☰
          </summary>
          <div className="absolute right-4 top-full mt-3 w-[220px] rounded-2xl border border-white/10 bg-zinc-950 p-3 shadow-2xl">
            <nav className="flex flex-col gap-2 text-sm font-medium text-zinc-200">
              {navItems.map((item) => (
                <a key={item.label} href={item.href} className="rounded-lg px-3 py-2 transition hover:bg-white/5 hover:text-red-300">
                  {item.label}
                </a>
              ))}
              <div className="mt-2 pt-2">
                <WhatsAppButton label="WhatsApp" className="w-full" />
              </div>
            </nav>
          </div>
        </details>
      </div>
    </header>
  );
}
