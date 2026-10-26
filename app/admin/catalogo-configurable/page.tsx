import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { CatalogFoundationManager } from "@/components/admin/CatalogFoundationManager";

export default async function CatalogFoundationPage() {
  if (!(await isAdminAuthenticated("admin"))) redirect("/admin/login");
  if (process.env.DCL_CATALOG_ADMIN_ENABLED !== "1") return <section><h1 className="text-2xl font-black">Catálogo configurable</h1><p className="mt-4 text-zinc-300">Esta administración está preparada, pero no habilitada. No afecta al catálogo actual.</p></section>;
  return <CatalogFoundationManager />;
}
