import { redirect } from "next/navigation";
import { getAdminIdentity, isAdminAuthenticated } from "@/lib/admin-auth";
import { adminChannels, selectedAdminChannel } from "@/lib/admin-channels";
import { AdminChannelNav } from "@/components/admin/AdminChannelNav";
import { FinanceOverview } from "@/components/admin/FinanceOverview";

export default async function Page({ searchParams }: { searchParams: Promise<{ canal?: string | string[] }> }) {
  if (!(await isAdminAuthenticated())) redirect("/admin/login");
  const identity = await getAdminIdentity();
  if (identity?.role !== "ADMIN") redirect("/admin/login");
  const channel = selectedAdminChannel((await searchParams).canal, identity.role, true);
  const sector = channel === "all" ? "general" : channel === "retail" ? "minoristas" : "mayoristas";
  return <><AdminChannelNav path="/admin/gestion/finanzas" selected={channel} channels={adminChannels(identity.role, true)} /><FinanceOverview key={sector} sector={sector} /></>;
}
