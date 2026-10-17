import { isWholesaleOrderActive, wholesaleOrderStatusLabel, type WholesaleCustomerOrder } from "@/lib/wholesale-customer-orders";

export function matchesWholesaleOrder(order: WholesaleCustomerOrder, search: string, status: string) {
  const active = isWholesaleOrderActive(order.status) && !isWholesaleDeliveryComplete(order);
  return order.order_number.toLocaleLowerCase("es-AR").includes(search.trim().toLocaleLowerCase("es-AR"))
    && (status === "all" || (status === "active" ? active
      : status === "history" ? !active : order.status === status));
}

export function isWholesaleDeliveryComplete(order: WholesaleCustomerOrder) {
  return order.tracking_events?.filter(event => ["order_fully_delivered", "order_delivery_completion_reversed"].includes(event.type)).at(-1)?.type === "order_fully_delivered";
}

const eventLabels: Record<string, string> = {
  order_created: "Solicitud recibida", review_started: "En revisión", revision_proposed: "Propuesta enviada",
  revision_approved: "Propuesta aceptada", revision_rejected: "Propuesta rechazada", order_confirmed: "Pedido confirmado",
  order_rejected: "Pedido rechazado", order_cancelled: "Pedido cancelado", delivery_recorded: "Entrega registrada",
  order_fully_delivered: "Entrega completa", order_delivery_completion_reversed: "Entrega completa revertida",
};

export function customerTrackingEvents(order: WholesaleCustomerOrder) {
  if (order.tracking_events?.length) return order.tracking_events.flatMap(event => eventLabels[event.type]
    ? [{id:event.id,label:eventLabels[event.type],at:event.at,terminal:["order_rejected","order_cancelled","revision_rejected","order_delivery_completion_reversed"].includes(event.type)}] : []);
  // Older responses expose these dates only; never invent a date for the current state.
  return [
    { id: "received", label: "Solicitud recibida", at: order.created_at, terminal: false },
    ...(order.confirmed_at ? [{ id: "confirmed", label: "Pedido confirmado", at: order.confirmed_at, terminal: false }] : []),
    ...(order.status !== "received" && !(order.status === "confirmed" && order.confirmed_at)
      ? [{ id: "current", label: wholesaleOrderStatusLabel(order.status, order.revision_status), at: null, terminal: ["cancelled", "rejected"].includes(order.status) }] : []),
  ];
}
