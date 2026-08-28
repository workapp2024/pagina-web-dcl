import { ConsultationBanner } from "@/components/sections/ConsultationBanner";
import { FeaturedProducts } from "@/components/sections/FeaturedProducts";
import { FinalCTA } from "@/components/sections/FinalCTA";
import { Hero } from "@/components/sections/Hero";
import { NeedCategories } from "@/components/sections/NeedCategories";
import { Promotions } from "@/components/sections/Promotions";
import { VehicleCategories } from "@/components/sections/VehicleCategories";
import { VehicleSelector } from "@/components/sections/VehicleSelector";
import { WhyUs } from "@/components/sections/WhyUs";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { WhatsAppButton } from "@/components/ui/WhatsAppButton";
import { SiteContentProvider } from "@/components/providers/SiteContentProvider";

export default function Home() {
  return (
    <SiteContentProvider>
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
          <FinalCTA />
        </main>

        <Footer />
        <WhatsAppButton floating />
      </div>
    </SiteContentProvider>
  );
}
