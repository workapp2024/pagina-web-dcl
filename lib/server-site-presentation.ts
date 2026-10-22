import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { getSupabaseSiteSettings as readSiteSettings } from "@/lib/supabase/site-settings";
import { getSupabaseHomeSettings } from "@/lib/supabase/home-settings";
import { getSupabasePromotions } from "@/lib/supabase/promotions";
import { getSupabaseVehicleCategories } from "@/lib/supabase/vehicle-categories";
import { defaultSiteContent } from "@/lib/site-data";
import { publicPresentation } from "@/lib/public-site-content";

// Request-scoped memoization: no persisted snapshot or stale-while-revalidate frame.
export const getSupabaseSiteSettings = cache(async () => {
  await connection();
  return readSiteSettings();
});

export const getServerSitePresentation = cache(async () => {
  await connection();
  const [site, home, promotions, vehicleCategories] = await Promise.all([
    getSupabaseSiteSettings(), getSupabaseHomeSettings(),
    getSupabasePromotions(), getSupabaseVehicleCategories(),
  ]);
  return {
    siteSettings: {
      ...defaultSiteContent.siteSettings, ...site, ...publicPresentation(site), ...home,
      // An unavailable image must not reveal an old demo image.
      logo: site?.logo || "",
      heroImage: home?.heroImage || "",
    },
    promotions: promotions ?? [],
    vehicleCategories: vehicleCategories ?? [],
  };
});
