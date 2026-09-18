import { connection } from "next/server";
import { AdminShell } from "@/components/admin/AdminShell";
import { SiteContentProvider } from "@/components/providers/SiteContentProvider";
import { ADMIN_MAINTENANCE_MESSAGE, isMaintenanceMode } from "@/lib/maintenance-mode";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return (
    <SiteContentProvider>
      <AdminShell>
        {isMaintenanceMode() && (
          <p role="status" className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {ADMIN_MAINTENANCE_MESSAGE}
          </p>
        )}
        {children}
      </AdminShell>
    </SiteContentProvider>
  );
}
