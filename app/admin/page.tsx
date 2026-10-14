import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
export default async function Page() {
  if (!(await isAdminAuthenticated("commercial"))) redirect("/admin/login");
  redirect("/admin/minoristas");
}
