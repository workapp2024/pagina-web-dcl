export type WholesaleCustomerOrderItem = {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  currency: string;
};

export type WholesaleCustomerOrder = {
  whatsapp?: string | null;
  transfer_notices?: import("@/lib/wholesale-payment-notices").TransferNotice[];
  payment_summary?: import("@/lib/wholesale-customer-payment").CustomerPaymentSummary | null;
  id: string;
  order_number: string;
  status: string;
  created_at: string;
  confirmed_at: string | null;
  total_amount: number | null;
  currency: string;
  revision_id?: string;
  revision_version?: number;
  revision_status?: string;
  requires_customer_approval?: boolean;
  commercial_conditions?: string;
  items: WholesaleCustomerOrderItem[];
  tracking_events?: { id: string; type: string; at: string }[];
};

export type WholesaleOrderAttempt = {
  attemptId: string;
  status: "open" | "created";
  createdAt: string;
  items: Array<{ productId: string; quantity: number }>;
  order: null | { id: string; orderNumber: string };
};

export type WholesaleCustomerOrderCard = {
  order: WholesaleCustomerOrder;
  recoveryAttempt: WholesaleOrderAttempt | null;
};

export function buildWholesaleCustomerOrderCards(
  orders: WholesaleCustomerOrder[],
  attempts: WholesaleOrderAttempt[],
): WholesaleCustomerOrderCard[] {
  const uniqueOrders = new Map<string, WholesaleCustomerOrderCard>();
  for (const order of orders) {
    if (!uniqueOrders.has(order.id)) uniqueOrders.set(order.id, { order, recoveryAttempt: null });
  }

  for (const attempt of attempts) {
    if (attempt.status !== "created" || !attempt.order?.id) continue;
    const card = uniqueOrders.get(attempt.order.id);
    if (card && !card.recoveryAttempt) card.recoveryAttempt = attempt;
  }

  return [...uniqueOrders.values()];
}

export function getOpenWholesaleAttempts(attempts: WholesaleOrderAttempt[]) {
  return attempts.filter(attempt => attempt.status === "open" && !attempt.order);
}

export function wholesaleOrderStatusLabel(status: string, revisionStatus?: string) {
  if (status === "in_review" && revisionStatus === "approved") return "Propuesta aceptada · pendiente de confirmación DCL";
  if (status === "in_review" && revisionStatus === "rejected") return "Propuesta rechazada · revisión de DCL";
  switch (status) {
    case "received": return "Recibida";
    case "in_review": return "En revisión";
    case "awaiting_customer": return "Propuesta recibida: revisá y respondé";
    case "confirmed": return "Confirmada";
    case "rejected": return "Rechazada";
    case "cancelled": return "Cancelada";
    default: return "Estado actualizado";
  }
}

export function wholesaleOrderNextAction(status: string, revisionStatus?: string) {
  if (status === "in_review" && revisionStatus === "approved") return "Aceptaste esta propuesta. DCL debe confirmar el pedido comercial.";
  if (status === "in_review" && revisionStatus === "rejected") return "Rechazaste la propuesta. DCL puede preparar otra revisión.";
  switch (status) {
    case "received": return "DCL recibió la solicitud y la revisará.";
    case "in_review": return "DCL está revisando la solicitud.";
    case "awaiting_customer": return "Revisá las condiciones y respondé a DCL desde este pedido.";
    case "confirmed": return "Pedido confirmado. Revisá el saldo y las opciones de pago.";
    case "rejected": return "La solicitud fue rechazada. No hay una acción disponible en el portal.";
    case "cancelled": return "La solicitud fue cancelada. No hay una acción disponible en el portal.";
    default: return "Consultá con DCL si necesitás información sobre el próximo paso.";
  }
}

export function isWholesaleOrderActive(status: string) {
  return status !== "rejected" && status !== "cancelled";
}

export function wholesaleSelectionMatchesAttempt(
  selection: Record<string, { quantity: number }>,
  items: Array<{ productId: string; quantity: number }>,
) {
  const selectedItems = Object.entries(selection)
    .map(([productId, item]) => ({ productId, quantity: item.quantity }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
  const attemptItems = [...items].sort((a, b) => a.productId.localeCompare(b.productId));
  return selectedItems.length === attemptItems.length
    && selectedItems.every((item, index) => item.productId === attemptItems[index].productId
      && item.quantity === attemptItems[index].quantity);
}

export function wholesaleSelectionMatchesOrder(
  selection: Record<string, { quantity: number }>,
  items: Array<{ productId: string; quantity: number }>,
) {
  return wholesaleSelectionMatchesAttempt(selection, items);
}

export function recoveredOrderMessage(orderNumber?: string) {
  return orderNumber
    ? `Esta solicitud ya está registrada como ${orderNumber}. No se creó otro pedido; podés consultar su estado en Mis pedidos.`
    : "Esta solicitud ya está registrada. No se creó otro pedido; consultá el historial para ver su estado.";
}

export function newRequestConfirmation(activeOrderNumbers: string[], explicitlyIndependent = false) {
  if (!activeOrderNumbers.length) return null;
  const examples = activeOrderNumbers.slice(0, 3).join(", ");
  const more = activeOrderNumbers.length > 3 ? ` y ${activeOrderNumbers.length - 3} más` : "";
  return explicitlyIndependent
    ? independentOrderConfirmation(activeOrderNumbers)
    : `Ya tenés solicitudes activas${examples ? ` (${examples}${more})` : ""}. Si el carrito coincide con una solicitud anterior, se recuperará esa misma; si es distinto, se enviará como una solicitud independiente. Las solicitudes existentes no cambiarán ni se cancelarán. ¿Querés continuar?`;
}

export function independentOrderConfirmation(activeOrderNumbers: string[]) {
  if (!activeOrderNumbers.length) return null;
  const examples = activeOrderNumbers.slice(0, 3).join(", ");
  const more = activeOrderNumbers.length > 3 ? ` y ${activeOrderNumbers.length - 3} más` : "";
  return `Hay solicitudes activas${examples ? ` (${examples}${more})` : ""}. Se enviará una solicitud nueva e independiente con el carrito actual; las solicitudes existentes no cambiarán ni se cancelarán. ¿Querés continuar?`;
}
