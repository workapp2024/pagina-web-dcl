export type WholesaleRequestItem = { productId: string; quantity: number };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ITEM_ID_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,63}$/u;

export function isWholesaleUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function parseWholesaleRequestItems(value: unknown): WholesaleRequestItem[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) return null;
  const seen = new Set<string>();
  const items: WholesaleRequestItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const item = entry as Record<string, unknown>;
    if (Object.keys(item).sort().join(",") !== "productId,quantity" || typeof item.productId !== "string"
      || !ITEM_ID_PATTERN.test(item.productId) || !Number.isInteger(item.quantity)
      || Number(item.quantity) < 1 || Number(item.quantity) > 100 || seen.has(item.productId)) return null;
    seen.add(item.productId);
    items.push({ productId: item.productId, quantity: Number(item.quantity) });
  }
  return items;
}

export function wholesaleRpcErrorMessage(message: string) {
  if (message.includes("WHOLESALE_ATTEMPT_CONFLICT")) return { status: 409, error: "Hay una solicitud anterior pendiente. Recuperala o cerrala antes de enviar este carrito." };
  if (message.includes("WHOLESALE_ATTEMPT_ALREADY_CREATED")) return { status: 409, error: "La solicitud ya fue creada y no se puede abandonar." };
  if (message.includes("WHOLESALE_ATTEMPT_ABANDONED")) return { status: 409, error: "Este intento fue cerrado. Iniciá una nueva solicitud." };
  if (message.includes("WHOLESALE_ATTEMPT_NOT_FOUND")) return { status: 404, error: "No encontramos ese intento para esta cuenta." };
  if (message.includes("WHOLESALE_ATTEMPT_NOT_RECOVERABLE")) return { status: 409, error: "El resultado todavía no se puede reconocer." };
  if (message.includes("WHOLESALE_IDEMPOTENCY_CONFLICT")) return { status: 409, error: "La solicitud ya se usó con otros productos. Recuperá el intento o iniciá uno nuevo." };
  if (message.includes("WHOLESALE_PRODUCT_UNAVAILABLE")) return { status: 422, error: "Uno o más productos ya no están disponibles para pedidos mayoristas. Actualizá el catálogo." };
  if (message.includes("WHOLESALE_CUSTOMER_UNAVAILABLE")) return { status: 401, error: "El acceso mayorista ya no está activo. Volvé a ingresar." };
  if (message.includes("WHOLESALE_INVALID_ITEMS") || message.includes("WHOLESALE_INVALID_REQUEST")) return { status: 400, error: "Revisá los productos y las cantidades e intentá nuevamente." };
  return { status: 503, error: "No se pudo procesar la solicitud. Intentá nuevamente." };
}
