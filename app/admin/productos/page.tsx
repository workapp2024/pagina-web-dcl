import { AdminProductsManager } from "@/components/admin/EditorForms";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { redirect } from "next/navigation";

export default async function AdminProductosPage() {
  if (!(await isAdminAuthenticated())) redirect("/admin/login");
  return <AdminProductsManager />;
}
