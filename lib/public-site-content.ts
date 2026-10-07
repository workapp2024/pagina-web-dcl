import { defaultSiteContent, type SiteSettings } from "@/lib/site-data";

export function publicText(value: string | null | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

// Refresh only presentation fields. Never reset payment, radio or commercial settings.
export const publicPresentationDefaults = {
  logo: defaultSiteContent.siteSettings.logo,
  vehicleSectionTitle: defaultSiteContent.siteSettings.vehicleSectionTitle,
  needsSectionTitle: defaultSiteContent.siteSettings.needsSectionTitle,
  productsSectionTitle: defaultSiteContent.siteSettings.productsSectionTitle,
  promotionsSectionTitle: defaultSiteContent.siteSettings.promotionsSectionTitle,
  whyUsSectionTitle: defaultSiteContent.siteSettings.whyUsSectionTitle,
};

export function publicPresentation(settings: Partial<SiteSettings> | null) {
  return Object.fromEntries(Object.entries(publicPresentationDefaults).map(([key, fallback]) => [
    key, publicText(settings?.[key as keyof typeof publicPresentationDefaults], fallback),
  ])) as typeof publicPresentationDefaults;
}

// Only persisted contact values are public: never expose demo/default contact data.
export function publicContact(settings: Partial<SiteSettings> | null) {
  const email = settings?.email?.trim() || "";
  const phone = settings?.phone?.trim() || "";
  const address = settings?.address?.trim() || "";
  return {
    email: /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) && !/[?&#]/.test(email) ? email : "",
    phone: /^[+\d\s().-]+$/.test(phone) && /\d{3}/.test(phone.replace(/\D/g, "")) ? phone : "",
    address,
  };
}
