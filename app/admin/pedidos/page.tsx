import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { OrdersManager } from "@/components/admin/OrdersManager";
export default async function Page(){if(!(await isAdminAuthenticated()))redirect("/admin/login");return <OrdersManager/>}
