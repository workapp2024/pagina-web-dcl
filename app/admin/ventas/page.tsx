import { redirect } from "next/navigation";

import { AdminSalesManager } from "@/components/admin/SalesManager";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export default async function AdminVentasPage() {
  if (!(await isAdminAuthenticated("commercial"))) redirect("/admin/login");
  return <AdminSalesManager />;
}
