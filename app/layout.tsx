import type { Metadata } from "next";
import { CartProvider } from "@/components/store/CartProvider";
import "./globals.css";

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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es-AR"
      className="h-full antialiased"
    >
      <body className="min-h-full bg-black text-white"><CartProvider>{children}</CartProvider></body>
    </html>
  );
}
