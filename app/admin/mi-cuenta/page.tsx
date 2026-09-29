import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminIdentity } from "@/lib/admin-auth";
import { MyAccount } from "@/components/admin/MyAccount";

export default async function MyAccountPage() {
  const identity = await getAdminIdentity();
  if (!identity) redirect("/admin/login");
  if (identity.legacy) return <div className="space-y-4"><h1 className="text-2xl font-black">Mi cuenta</h1><p>El acceso anterior no tiene una cuenta personal. Creá el administrador principal desde Usuarios o ingresá con tu email.</p><Link href="/admin/usuarios" className="text-red-300">Ir a Usuarios</Link></div>;
  return <MyAccount />;
}
