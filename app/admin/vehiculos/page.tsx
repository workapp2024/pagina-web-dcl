import { AdminVehicleManager } from "@/components/admin/EditorForms";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { redirect } from "next/navigation";

export default async function AdminVehiculosPage() {
  if (!(await isAdminAuthenticated())) redirect("/admin/login");
  return <AdminVehicleManager />;
}
