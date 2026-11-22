import { redirect } from "next/navigation";
import { getAdminIdentity, isAdminAuthenticated } from "@/lib/admin-auth";
import { adminChannels, selectedAdminChannel } from "@/lib/admin-channels";
import { AdminChannelNav } from "@/components/admin/AdminChannelNav";
import { CustomersManager } from "@/components/admin/CustomersManager";

export default async function Page({ searchParams }: { searchParams: Promise<{ canal?: string | string[] }> }) {
  if (!(await isAdminAuthenticated("commercial"))) redirect("/admin/login");
  const identity = await getAdminIdentity();
  if (!identity) redirect("/admin/login");
  const channel = selectedAdminChannel((await searchParams).canal, identity.role, true);
  return <><AdminChannelNav path="/admin/gestion/clientes" selected={channel} channels={adminChannels(identity.role, true)} /><CustomersManager key={channel} sector={channel} /></>;
}
