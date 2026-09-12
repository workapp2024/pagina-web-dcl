import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_ANALYTICS_ENVIRONMENT: process.env.VERCEL_ENV || process.env.NEXT_PUBLIC_ANALYTICS_ENVIRONMENT || (process.env.NODE_ENV === "development" ? "development" : "preview"),
  },
  // Sólo habilita la hidratación desde el Android usado en la LAN de desarrollo.
  allowedDevOrigins: ["192.168.100.3"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
};

export default nextConfig;
