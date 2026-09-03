"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { analyticsEvents, capture } from "@/lib/analytics";

export function PublicAnalytics() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (pathname.startsWith("/admin")) {
      if (posthog.__loaded) posthog.stopSessionRecording();
      return;
    }
    if (posthog.__loaded) {
      if (pathname.startsWith("/checkout")) posthog.stopSessionRecording();
      else posthog.startSessionRecording();
    }
    capture(analyticsEvents.pageView, { path: pathname });
    if (pathname === "/checkout") {
      try {
        const lines = JSON.parse(localStorage.getItem("dcl-public-cart-v1") || "[]") as { quantity?: number; price?: number }[];
        capture(analyticsEvents.checkoutStarted, { item_count: lines.reduce((sum, item) => sum + Number(item.quantity || 0), 0), cart_total: lines.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.price || 0), 0) });
      } catch { capture(analyticsEvents.checkoutStarted, { item_count: 0, cart_total: 0 }); }
    }
  }, [pathname, searchParams]);
  return null;
}
