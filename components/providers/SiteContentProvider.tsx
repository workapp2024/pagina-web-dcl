"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { defaultSiteContent, type Product, type SiteContent } from "@/lib/site-data";
import { getStoredSiteContent, saveSiteContent } from "@/lib/content-store";
import { getSupabaseProducts } from "@/lib/supabase/products";
import { getSupabasePromotions } from "@/lib/supabase/promotions";
import { getSupabaseVehicleCategories } from "@/lib/supabase/vehicle-categories";
import { getSupabaseSiteSettings } from "@/lib/supabase/site-settings";
import { getSupabaseHomeSettings } from "@/lib/supabase/home-settings";
import { DEFAULT_THEME, isThemePreset } from "@/lib/theme";

type SiteContentUpdater = SiteContent | ((previous: SiteContent) => SiteContent);

type SiteContentContextValue = {
  content: SiteContent;
  setContent: (updater: SiteContentUpdater) => void;
};

const SiteContentContext = createContext<SiteContentContextValue | undefined>(undefined);

type SiteContentProviderProps = {
  children: ReactNode;
  /** Productos ya consultados en el servidor (Supabase) para evitar el flash de contenido de ejemplo. */
  initialProducts?: Product[];
};

export function SiteContentProvider({ children, initialProducts }: SiteContentProviderProps) {
  const [content, setContent] = useState<SiteContent>(() =>
    initialProducts && initialProducts.length > 0
      ? { ...defaultSiteContent, products: initialProducts }
      : defaultSiteContent,
  );
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const initialContent = getStoredSiteContent();
    // Fusión única post-hidratación con el cache local; evita el mismatch de SSR vs. localStorage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContent((previous) => ({
      ...initialContent,
      products: initialProducts && initialProducts.length > 0 ? previous.products : initialContent.products,
    }));
    setIsHydrated(true);

    let isMounted = true;

    // Si ya llegaron productos frescos desde el servidor, evitamos la segunda consulta cliente.
    const productsPromise = initialProducts && initialProducts.length > 0
      ? Promise.resolve(null)
      : getSupabaseProducts();

    productsPromise.then((remoteProducts) => {
      if (isMounted && remoteProducts && remoteProducts.length > 0) {
        setContent((previous) => ({
          ...previous,
          products: remoteProducts,
        }));
      }
    });

    getSupabasePromotions().then((remotePromotions) => {
      if (isMounted && remotePromotions && remotePromotions.length > 0) {
        setContent((previous) => ({
          ...previous,
          promotions: remotePromotions,
        }));
      }
    });

    getSupabaseVehicleCategories().then((remoteVehicles) => {
      if (isMounted && remoteVehicles && remoteVehicles.length > 0) {
        setContent((previous) => ({
          ...previous,
          vehicleCategories: remoteVehicles,
        }));
      }
    });

    getSupabaseSiteSettings().then((remoteSite) => {
      if (isMounted && remoteSite && Object.keys(remoteSite).length > 0) {
        setContent((previous) => ({
          ...previous,
          siteSettings: {
            ...previous.siteSettings,
            ...remoteSite,
          },
        }));
      }
    });

    getSupabaseHomeSettings().then((remoteHome) => {
      if (isMounted && remoteHome && Object.keys(remoteHome).length > 0) {
        setContent((previous) => ({
          ...previous,
          siteSettings: {
            ...previous.siteSettings,
            ...remoteHome,
          },
        }));
      }
    });

    return () => {
      isMounted = false;
    };
  }, [initialProducts]);

  useEffect(() => {
    document.documentElement.dataset.theme = isThemePreset(content.siteSettings.themePreset)
      ? content.siteSettings.themePreset
      : DEFAULT_THEME;
  }, [content.siteSettings.themePreset]);

  useEffect(() => {
    if (isHydrated) saveSiteContent(content);
  }, [content, isHydrated]);

  const value = useMemo<SiteContentContextValue>(
    () => ({
      content,
      setContent: (updater: SiteContentUpdater) =>
        setContent((previous) =>
          typeof updater === "function" ? updater(previous) : updater,
        ),
    }),
    [content],
  );

  return <SiteContentContext.Provider value={value}>{children}</SiteContentContext.Provider>;
}

export function useSiteContent() {
  const context = useContext(SiteContentContext);

  if (!context) {
    throw new Error("useSiteContent must be used inside SiteContentProvider");
  }

  return context;
}
