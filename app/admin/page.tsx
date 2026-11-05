import { SectorHome } from "@/components/admin/SectorHome";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
export default async function Page() {
  if (!(await isAdminAuthenticated("commercial"))) redirect("/admin/login");
  return <SectorHome />;
}
