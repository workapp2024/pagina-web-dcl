/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useAdminIdentity } from "@/components/admin/AdminIdentityProvider";
import { canVisitAdminPage } from "@/lib/admin-permissions";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const groups = [
  { label: "Operaciones", icon: "✓", items: [{ href: "/admin/pedidos", label: "Pedidos", icon: "□" }, { href: "/admin/ventas", label: "Ventas", icon: "↗" }, { href: "/admin/clientes", label: "Clientes", icon: "○" }, { href: "/admin/instalaciones", label: "Instalaciones", icon: "⌁" }, { href: "/admin/garantias", label: "Garantías y reclamos", icon: "!" }] },
  { label: "Catálogo", icon: "◇", items: [{ href: "/admin/productos", label: "Productos", icon: "◇" }, { href: "/admin/inventario", label: "Inventario", icon: "≡" }, { href: "/admin/compatibilidades", label: "Compatibilidades", icon: "⌘" }] },
  { label: "Tienda y marketing", icon: "✦", items: [{ href: "/admin/home", label: "Página web / Home", icon: "⌂" }, { href: "/admin/promociones", label: "Promociones", icon: "✦" }, { href: "/admin/galeria", label: "Galería", icon: "▣" }, { href: "/admin/music", label: "DCL Music", icon: "♫" }, { href: "/admin/vehiculos", label: "Tarjetas de vehículos", icon: "▱" }] },
  { label: "Gestión", icon: "↗", items: [{ href: "/admin/finanzas", label: "Finanzas", icon: "$" }, { href: "/admin/analitica", label: "Analítica", icon: "↗" }] },
  { label: "Administración", icon: "⚙", items: [{ href: "/admin/usuarios", label: "Usuarios", icon: "○" }, { href: "/admin/configuracion", label: "Configuración", icon: "⚙" }] },
];
const frequent = [{ href: "/admin", label: "Inicio", icon: "⌂" }, { href: "/admin/pedidos", label: "Pedidos", icon: "□" }, { href: "/admin/ventas", label: "Ventas", icon: "↗" }];
const account = { href: "/admin/mi-cuenta", label: "Mi cuenta", icon: "○" };
type NavigationItem = typeof account;

function NavigationLink({ item, close }: { item: NavigationItem; close?: () => void }) {
  const active = usePathname() === item.href;
  return <Link href={item.href} onClick={close} aria-current={active ? "page" : undefined} className={`flex min-h-12 min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-red-400 ${active ? "bg-red-600/15 font-bold text-red-200 ring-1 ring-inset ring-red-500/30" : "text-zinc-300 hover:bg-white/5"}`}>
    <span aria-hidden="true" className="w-5 shrink-0 text-center text-base text-red-300">{item.icon}</span><span className="min-w-0 break-words">{item.label}</span>
  </Link>;
}

function NavigationGroups({ close }: { close?: () => void }) {
  const role = useAdminIdentity()?.role;
  const pathname = usePathname();
  const activeGroup = groups.find(group => group.items.some(item => pathname === item.href))?.label;
  const [open, setOpen] = useState<string | null>(activeGroup ?? null);
  useEffect(() => { setOpen(activeGroup ?? null); }, [activeGroup]);
  const visibleGroups = groups.map(group => ({ ...group, items: group.items.filter(item => role && canVisitAdminPage(role, item.href)) })).filter(group => group.items.length);
  return <nav aria-label="Navegación administrativa" className="min-w-0 space-y-2">
    {role && canVisitAdminPage(role, frequent[0].href) && <NavigationLink item={frequent[0]} close={close} />}
    {visibleGroups.map(group => {
      const expanded = open === group.label;
      return <section key={group.label} className="min-w-0 rounded-xl border border-white/10">
        <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : group.label)} className={`flex min-h-12 w-full items-center justify-between gap-2 rounded-xl px-3 py-3 text-left text-sm font-bold outline-offset-2 focus-visible:outline-2 focus-visible:outline-red-400 ${activeGroup === group.label ? "text-red-300" : "text-zinc-300 hover:bg-white/5"}`}>
          <span className="flex min-w-0 items-center gap-3"><span aria-hidden="true" className="w-5 shrink-0 text-center text-base">{group.icon}</span><span className="break-words">{group.label}</span></span><span aria-hidden="true" className="shrink-0">{expanded ? "−" : "+"}</span>
        </button>
        {expanded && <div className="space-y-1 px-2 pb-2">{group.items.map(item => <NavigationLink key={item.href} item={item} close={close} />)}</div>}
      </section>;
    })}
  </nav>;
}

