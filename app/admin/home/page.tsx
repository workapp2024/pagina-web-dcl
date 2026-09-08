import { AdminHomeEditor } from "@/components/admin/EditorForms";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { redirect } from "next/navigation";
import { PremiumManager } from "@/components/admin/PremiumManager";

export default async function AdminHomePage() {
  if (!(await isAdminAuthenticated())) redirect("/admin/login");
  return <><AdminHomeEditor /><PremiumManager /></>;
}
