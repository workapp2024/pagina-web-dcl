import type { CSSProperties } from "react";
import type { SiteSettings } from "@/lib/site-data";
import { heroPresentation } from "@/lib/hero-presentation";
import styles from "./HeroImage.module.css";

export function HeroImage({ settings }: { settings: Partial<SiteSettings> }) {
  const image = heroPresentation(settings);
  if (!image.desktop && !image.mobile) return null;
  return <picture className="block h-full w-full">
    {image.mobile && <source media="(max-width: 767px)" srcSet={image.mobile} />}
    <img src={image.desktop || undefined} alt="" fetchPriority="high" decoding="async"
      className={styles.image}
      style={{ "--hero-desktop-position": image.desktopPosition, "--hero-mobile-position": image.mobilePosition } as CSSProperties} />
  </picture>;
}
