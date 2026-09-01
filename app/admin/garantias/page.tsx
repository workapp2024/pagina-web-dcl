import { redirect } from "next/navigation";

import { WarrantiesManager } from "@/components/admin/WarrantiesManager";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export default async function WarrantiesPage() {
  if (!(await isAdminAuthenticated())) redirect("/admin/login");
  return <WarrantiesManager />;
}
