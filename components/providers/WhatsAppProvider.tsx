"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { configuredWhatsAppNumber, DCL_WHATSAPP_NUMBER } from "@/lib/whatsapp";

const WhatsAppContext = createContext<{ number: string; refresh: (value?: string | null) => void }>({ number: DCL_WHATSAPP_NUMBER, refresh: () => {} });

export function WhatsAppProvider({ configured, children }: { configured?: string | null; children: ReactNode }) {
  const [number, setNumber] = useState(configuredWhatsAppNumber(configured) || DCL_WHATSAPP_NUMBER);
  const refresh = useCallback((value?: string | null) => setNumber(configuredWhatsAppNumber(value) || DCL_WHATSAPP_NUMBER), []);
  return <WhatsAppContext.Provider value={{ number, refresh }}>{children}</WhatsAppContext.Provider>;
}

export function useWhatsAppConfiguration() {
  return useContext(WhatsAppContext);
}
