import { AdminSiteSettingsForm } from "@/components/admin/EditorForms";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { PaymentPresentationSettings, TransferSettings } from "@/components/admin/AppearanceSettings";
import { redirect } from "next/navigation";

export default async function AdminConfiguracionPage() {
  if (!(await isAdminAuthenticated())) redirect("/admin/login");
  return <div className="space-y-6"><TransferSettings /><PaymentPresentationSettings /><AdminSiteSettingsForm /></div>;
}
