import { CustomersManager } from "@/components/admin/CustomersManager";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { redirect } from "next/navigation";

export default async function Page() {
  
  if (!(await isAdminAuthenticated("commercial"))) redirect("/admin/login");
  return <CustomersManager sector="retail" />;
}
