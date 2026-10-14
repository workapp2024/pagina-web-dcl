import { redirect } from "next/navigation";
import { getAdminIdentity, isAdminAuthenticated } from "@/lib/admin-auth";
import { FinanceOverview } from "@/components/admin/FinanceOverview";
export default async function Page() {
  if ((await getAdminIdentity())?.role !== "ADMIN") redirect("/admin");
  if (!(await isAdminAuthenticated())) redirect("/admin/login");
  return <FinanceOverview sector="mayoristas" />;
}
