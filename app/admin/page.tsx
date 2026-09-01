import { redirect } from "next/navigation";
import { DashboardManager } from "@/components/admin/DashboardManager";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export default async function AdminHomePage() {
  if (!(await isAdminAuthenticated())) {
    redirect("/admin/login");
  }

  return <DashboardManager />;
  /* return (
    <div>
          <h1 className="text-3xl font-black uppercase tracking-[-0.06em] text-white">Resumen de administración</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">
            Desde acá podés gestionar productos, promociones, vehículos y los textos principales de la Home.
          </p>

          <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-zinc-900 p-5">
              <div className="text-xs uppercase tracking-[0.22em] text-zinc-400">Productos</div>
              <div className="mt-3 text-3xl font-black text-white">5</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-zinc-900 p-5">
              <div className="text-xs uppercase tracking-[0.22em] text-zinc-400">Promociones</div>
              <div className="mt-3 text-3xl font-black text-white">3</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-zinc-900 p-5">
              <div className="text-xs uppercase tracking-[0.22em] text-zinc-400">Vehículos</div>
              <div className="mt-3 text-3xl font-black text-white">4</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-zinc-900 p-5">
              <div className="text-xs uppercase tracking-[0.22em] text-zinc-400">Home</div>
              <div className="mt-3 text-3xl font-black text-white">OK</div>
            </div>
          </div>
    </div>
  ); */
}
