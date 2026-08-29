import { defaultSiteContent, type SiteContent } from "@/lib/site-data";
import { sanitizeStoredImageUrl } from "@/lib/supabase/storage";

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
        ? storedProducts.map((product) => {
            const defaultProduct = defaultSiteContent.products.find((item) => item.id === product.id);
            return {
              ...defaultProduct,
              ...product,
              image: sanitizeStoredImageUrl(product.image) || defaultProduct?.image || "",
              ctaText: product.ctaText ?? "VER PRODUCTO",
            };
          })
        : defaultSiteContent.products,
      promotions: parsed.promotions?.length
        ? parsed.promotions.map((promotion) => {
            const defaultPromotion = defaultSiteContent.promotions.find((item) => item.id === promotion.id);
            return {
              ...promotion,
              image: sanitizeStoredImageUrl(promotion.image) || defaultPromotion?.image || "",
            };
          })
        : defaultSiteContent.promotions,
      vehicleCategories: storedVehicles.length
        ? storedVehicles.map((vehicle) => {
            const defaultVehicle = defaultSiteContent.vehicleCategories.find((item) => item.id === vehicle.id);
            return {
              ...defaultVehicle,
              ...vehicle,
              image: sanitizeStoredImageUrl(vehicle.image) || defaultVehicle?.image || "",
              description: vehicle.description ?? "Iluminación para tu vehículo.",
            };
          })
        : defaultSiteContent.vehicleCategories,
      siteSettings: {
        ...defaultSiteContent.siteSettings,
        ...parsed.siteSettings,
        logo: sanitizeStoredImageUrl(parsed.siteSettings?.logo) || defaultSiteContent.siteSettings.logo,
        heroImage: sanitizeStoredImageUrl(parsed.siteSettings?.heroImage) || defaultSiteContent.siteSettings.heroImage,
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
