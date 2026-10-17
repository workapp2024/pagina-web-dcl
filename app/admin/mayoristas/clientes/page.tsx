import { CustomersManager } from "@/components/admin/CustomersManager";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getAdminIdentity } from "@/lib/admin-auth";
import { redirect } from "next/navigation";
export default async function Page() {
  if ((await getAdminIdentity())?.role !== "ADMIN") redirect("/admin");
  if (!(await isAdminAuthenticated("commercial"))) redirect("/admin/login");
  return <CustomersManager sector="wholesale" />;
}
