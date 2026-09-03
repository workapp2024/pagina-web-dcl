import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { OrdersManager } from "@/components/admin/OrdersManager";
import { ManualTransferVerification } from "@/components/admin/ManualTransferVerification";
export default async function Page(){if(!(await isAdminAuthenticated()))redirect("/admin/login");return <div className="space-y-6"><ManualTransferVerification/><OrdersManager/></div>}
