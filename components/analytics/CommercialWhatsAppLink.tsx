"use client";

import type { ComponentProps } from "react";
import { analyticsEvents, capture, type AnalyticsProperties } from "@/lib/analytics";

export function CommercialWhatsAppLink({ source, analyticsContext, ...props }: Omit<ComponentProps<"a">, "onClick"> & { source: string; analyticsContext?: AnalyticsProperties }) {
  return <a {...props} onClick={() => capture(analyticsEvents.whatsappClick, { ...analyticsContext, source })} />;
}
