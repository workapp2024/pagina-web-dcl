import { redirect } from "next/navigation"; import { isAdminAuthenticated } from "@/lib/admin-auth"; import { InstallationsManager } from "@/components/admin/InstallationsManager";
export default async function Page(){if(!(await isAdminAuthenticated()))redirect('/admin/login');return <InstallationsManager/>}
