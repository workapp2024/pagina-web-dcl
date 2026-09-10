import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { WhatsAppButton } from "@/components/ui/WhatsAppButton";
import { SiteContentProvider } from "@/components/providers/SiteContentProvider";
import { VehicleSelector } from "@/components/sections/VehicleSelector";
import { getSupabaseProducts } from "@/lib/supabase/products";
import { parseProductFilters, type CatalogParams } from "@/lib/product-filters";

export const revalidate = 60;

export const metadata = {
  title: "Encontrá el LED para tu vehículo | DCL Cree LED",
  description: "Buscá por marca, modelo y año o directamente por conector (H1, H4, H7, H11...) y encontrá el LED compatible con tu vehículo.",
};

export default async function VehiculosPage({ searchParams }: { searchParams: Promise<CatalogParams> }) {
  const context = parseProductFilters(await searchParams);
  const vehicle = context.invalid ? undefined : context.classification.vehicleType;
  const products = await getSupabaseProducts();

  return (
    <SiteContentProvider initialProducts={products ?? undefined}>
      <div className="min-h-screen bg-black text-white">
        <Header />

        <main>
          <VehicleSelector key={vehicle ?? "all"} initialVehicle={vehicle} heading="h1" />
        </main>

        <Footer />
        <WhatsAppButton floating />
      </div>
    </SiteContentProvider>
  );
}
