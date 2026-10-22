import { FinalCTA } from "@/components/sections/FinalCTA";
import { Hero } from "@/components/sections/Hero";
import { NeedCategories } from "@/components/sections/NeedCategories";
import { Promotions } from "@/components/sections/Promotions";
import { VehicleSelector } from "@/components/sections/VehicleSelector";
import { WhyUs } from "@/components/sections/WhyUs";
import { WorkGallery } from "@/components/sections/WorkGallery";
import { DclMusic } from "@/components/sections/DclMusic";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { WhatsAppButton } from "@/components/ui/WhatsAppButton";
import { SiteContentProvider } from "@/components/providers/ServerSiteContentProvider";
import { getSupabaseProducts } from "@/lib/supabase/products";
import { getPublicGallery } from "@/lib/supabase/gallery";
import { DEFAULT_RADIO_STATION } from "@/lib/radio-stations";
import { getPublicRadioStations } from "@/lib/supabase/radio-stations";
import { EventOnMount } from "@/components/analytics/EventOnMount";
import { analyticsEvents } from "@/lib/analytics";
import { getPremiumProductIds } from "@/lib/supabase/premium";
import { resolvePremiumProducts } from "@/lib/premium";
import { PremiumProducts } from "@/components/sections/PremiumProducts";
import { WholesaleCTA } from "@/components/sections/WholesaleCTA";
import { HomeFaq, HomePaymentImage } from "@/components/sections/HomePresentation";
import { getSupabaseSiteSettings } from "@/lib/server-site-presentation";

// Se revalida periódicamente para reflejar altas/bajas de productos hechas desde el panel sin necesidad de un nuevo deploy.
export const revalidate = 60;

export default async function Home() {
  const [products, gallery, remoteStations, premiumIds, remoteSettings] = await Promise.all([getSupabaseProducts(), getPublicGallery(16), getPublicRadioStations(), getPremiumProductIds(), getSupabaseSiteSettings()]);
  const premiumProducts = resolvePremiumProducts(premiumIds, products ?? []);
  const homePresentation = { faqEnabled: remoteSettings?.faqEnabled ?? false, faqItems: remoteSettings?.faqItems ?? [], homePaymentEnabled: remoteSettings?.homePaymentEnabled ?? false, homePaymentTitle: remoteSettings?.homePaymentTitle ?? "Medios de pago", homePaymentImage: remoteSettings?.homePaymentImage ?? "" };
  const stations = remoteStations.length ? remoteStations : [DEFAULT_RADIO_STATION];

  return (
    <SiteContentProvider initialProducts={products ?? undefined}>
      <div className="min-h-screen bg-black text-white">
        <Header />

        <main>
          <Hero />
          <VehicleSelector homeVisibility />
          <PremiumProducts products={premiumProducts} />
          <Promotions />
          <HomePaymentImage settings={homePresentation} />
          <WholesaleCTA />
          <NeedCategories />
          <WhyUs />
          <DclMusic stations={stations} />
          {gallery.length > 0 && <EventOnMount event={analyticsEvents.galleryView} />}
          <WorkGallery items={gallery} />
          <HomeFaq settings={homePresentation} />
          <FinalCTA />
        </main>

        <Footer />
        <WhatsAppButton floating />
      </div>
    </SiteContentProvider>
  );
}
