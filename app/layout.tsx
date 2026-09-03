import type { Metadata } from "next";
import { CartProvider } from "@/components/store/CartProvider";
import { RadioProvider } from "@/components/layout/RadioPlayer";
import { defaultSiteContent } from "@/lib/site-data";
import { DEFAULT_RADIO_STATION } from "@/lib/radio-stations";
import { getPublicRadioStations } from "@/lib/supabase/radio-stations";
import { getSupabaseSiteSettings } from "@/lib/supabase/site-settings";
import "./globals.css";
import { Suspense } from "react";
import { PublicAnalytics } from "@/components/analytics/PublicAnalytics";

export const metadata: Metadata = {
  metadataBase: new URL("https://pagina-web-dcl.vercel.app"),
  title: "DCL Cree LED | Iluminación CREE LED para vehículos",
  description:
    "Iluminación CREE LED para autos, camionetas, motos y vehículos. Encontrá la iluminación adecuada para tu vehículo y consultanos por WhatsApp.",
  keywords: [
    "DCL Cree LED",
    "iluminación LED",
    "luces para auto",
    "LED para vehículo",
    "Cree LED",
  ],
  openGraph: {
    title: "DCL Cree LED | Iluminación CREE LED para vehículos",
    description:
      "Iluminación CREE LED para autos, camionetas, motos y vehículos. Encontrá la iluminación adecuada para tu vehículo y consultanos por WhatsApp.",
    type: "website",
    locale: "es_AR",
  },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [remoteSettings, remoteStations] = await Promise.all([getSupabaseSiteSettings(), getPublicRadioStations()]);
  const settings = { ...defaultSiteContent.siteSettings, ...remoteSettings };
  const stations = remoteStations.length ? remoteStations : [{ ...DEFAULT_RADIO_STATION, name: settings.radioName, streamUrl: settings.radioStreamUrl }];
  return (
    <html
      lang="es-AR"
      className="h-full antialiased"
    >
      <body className="min-h-full bg-black text-white"><RadioProvider settings={settings} stations={stations}><CartProvider>{children}</CartProvider></RadioProvider><Suspense><PublicAnalytics/></Suspense></body>
    </html>
  );
}
