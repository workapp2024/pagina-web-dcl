import { ConsultationBanner } from "@/components/sections/ConsultationBanner";
import { FeaturedProducts } from "@/components/sections/FeaturedProducts";
import { FinalCTA } from "@/components/sections/FinalCTA";
import { Hero } from "@/components/sections/Hero";
import { NeedCategories } from "@/components/sections/NeedCategories";
import { Promotions } from "@/components/sections/Promotions";
import { VehicleCategories } from "@/components/sections/VehicleCategories";
import { VehicleSelector } from "@/components/sections/VehicleSelector";
import { WhyUs } from "@/components/sections/WhyUs";
import { WorkGallery } from "@/components/sections/WorkGallery";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { WhatsAppButton } from "@/components/ui/WhatsAppButton";
import { SiteContentProvider } from "@/components/providers/SiteContentProvider";
import { getSupabaseProducts } from "@/lib/supabase/products";
import { getPublicGallery } from "@/lib/supabase/gallery";

// Se revalida periódicamente para reflejar altas/bajas de productos hechas desde el panel sin necesidad de un nuevo deploy.
export const revalidate = 60;

export default async function Home() {
  const [products, gallery] = await Promise.all([getSupabaseProducts(), getPublicGallery(16)]);

  return (
    <SiteContentProvider initialProducts={products ?? undefined}>
      <div className="min-h-screen bg-black text-white">
        <Header />

        <main>
          <Hero />
          <VehicleSelector />
          <VehicleCategories />
          <NeedCategories />
          <FeaturedProducts />
          <ConsultationBanner />
          <WhyUs />
          <Promotions />
          <WorkGallery items={gallery} />
          <FinalCTA />
        </main>

        <Footer />
        <WhatsAppButton floating />
      </div>
    </SiteContentProvider>
  );
}
