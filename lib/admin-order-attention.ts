import { operationalActions, operationalLabels, type OperationalOrder } from "@/lib/store/order-operations";
import { wholesaleOrderStatusLabel } from "@/lib/wholesale-customer-orders";

export function retailNextAction(order: OperationalOrder) {
  if (order.status === "refund_required") return "Resolver el reembolso externo y conciliarlo";
  if (order.status === "stock_unavailable") return "Revisar stock y resolver la incidencia";
  if (order.status === "pending_manual_verification") return "Verificar la transferencia recibida";
  const actions = operationalActions(order);
  if (actions.next) return `Continuar: ${operationalLabels[actions.next]}`;
  if (actions.canCancel) return "Revisar la cancelación operativa";
  if (order.status === "pending_payment") return "Esperando el pago del cliente";
  return actions.terminal ? "Sin acción operativa pendiente" : "Revisar la situación del pedido y su pago";
}

export function retailNeedsAttention(order: OperationalOrder) {
  const actions = operationalActions(order);
  return ["refund_required", "stock_unavailable", "pending_manual_verification"].includes(order.status)
    || Boolean(actions.next || actions.canCancel)
    || (!actions.terminal && ["paid", "completed"].includes(order.status));
}

export function wholesaleNextAction(status: string, revisionStatus?: string, deliveryPending = true) {
  if (status === "received") return "Iniciar la revisión de DCL";
  if (status === "in_review" && revisionStatus === "approved") return "Confirmar en DCL la propuesta aceptada por el cliente";
  if (status === "in_review" && revisionStatus === "rejected") return "Revisar la propuesta rechazada por el cliente";
  if (status === "in_review") return "Revisar artículos y condiciones antes de confirmar";
  if (status === "awaiting_customer") return "Esperando respuesta del cliente";
  if (status === "confirmed") return deliveryPending ? "Revisar reservas y completar la entrega pendiente" : "Entrega completa; consultar cobros y saldo en la ficha";
  return "Sin acción comercial pendiente";
}

export function wholesaleNeedsAttention(status: string, deliveryPending = true) {
  return ["received", "in_review"].includes(status) || (status === "confirmed" && deliveryPending);
}

export function wholesaleAdminLabel(status: string, revisionStatus?: string) {
  return status === "awaiting_customer" ? "Esperando respuesta del cliente" : wholesaleOrderStatusLabel(status, revisionStatus);
}
