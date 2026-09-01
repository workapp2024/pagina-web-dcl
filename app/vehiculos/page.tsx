import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { WhatsAppButton } from "@/components/ui/WhatsAppButton";
import { SiteContentProvider } from "@/components/providers/SiteContentProvider";
import { VehicleFinder } from "@/components/public/VehicleFinder";
import { getSupabaseProducts } from "@/lib/supabase/products";

export const revalidate = 60;

export const metadata = {
  title: "Encontrá el LED para tu vehículo | DCL Cree LED",
  description: "Buscá por marca, modelo y año o directamente por conector (H1, H4, H7, H11...) y encontrá el LED compatible con tu vehículo.",
};

export default async function VehiculosPage() {
  const products = await getSupabaseProducts();

  return (
    <SiteContentProvider initialProducts={products ?? undefined}>
      <div className="min-h-screen bg-black text-white">
        <Header />

        <main>
          <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
            <div className="mb-8 max-w-2xl">
              <span className="mb-3 inline-block rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-red-400">
                Buscador de LED
              </span>
              <h1 className="text-3xl font-black uppercase tracking-[-0.06em] text-white md:text-4xl">
                Encontrá el LED para tu vehículo
              </h1>
              <p className="mt-3 text-sm leading-6 text-zinc-400">
                Elegí tu vehículo, escribí directamente el conector, o consultanos por WhatsApp si no estás seguro.
              </p>
            </div>

            <VehicleFinder />
          </section>
        </main>

        <Footer />
        <WhatsAppButton floating />
      </div>
    </SiteContentProvider>
  );
}
