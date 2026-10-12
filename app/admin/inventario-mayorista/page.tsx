import { redirect } from "next/navigation";
import { getAdminIdentity } from "@/lib/admin-auth";
import { WholesaleInventoryManager } from "@/components/admin/WholesaleInventoryManager";

export default async function WholesaleInventoryPage() {
  const identity = await getAdminIdentity();
  if (identity?.role !== "ADMIN") redirect("/admin");
  return <WholesaleInventoryManager />;
}
