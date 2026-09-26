"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { analyticsEvents, capture } from "@/lib/analytics";
import { ATTEMPT_KEY } from "@/lib/store/checkout-attempt";
import { readStoredCart } from "@/lib/store/cart-persistence";

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
        // A saved attempt represents recovery, not a new checkout entry.
        if (localStorage.getItem(ATTEMPT_KEY)) return;
        const { lines } = readStoredCart(localStorage);
        if (!lines.length) return;
        const productIds = [...new Set(lines.map(item => item.id).filter((id): id is string => typeof id === "string"))];
        capture(analyticsEvents.checkoutStarted, { item_count: lines.reduce((sum, item) => sum + Number(item.quantity || 0), 0), cart_total: lines.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.price || 0), 0), product_ids: productIds });
      } catch { capture(analyticsEvents.checkoutStarted, { item_count: 0, cart_total: 0 }); }
    }
  }, [pathname, searchParams]);
  return null;
}
