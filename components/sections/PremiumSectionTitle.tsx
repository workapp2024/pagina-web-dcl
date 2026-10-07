"use client";

import { useSiteContent } from "@/components/providers/SiteContentProvider";
import { publicText, publicPresentationDefaults } from "@/lib/public-site-content";

export function PremiumSectionTitle() {
  const { content } = useSiteContent();
  return <h2 id="premium-title" className="mt-1 text-3xl font-black uppercase tracking-tight text-white [overflow-wrap:anywhere] sm:text-4xl">{publicText(content.siteSettings?.productsSectionTitle, publicPresentationDefaults.productsSectionTitle)}</h2>;
}