function AccountUtilities({ close, logout }: { close?: () => void; logout: () => Promise<void> }) {
  const identity = useAdminIdentity();
  return <div className="mt-5 min-w-0 border-t border-white/10 pt-4">
    {identity && <><p className="mb-2 px-3 text-sm"><b className="block break-words text-white">{identity.name}</b><span className="text-xs text-zinc-400">{identity.role === "ADMIN" ? "Administrador" : "Vendedor"}</span></p>
      {canVisitAdminPage(identity.role, account.href) && <NavigationLink item={account} close={close} />}</>}
    <button type="button" onClick={() => { close?.(); void logout(); }} className="min-h-12 w-full rounded-xl px-3 py-3 text-left text-sm font-semibold text-red-400 hover:bg-red-500/10 focus-visible:outline-2 focus-visible:outline-red-400">Cerrar sesión</button>
  </div>;
}

function MobileNavigation({ close, logout }: { close: () => void; logout: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onResize = () => { if (desktop.matches) close(); };
    desktop.addEventListener("change", onResize);
    onResize();
    return () => {
      desktop.removeEventListener("change", onResize);
      element?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [close]);
  return <dialog ref={dialog} aria-labelledby="admin-navigation-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  }} className="fixed inset-x-3 bottom-3 top-auto m-0 max-h-[85dvh] w-[calc(100%-1.5rem)] max-w-none overflow-y-auto overscroll-contain rounded-3xl border border-white/15 bg-zinc-950 p-0 text-white shadow-2xl backdrop:bg-black/75 lg:hidden">
    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/10 bg-zinc-950 px-4 py-3">
      <h2 id="admin-navigation-title" className="min-w-0 font-bold">Más funciones</h2><button type="button" autoFocus onClick={close} className="min-h-12 shrink-0 rounded-full border border-white/15 px-4 text-sm focus-visible:outline-2 focus-visible:outline-red-400">Cerrar</button>
    </div>
    <div className="min-w-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><NavigationGroups close={close} /><AccountUtilities close={close} logout={logout} /></div>
  </dialog>;
}

export function AdminSidebar() {
  const identity = useAdminIdentity();
  const pathname = usePathname(), router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const close = useCallback(() => setMoreOpen(false), []);
  useEffect(() => { close(); }, [pathname, close]);
  const logout = async () => { await fetch("/api/admin/logout", { method: "POST" }); router.push("/admin/login"); router.refresh(); };
  const visibleFrequent = frequent.filter(item => identity && canVisitAdminPage(identity.role, item.href));
  return <>
    <aside className="hidden w-72 shrink-0 rounded-3xl border border-white/10 bg-zinc-950/80 p-4 lg:sticky lg:top-4 lg:block lg:h-fit" aria-label="Panel administrativo">
      <div className="mb-5 flex items-center gap-3 border-b border-white/10 pb-4"><div className="flex h-11 w-11 items-center justify-center rounded-full border border-red-500/60 bg-red-600/10 text-xs font-black text-red-400">DCL</div><div><small className="uppercase tracking-[.2em] text-zinc-400">Cree LED</small><b className="block text-lg">Panel</b></div></div>
      <NavigationGroups /><AccountUtilities logout={logout} />
    </aside>
    <nav aria-label="Accesos rápidos administrativos" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-zinc-950/95 px-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden">
      <div className="mx-auto grid max-w-md grid-cols-4 gap-1">{visibleFrequent.map(item => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} className={`flex min-h-12 min-w-0 flex-col items-center justify-center rounded-xl text-xs font-bold focus-visible:outline-2 focus-visible:outline-red-400 ${pathname === item.href ? "bg-red-600/15 text-red-200 ring-1 ring-inset ring-red-500/30" : "text-zinc-400"}`}><span aria-hidden="true" className="text-lg">{item.icon}</span>{item.label}</Link>)}
        <button type="button" aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)} className="flex min-h-12 flex-col items-center justify-center rounded-xl text-xs font-bold text-zinc-300 focus-visible:outline-2 focus-visible:outline-red-400"><span aria-hidden="true" className="text-lg">•••</span>Más</button>
      </div>
    </nav>
    {moreOpen && <MobileNavigation close={close} logout={logout} />}
  </>;
}
