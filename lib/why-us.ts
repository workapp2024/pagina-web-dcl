export const whyUsIcons = { car: "Auto", bulb: "Lámpara", chat: "Asesoramiento", package: "Paquete", truck: "Envío", shield: "Garantía", tool: "Herramienta" } as const;
export type WhyUsIcon = keyof typeof whyUsIcons;
export type WhyUsCard = { id: string; enabled: boolean; icon: WhyUsIcon; title: string; description: string; order: number };
export const defaultWhyUsCards: WhyUsCard[] = [
  { id: "vehicle", enabled: true, icon: "car", title: "Encontrá la luz para tu vehículo", description: "Buscá por vehículo o por conector y encontrá fácilmente opciones compatibles.", order: 1 },
  { id: "advice", enabled: true, icon: "chat", title: "Asesoramiento antes de comprar", description: "¿No sabés qué lámpara lleva tu vehículo? Te ayudamos a encontrar la indicada.", order: 2 },
  { id: "purchase", enabled: true, icon: "package", title: "Compra simple y segura", description: "Elegí tus productos, coordiná la entrega y contá con nosotros también después de tu compra.", order: 3 },
];

export function validateWhyUsCards(value: unknown): WhyUsCard[] {
  if (!Array.isArray(value) || value.length !== 3) throw new Error("Se requieren exactamente tres tarjetas.");
  const ids = new Set<string>(); const orders = new Set<number>();
  return value.map(card => {
    if (!card || typeof card !== "object" || Array.isArray(card) || Object.keys(card).some(key => !["id", "enabled", "icon", "title", "description", "order"].includes(key))
      || !defaultWhyUsCards.some(item => item.id === card.id) || ids.has(card.id)
      || typeof card.enabled !== "boolean" || typeof card.icon !== "string" || !Object.hasOwn(whyUsIcons, card.icon)
      || typeof card.title !== "string" || !card.title.trim() || card.title.length > 120
      || typeof card.description !== "string" || card.description.length > 600
      || !Number.isInteger(card.order) || card.order < 1 || card.order > 3 || orders.has(card.order)) throw new Error("Revisá las tarjetas: ícono válido, título de hasta 120 caracteres, descripción de hasta 600 y órdenes 1, 2 y 3 sin repetir.");
    ids.add(card.id); orders.add(card.order);
    return { id: card.id, enabled: card.enabled, icon: card.icon as WhyUsIcon, title: card.title.trim(), description: card.description, order: card.order };
  });
}

export function normalizeWhyUsCards(value: unknown): WhyUsCard[] {
  try { return validateWhyUsCards(value); }
  catch { return defaultWhyUsCards.map(card => ({ ...card })); }
}
