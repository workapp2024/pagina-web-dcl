import { defaultSiteContent, type SiteContent } from "@/lib/site-data";

export const STORAGE_KEY = "dcl-site-content";

export function getStoredSiteContent(): SiteContent {
  if (typeof window === "undefined") {
    return defaultSiteContent;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return defaultSiteContent;
    }

    const parsed = JSON.parse(raw) as Partial<SiteContent>;
    const storedProducts = parsed.products ?? [];
    const storedVehicles = parsed.vehicleCategories ?? [];

    return {
      ...defaultSiteContent,
      ...parsed,
      products: storedProducts.length
        ? storedProducts.map((product) => ({
            ...defaultSiteContent.products.find((defaultProduct) => defaultProduct.id === product.id),
            ...product,
            ctaText: product.ctaText ?? "VER PRODUCTO",
          }))
        : defaultSiteContent.products,
      promotions: parsed.promotions?.length ? parsed.promotions : defaultSiteContent.promotions,
      vehicleCategories: storedVehicles.length
        ? storedVehicles.map((vehicle) => ({
            ...defaultSiteContent.vehicleCategories.find((defaultVehicle) => defaultVehicle.id === vehicle.id),
            ...vehicle,
            description: vehicle.description ?? "Iluminación para tu vehículo.",
          }))
        : defaultSiteContent.vehicleCategories,
      siteSettings: {
        ...defaultSiteContent.siteSettings,
        ...parsed.siteSettings,
      },
    };
  } catch {
    return defaultSiteContent;
  }
}

export function saveSiteContent(content: SiteContent) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(content));
}
