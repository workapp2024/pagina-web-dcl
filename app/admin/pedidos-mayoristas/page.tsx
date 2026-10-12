import { redirect } from "next/navigation";
import { getAdminIdentity } from "@/lib/admin-auth";
import { WholesaleOrdersManager } from "@/components/admin/WholesaleOrdersManager";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";

type WholesaleProduct = {
  id: string;
  name: string;
  category: string;
  connectorType: string | null;
  wholesalePrice: number;
};
type WholesaleProductRow = Pick<
  import("@/lib/supabase/database.types").Database["public"]["Tables"]["products"]["Row"],
  "id" | "name" | "category" | "connector_type" | "wholesale_price"
>;

export default async function WholesaleOrdersPage() {
  const identity = await getAdminIdentity();
  if (identity?.role !== "ADMIN") redirect("/admin");

  let products: WholesaleProduct[] = [];
  let catalogError = "";
  if (!isServiceRoleConfigured()) {
    catalogError = "No se pudo cargar el catálogo mayorista. Revisá la configuración del servidor.";
  } else {
    try {
      const { data, error } = await createAdminServerClient()
        .from("products")
        .select("id,name,category,connector_type,wholesale_price")
        .eq("active", true)
        .eq("show_in_catalog", true)
        .gt("wholesale_price", 0)
        .order("name", { ascending: true });
      if (error) throw error;
      const catalogRows = (data ?? []) as unknown as WholesaleProductRow[];
      products = catalogRows.flatMap(product => product.wholesale_price === null ? [] : [{
        id: product.id,
        name: product.name,
        category: product.category,
        connectorType: product.connector_type,
        wholesalePrice: Number(product.wholesale_price),
      }]);
    } catch {
      catalogError = "No se pudo cargar el catálogo mayorista. Recargá la página e intentá nuevamente.";
    }
  }

  return <WholesaleOrdersManager products={products} catalogError={catalogError} />;
}
