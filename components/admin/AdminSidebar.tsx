"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const items = [
  { href: "/admin", label: "Resumen" },
  { href: "/admin/productos", label: "Productos" },
  { href: "/admin/promociones", label: "Promociones" },
  { href: "/admin/vehiculos", label: "Vehículos" },
  { href: "/admin/home", label: "Home" },
  { href: "/admin/configuracion", label: "Configuración" },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  };

  return (
    <aside className="w-full rounded-3xl border border-white/10 bg-zinc-950/80 p-4 lg:w-72">
      <div className="mb-6 flex items-center gap-3 border-b border-white/10 pb-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-red-500/60 bg-red-600/10 text-xs font-black uppercase tracking-[0.18em] text-red-400">
          DCL
        </div>
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.28em] text-zinc-400">Cree LED</div>
          <div className="text-lg font-black uppercase tracking-[-0.06em] text-white">Panel</div>
        </div>
      </div>

      <nav className="space-y-2">
        {items.map((item) => {
          const active = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "block rounded-2xl border px-4 py-3 text-sm font-semibold transition",
                active
                  ? "border-red-500/60 bg-red-600/15 text-red-200"
                  : "border-white/10 bg-white/0 text-zinc-300 hover:border-red-500/30 hover:text-white",
              ].join(" ")}
            >
              {item.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={handleLogout}
          className="w-full text-left rounded-2xl border border-white/10 bg-white/0 px-4 py-3 text-sm font-semibold text-red-400 transition hover:border-red-500/40 hover:bg-red-500/10"
        >
          Cerrar sesión
        </button>
      </nav>
    </aside>
  );
}
