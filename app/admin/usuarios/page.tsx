import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { UsersManager } from "@/components/admin/UsersManager";

export default async function UsersPage() {
  if (!(await isAdminAuthenticated())) redirect("/admin/login");
  return <UsersManager />;
}
