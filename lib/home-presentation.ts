export type FaqItem = { id: string; question: string; answer: string; enabled: boolean };
export type HomePresentation = { faqEnabled: boolean; faqItems: FaqItem[]; homePaymentEnabled: boolean; homePaymentTitle: string; homePaymentImage: string };
export const defaultHomePresentation: HomePresentation = { faqEnabled: false, faqItems: [], homePaymentEnabled: false, homePaymentTitle: "Medios de pago", homePaymentImage: "" };

export function validateHomePresentation(value: unknown): HomePresentation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Revisá la configuración de la Home.");
  const v = value as Record<string, unknown>;
  if (typeof v.faqEnabled !== "boolean" || typeof v.homePaymentEnabled !== "boolean" || !Array.isArray(v.faqItems) || v.faqItems.length > 30) throw Error("Revisá la visibilidad y las preguntas (máximo 30).");
  if (typeof v.homePaymentTitle !== "string" || !v.homePaymentTitle.trim() || v.homePaymentTitle.length > 150) throw Error("Escribí un título de hasta 150 caracteres.");
  if (typeof v.homePaymentImage !== "string" || v.homePaymentImage.length > 2000) throw Error("Revisá la imagen de medios de pago.");
  const src = v.homePaymentImage.trim();
  if (src) { let url; try { url = new URL(src); } catch { throw Error("La imagen debe estar guardada en una dirección HTTPS."); } if (url.protocol !== "https:" || url.username || url.password) throw Error("La imagen debe usar HTTPS."); }
  const ids = new Set<string>();
  const faqItems = v.faqItems.map((item: unknown): FaqItem => {
    if (!item || typeof item !== "object") throw Error("Pregunta no válida.");
    const f = item as Record<string, unknown>;
    if (typeof f.id !== "string" || !/^[\w-]{1,80}$/.test(f.id) || ids.has(f.id) || typeof f.enabled !== "boolean" || typeof f.question !== "string" || typeof f.answer !== "string" || !f.question.trim() || !f.answer.trim() || f.question.length > 250 || f.answer.length > 3000) throw Error("Completá cada pregunta y respuesta, sin repetir preguntas identificadas.");
    ids.add(f.id);
    return { id: f.id, question: f.question.trim(), answer: f.answer.trim(), enabled: f.enabled };
  });
  return { faqEnabled: v.faqEnabled, faqItems, homePaymentEnabled: v.homePaymentEnabled, homePaymentTitle: v.homePaymentTitle.trim(), homePaymentImage: src };
}

export function readHomePresentation(row: Record<string, unknown> | null | undefined): HomePresentation {
  try { return validateHomePresentation({ faqEnabled: row?.faq_enabled ?? false, faqItems: row?.faq_items ?? [], homePaymentEnabled: row?.home_payment_enabled ?? false, homePaymentTitle: row?.home_payment_title ?? "Medios de pago", homePaymentImage: row?.home_payment_image ?? "" }); }
  catch { return { ...defaultHomePresentation, faqItems: [] }; }
}
