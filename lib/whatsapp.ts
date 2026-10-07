/** Número oficial de DCL Cree LED. WhatsApp exige dígitos internacionales en wa.me. */
const DCL_WHATSAPP_CONFIGURED_NUMBER = "+54 9 261 779-1393";

export function normalizeWhatsAppNumber(value: string): string {
  return value.replace(/\D/g, "");
}

export const DCL_WHATSAPP_NUMBER = normalizeWhatsAppNumber(DCL_WHATSAPP_CONFIGURED_NUMBER);

/** Accept only phone numbers or recognized WhatsApp destinations, never arbitrary links. */
export function configuredWhatsAppNumber(value?: string | null): string | null {
  let phone = value?.trim() || "";
  if (!phone) return null;
  if (/^https?:\/\//i.test(phone)) {
    let url: URL;
    try { url = new URL(phone); } catch { return null; }
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (url.hostname === "wa.me") phone = url.pathname.slice(1);
    else if (url.hostname === "api.whatsapp.com" && url.pathname === "/send") phone = url.searchParams.get("phone") || "";
    else return null;
  }
  if (!/^\+?[\d ().-]+$/.test(phone)) return null;
  let number = normalizeWhatsAppNumber(phone);
  // National Argentine mobile numbers need country 54 and the international mobile prefix 9.
  if (number.length === 10 && !phone.startsWith("+")) number = `549${number}`;
  else if (/^54\d{10}$/.test(number)) number = `549${number.slice(2)}`;
  return /^[1-9]\d{7,14}$/.test(number) ? number : null;
}

export function whatsappUrl(message: string, configuredNumber?: string | null): string {
  const number = configuredWhatsAppNumber(configuredNumber) || DCL_WHATSAPP_NUMBER;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

export function configuredWhatsAppHref(href: string, configuredNumber?: string | null): string {
  try {
    const url = new URL(href);
    return whatsappUrl(url.searchParams.get("text") || "", configuredNumber);
  } catch {
    return whatsappUrl("", configuredNumber);
  }
}

export function isWhatsAppUrl(value: string): boolean {
  return /(?:wa\.me|whatsapp\.com)/i.test(value);
}
