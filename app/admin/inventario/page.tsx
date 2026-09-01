import { redirect } from "next/navigation";

import { AdminInventoryManager } from "@/components/admin/InventoryManager";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export default async function AdminInventarioPage() {
  if (!(await isAdminAuthenticated())) redirect("/admin/login");
  return <AdminInventoryManager />;
}
