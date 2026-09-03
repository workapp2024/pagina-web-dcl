import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { SiteContentProvider } from "@/components/providers/SiteContentProvider";
import { CartPageContent } from "@/components/store/CartPageContent";
import { WhatsAppButton } from "@/components/ui/WhatsAppButton";
import { getSupabaseProducts } from "@/lib/supabase/products";

export const revalidate = 60;

export default async function CartPage() {
  const products = await getSupabaseProducts();
  const publicProducts = (products ?? []).filter(product => product.active && product.showInCatalog);
  const categories = [...new Set(publicProducts.map(product => product.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));

  return <SiteContentProvider initialProducts={products ?? undefined}><div className="min-h-screen bg-black text-white"><Header/><CartPageContent categories={categories}/><Footer/><WhatsAppButton floating/></div></SiteContentProvider>;
}
