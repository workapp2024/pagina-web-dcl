import ExistingPage from "@/app/admin/pedidos-mayoristas/page";
import { getAdminIdentity } from "@/lib/admin-auth";
import { redirect } from "next/navigation";
export default async function Page() {
  if ((await getAdminIdentity())?.role !== "ADMIN") redirect("/admin");
  return <><p className="mb-4 text-sm text-zinc-400">Mayoristas</p><ExistingPage /></>;
}
