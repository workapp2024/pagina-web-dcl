import type { ReactNode } from "react";
import type { Product } from "@/lib/site-data";
import { getServerSitePresentation } from "@/lib/server-site-presentation";
import { SiteContentProvider as ClientSiteContentProvider } from "./SiteContentProvider";

export async function SiteContentProvider({ children, initialProducts }: { children: ReactNode; initialProducts?: Product[] }) {
  const initialPresentation = await getServerSitePresentation();
  return <ClientSiteContentProvider initialPresentation={initialPresentation} initialProducts={initialProducts}>{children}</ClientSiteContentProvider>;
}
