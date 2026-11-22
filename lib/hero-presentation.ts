import type { SiteSettings } from "@/lib/site-data";

export function heroFocal(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100 ? value : 50;
}

export function heroImageUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

export function heroPresentation(settings: Partial<SiteSettings>) {
  return {
    desktop: heroImageUrl(settings.heroImage),
    mobile: heroImageUrl(settings.heroMobileImage) || heroImageUrl(settings.heroImage),
    desktopPosition: `${heroFocal(settings.heroFocalX)}% ${heroFocal(settings.heroFocalY)}%`,
    mobilePosition: `${heroFocal(settings.heroMobileFocalX)}% ${heroFocal(settings.heroMobileFocalY)}%`,
  };
}
