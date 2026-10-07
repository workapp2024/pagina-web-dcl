import { AdminHomeEditor } from "@/components/admin/EditorForms";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { redirect } from "next/navigation";
import { PremiumManager } from "@/components/admin/PremiumManager";
import { AppearanceSettings } from "@/components/admin/AppearanceSettings";

export default async function AdminHomePage() {
  if (!(await isAdminAuthenticated())) redirect("/admin/login");
  return <div className="space-y-6"><AdminHomeEditor /><details className="min-w-0 rounded-[1.75rem] border border-white/10 bg-zinc-950/80"><summary className="min-h-12 cursor-pointer rounded-[1.75rem] px-5 py-4 text-lg font-bold text-white [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-red-400 sm:px-6">Apariencia de la tienda</summary><AppearanceSettings /></details><PremiumManager /></div>;
}
