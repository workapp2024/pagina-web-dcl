export function wholesalePostingMessage(status?: string | null, account?: string | null) {
  switch (status) {
    case "posted": return `Registrado en Finanzas · Mayoristas${account ? ` · ${account}` : ""}`;
    case "pending_mapping": return "Cobro registrado. Pendiente de imputar: falta configurar la cuenta de este medio en Finanzas. No vuelvas a registrar el pago.";
    case "pending_period": return "Cobro registrado. Pendiente de imputar: revisar la activación y el período abierto en Finanzas. No vuelvas a registrar el pago.";
    case "unsupported_currency": return "Cobro registrado. La moneda no admite imputación automática en Finanzas.";
    case "included_in_opening_balance": return "Incluido en el saldo inicial. No se vuelve a sumar como ingreso.";
    case "neutralized_test_pair": return "Contrarregistro compensado. Sin movimiento de dinero.";
    default: return "No se pudo verificar la imputación financiera. Revisá Finanzas antes de registrar otro pago.";
  }
}
