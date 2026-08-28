import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://example.com"),
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-black text-white">{children}</body>
    </html>
  );
}
