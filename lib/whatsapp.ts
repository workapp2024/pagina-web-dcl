/** Número oficial de DCL Cree LED. WhatsApp exige dígitos internacionales en wa.me. */
const DCL_WHATSAPP_CONFIGURED_NUMBER = "+54 9 261 779-1393";

export function normalizeWhatsAppNumber(value: string): string {
  return value.replace(/\D/g, "");
}

export const DCL_WHATSAPP_NUMBER = normalizeWhatsAppNumber(DCL_WHATSAPP_CONFIGURED_NUMBER);

export function whatsappUrl(message: string): string {
  return `https://wa.me/${DCL_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export function isWhatsAppUrl(value: string): boolean {
  return /(?:wa\.me|whatsapp\.com)/i.test(value);
}
