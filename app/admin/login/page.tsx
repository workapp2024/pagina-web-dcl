import { AdminLoginForm } from "@/components/admin/AdminLoginForm";
import { legacyAdminEnabled } from "@/lib/admin-auth";

export default function AdminLoginPage() {
  return <AdminLoginForm legacyEnabled={legacyAdminEnabled()} />;
}
