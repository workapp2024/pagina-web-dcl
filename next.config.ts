import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
