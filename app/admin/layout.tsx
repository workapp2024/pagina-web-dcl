import { AdminShell } from "@/components/admin/AdminShell";
import { SiteContentProvider } from "@/components/providers/SiteContentProvider";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SiteContentProvider>
      <AdminShell>{children}</AdminShell>
    </SiteContentProvider>
  );
}
