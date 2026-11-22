import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminIdentity, isAdminAuthenticated } from "@/lib/admin-auth";
import { adminChannels, selectedAdminChannel } from "@/lib/admin-channels";
import { AdminChannelNav } from "@/components/admin/AdminChannelNav";
import { AdminProductsManager } from "@/components/admin/EditorForms";
import { AdminInventoryManager } from "@/components/admin/InventoryManager";
import { WholesaleInventoryManager } from "@/components/admin/WholesaleInventoryManager";

export default async function Page({ searchParams }: { searchParams: Promise<{ canal?: string | string[]; vista?: string }> }) {
  const params = await searchParams;
  const stock = params.vista === "stock";
  if (!(await isAdminAuthenticated(stock ? "stock:read" : "catalog"))) redirect("/admin/login");
  const identity = await getAdminIdentity();
  if (!identity) redirect("/admin/login");
  const channel = selectedAdminChannel(params.canal, identity.role, false);
  const linkClass = "inline-flex min-h-12 items-center rounded-xl border border-white/15 px-4 text-sm text-zinc-200 aria-[current=page]:border-red-500 aria-[current=page]:text-red-300";
  return <>
    <nav aria-label="Productos e inventario" className="mb-5 flex flex-wrap gap-2">
      <Link className={linkClass} aria-current={!stock ? "page" : undefined} href="/admin/gestion/catalogo">Productos</Link>
      <Link className={linkClass} aria-current={stock ? "page" : undefined} href={`/admin/gestion/catalogo?vista=stock&canal=${channel}`}>Inventario</Link>
      <Link className={linkClass} href="/admin/compatibilidades">Compatibilidades</Link>
      {identity.role === "ADMIN" && <Link className={linkClass} href="/admin/catalogo-configurable">Categorías y destinos</Link>}
    </nav>
    {stock ? <><AdminChannelNav path="/admin/gestion/catalogo" query={{ vista: "stock" }} selected={channel} channels={adminChannels(identity.role, false)} description="Cada canal conserva sus existencias, reservas e historial por separado." />{channel === "wholesale" ? <WholesaleInventoryManager /> : <AdminInventoryManager />}</> : <><p className="mb-5 text-sm text-zinc-400">Catálogo compartido. Los precios por canal se administran dentro de cada producto.</p><AdminProductsManager /></>}
  </>;
}
