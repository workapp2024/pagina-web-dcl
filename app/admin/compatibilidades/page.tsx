import { AdminCompatibilityManager } from "@/components/admin/CompatibilityManager";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { redirect } from "next/navigation";

export default async function AdminCompatibilidadesPage() {
  if (!(await isAdminAuthenticated("catalog"))) redirect("/admin/login");
  return <AdminCompatibilityManager />;
}
