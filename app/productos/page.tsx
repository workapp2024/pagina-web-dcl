import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { WhatsAppButton } from "@/components/ui/WhatsAppButton";
import { ProductCatalog } from "@/components/public/ProductCatalog";
import { SiteContentProvider } from "@/components/providers/SiteContentProvider";
import { getSupabaseProducts } from "@/lib/supabase/products";

export const revalidate = 60;

export const metadata = {
  title: "Productos | DCL Cree LED",
  description: "Catálogo completo de iluminación CREE LED para autos, camionetas, motos y vehículos de trabajo.",
};

export default async function ProductosPage() {
  const products = await getSupabaseProducts();
  const activeProducts = (products ?? []).filter((product) => product.active && product.showInCatalog);

  return (
    <SiteContentProvider initialProducts={products ?? undefined}>
      <div className="min-h-screen bg-black text-white">
        <Header />

        <main>
          <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
            <div className="mb-10 max-w-2xl">
              <span className="mb-3 inline-block rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-red-400">
                Catálogo completo
              </span>
              <h1 className="text-3xl font-black uppercase tracking-[-0.06em] text-white md:text-4xl">
                Productos
              </h1>
              <p className="mt-3 text-sm leading-6 text-zinc-400">
                Iluminación CREE LED para autos, camionetas, motos y vehículos de trabajo. ¿No sabés cuál elegir?
                Buscá por tu vehículo o por conector en la sección Vehículos.
              </p>
            </div>

            {activeProducts.length === 0 ? (
              <p className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-400">
                Todavía no hay productos cargados.
              </p>
            ) : (
              <ProductCatalog products={activeProducts} />
            )}
          </section>
        </main>

        <Footer />
        <WhatsAppButton floating />
      </div>
    </SiteContentProvider>
  );
}
