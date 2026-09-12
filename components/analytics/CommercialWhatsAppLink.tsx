"use client";

import type { ComponentProps } from "react";
import { analyticsEvents, capture } from "@/lib/analytics";

export function CommercialWhatsAppLink({ source, ...props }: Omit<ComponentProps<"a">, "onClick"> & { source: string }) {
  return <a {...props} onClick={() => capture(analyticsEvents.whatsappClick, { source })} />;
}
