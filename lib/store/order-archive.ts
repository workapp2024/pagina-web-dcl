// Textos del Admin. La elegibilidad la calcula y valida PostgreSQL.
export const archiveBlockMessages: Record<string, string> = {
  ORDER_NOT_TERMINAL: "Sólo se pueden archivar pedidos entregados o cancelados.",
  ORDER_REQUIRES_ATTENTION: "El pedido todavía requiere atención.",
  PAYMENT_AMBIGUOUS: "Falta un pago identificable o hay varias transacciones. Requiere revisión.",
  PAYMENT_REQUIRES_ATTENTION: "El pago está pendiente, tiene un error o requiere revisión del reembolso.",
  RESERVATION_ACTIVE: "El pedido todavía tiene una reserva vigente.",
  PAYMENT_MISMATCH: "El importe o la moneda del pago no coincide con el pedido.",
  DELIVERY_FINANCIAL_MISMATCH: "La entrega no tiene un pago aprobado y una venta vigente coherentes.",
  CANCELLATION_FINANCIAL_MISMATCH: "La cancelación requiere revisión financiera antes de archivar.",
};
