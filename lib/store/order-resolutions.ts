import type { OperationalOrder } from "./order-operations";

export const resolutionTypes = [
  "CANCEL_PENDING", "REFUND_VERIFIED", "TRANSFER_APPROVAL_ERROR",
  "COMPLETE_STOCK_UNAVAILABLE", "REFUND_STOCK_UNAVAILABLE",
] as const;
export type ResolutionType = typeof resolutionTypes[number];
export function isResolutionType(value: unknown): value is ResolutionType {
  return typeof value === "string" && resolutionTypes.some(type => type === value);
}
export const resolutionLabels: Record<ResolutionType, string> = {
  CANCEL_PENDING: "Cancelar pedido",
  REFUND_VERIFIED: "Registrar reembolso realizado",
  TRANSFER_APPROVAL_ERROR: "Corregir transferencia confirmada por error",
  COMPLETE_STOCK_UNAVAILABLE: "Completar con stock disponible",
  REFUND_STOCK_UNAVAILABLE: "Registrar reembolso y cerrar incidencia",
};
export const refundResolutions: readonly ResolutionType[] = ["REFUND_VERIFIED", "REFUND_STOCK_UNAVAILABLE"];

export type ResolvableOrder = OperationalOrder & {
  payment_method: string;
  payment: (NonNullable<OperationalOrder["payment"]> & { provider?: string | null }) | null;
};

// Presentation only. resolve_order validates the real state again under locks.
export function availableResolutions(order: ResolvableOrder): ResolutionType[] {
  const payment = order.payment;
  if (!payment || order.operational_status === "delivered") return [];
  if (order.status === "refund_required" && order.operational_status === "cancelled"
    && payment.status === "approved" && payment.provider === "mercadopago" && !payment.sale_id) {
    return ["REFUND_STOCK_UNAVAILABLE"];
  }
  if (order.operational_status === "cancelled") return [];
  if (["pending_payment", "pending_manual_verification", "rejected"].includes(order.status)
    && ["pending", "rejected", "cancelled", "error"].includes(payment.status) && !payment.sale_id) {
    return ["CANCEL_PENDING"];
  }
  if (order.status === "stock_unavailable" && payment.status === "approved"
    && payment.provider === "mercadopago" && !payment.sale_id) {
    return ["COMPLETE_STOCK_UNAVAILABLE", "REFUND_STOCK_UNAVAILABLE"];
  }
  if (order.status === "completed" && payment.status === "approved" && payment.sale_id
    && payment.sale_status === "completed") {
    return order.payment_method === "transfer" && payment.provider === "transfer"
      ? ["REFUND_VERIFIED", "TRANSFER_APPROVAL_ERROR"] : ["REFUND_VERIFIED"];
  }
  return [];
}
