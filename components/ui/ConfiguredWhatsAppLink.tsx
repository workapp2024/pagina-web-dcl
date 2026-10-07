"use client";

import type { ComponentProps } from "react";
import { CommercialWhatsAppLink } from "@/components/analytics/CommercialWhatsAppLink";
import { useWhatsAppConfiguration } from "@/components/providers/WhatsAppProvider";
import { configuredWhatsAppHref } from "@/lib/whatsapp";

/** Only replace the destination number; messages and the existing click tracking stay intact. */
export function ConfiguredWhatsAppLink({ href, ...props }: ComponentProps<typeof CommercialWhatsAppLink>) {
  const { number } = useWhatsAppConfiguration();
  return <CommercialWhatsAppLink {...props} href={configuredWhatsAppHref(href || "", number)} />;
}
