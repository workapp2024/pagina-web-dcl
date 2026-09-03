import { FeaturedProducts } from "@/components/sections/FeaturedProducts";
import { FinalCTA } from "@/components/sections/FinalCTA";
import { Hero } from "@/components/sections/Hero";
import { NeedCategories } from "@/components/sections/NeedCategories";
import { Promotions } from "@/components/sections/Promotions";
import { VehicleCategories } from "@/components/sections/VehicleCategories";
import { VehicleSelector } from "@/components/sections/VehicleSelector";
import { WhyUs } from "@/components/sections/WhyUs";
import { WorkGallery } from "@/components/sections/WorkGallery";
import { DclMusic } from "@/components/sections/DclMusic";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { WhatsAppButton } from "@/components/ui/WhatsAppButton";
import { SiteContentProvider } from "@/components/providers/SiteContentProvider";
import { getSupabaseProducts } from "@/lib/supabase/products";
import { getPublicGallery } from "@/lib/supabase/gallery";
import { DEFAULT_RADIO_STATION } from "@/lib/radio-stations";
import { getPublicRadioStations } from "@/lib/supabase/radio-stations";
import { EventOnMount } from "@/components/analytics/EventOnMount";
import { analyticsEvents } from "@/lib/analytics";

// Se revalida periódicamente para reflejar altas/bajas de productos hechas desde el panel sin necesidad de un nuevo deploy.
export const revalidate = 60;

export default async function Home() {
  const [products, gallery, remoteStations] = await Promise.all([getSupabaseProducts(), getPublicGallery(16), getPublicRadioStations()]);
  const stations = remoteStations.length ? remoteStations : [DEFAULT_RADIO_STATION];

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
          <WhyUs />
          <Promotions />
          <DclMusic stations={stations} />
          {gallery.length > 0 && <EventOnMount event={analyticsEvents.galleryView} />}
          <WorkGallery items={gallery} />
          <FinalCTA />
        </main>

        <Footer />
        <WhatsAppButton floating />
      </div>
    </SiteContentProvider>
  );
}
