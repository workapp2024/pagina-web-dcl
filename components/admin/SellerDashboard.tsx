import Link from "next/link";
import { createAdminServerClient } from "@/lib/supabase/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export async function SellerDashboard() {
  if (!(await isAdminAuthenticated("commercial"))) return null;
  const db = createAdminServerClient();
  const [orders, products] = await Promise.all([
    db.from("orders").select("id", { count: "exact", head: true }).in("operational_status", ["received", "preparing", "ready"]),
    db.from("products").select("id", { count: "exact", head: true }).eq("active", true),
  ]);
  return <div className="space-y-6"><h1 className="text-3xl font-black">Dashboard operativo</h1>
    {orders.error || products.error ? <p role="status">No se pudo actualizar el resumen.</p> : <div className="grid gap-4 sm:grid-cols-2"><p className="rounded-2xl border border-white/10 p-5">Pedidos por preparar o entregar: <b>{orders.count ?? 0}</b></p><p className="rounded-2xl border border-white/10 p-5">Productos activos: <b>{products.count ?? 0}</b></p></div>}
    <nav className="grid gap-3 sm:grid-cols-2">{[["pedidos", "Gestionar pedidos"], ["ventas", "Crear o consultar ventas"], ["clientes", "Clientes"], ["productos", "Mantener catálogo"], ["inventario", "Consultar stock"]].map(([path, label]) => <Link key={path} href={`/admin/${path}`} className="rounded-xl border border-white/10 p-4 hover:border-red-500">{label}</Link>)}</nav>
  </div>;
}
