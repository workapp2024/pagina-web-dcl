import { redirect } from "next/navigation";
import { getAdminIdentity, isAdminAuthenticated } from "@/lib/admin-auth";
import { SectorHome } from "@/components/admin/SectorHome";
export default async function Page() {
  if (!(await isAdminAuthenticated("commercial"))) redirect("/admin/login");
  if ((await getAdminIdentity())?.role !== "ADMIN") redirect("/admin");
  return <SectorHome sector="mayoristas" />;
}
