import { redirect } from "next/navigation";
import { getAdminIdentity, isAdminAuthenticated } from "@/lib/admin-auth";
import { adminChannels, selectedAdminChannel } from "@/lib/admin-channels";
import { AdminChannelNav } from "@/components/admin/AdminChannelNav";
import RetailOrders from "@/app/admin/pedidos/page";
import WholesaleOrders from "@/app/admin/pedidos-mayoristas/page";

export default async function Page({ searchParams }: { searchParams: Promise<{ canal?: string | string[] }> }) {
  if (!(await isAdminAuthenticated("commercial"))) redirect("/admin/login");
  const identity = await getAdminIdentity();
  if (!identity) redirect("/admin/login");
  const channel = selectedAdminChannel((await searchParams).canal, identity.role, false);
  return <><AdminChannelNav path="/admin/gestion/pedidos" selected={channel} channels={adminChannels(identity.role, false)} description="Consultá un canal por vez. Cada listado conserva sus pagos, entregas, búsquedas e historial." />{channel === "wholesale" ? <WholesaleOrders /> : <RetailOrders />}</>;
}
