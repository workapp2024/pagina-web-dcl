export const operationalLabels = {
  received: "Recibido",
  preparing: "En preparación",
  ready: "Listo para retiro o entrega",
  delivered: "Entregado",
  cancelled: "Cancelado",
} as const;

export type OperationalStatus = keyof typeof operationalLabels;
export function isOperationalStatus(value: unknown): value is OperationalStatus {
  return typeof value === "string" && Object.hasOwn(operationalLabels, value);
}

export const paymentLabels: Record<string, string> = {
  pending: "Pendiente", approved: "Aprobado", rejected: "Rechazado",
  cancelled: "Cancelado", error: "Error", refunded: "Reembolsado",
};
export const paymentMethodLabels: Record<string, string> = {
  card: "Tarjeta", transfer: "Transferencia", mercadopago: "Mercado Pago",
};
export const technicalOrderLabels: Record<string, string> = {
  pending_payment: "Pendiente de pago", pending_manual_verification: "Transferencia a verificar",
  paid: "Pago registrado", completed: "Venta registrada (no acredita entrega)",
  stock_unavailable: "Incidencia de stock / reserva", cancelled: "Cancelación registrada",
  rejected: "Rechazo registrado",
};

export type OperationalOrder = {
  status: string;
  operational_status: OperationalStatus;
  payment: { status: string; sale_id: string | null; sale_status?: string | null } | null;
};

// Sólo presentación. PostgreSQL vuelve a validar bajo bloqueo y consulta TODOS
// los pagos; nunca confía en la elegibilidad calculada en el navegador.
export function operationalActions(order: OperationalOrder) {
  const terminal = ["delivered", "cancelled"].includes(order.operational_status);
  const financialReview = ["paid", "completed"].includes(order.status)
    || Boolean(order.payment?.sale_id)
    || ["approved", "refunded"].includes(order.payment?.status || "");
  const canAdvance = !terminal && ["paid", "completed"].includes(order.status)
    && order.payment?.status === "approved" && Boolean(order.payment.sale_id)
    && order.payment.sale_status === "completed";
  const next: Partial<Record<OperationalStatus, OperationalStatus>> = {
    received: "preparing", preparing: "ready", ready: "delivered",
  };
  const canCancel = !terminal && !financialReview && ["cancelled", "rejected"].includes(order.status)
    && ["cancelled", "rejected", "error"].includes(order.payment?.status || "");
  return { next: canAdvance ? next[order.operational_status] : undefined, canCancel, financialReview, terminal };
}
