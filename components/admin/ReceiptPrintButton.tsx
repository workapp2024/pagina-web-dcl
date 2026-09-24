"use client";

import styles from "@/app/admin/pedidos/[orderNumber]/comprobante/comprobante.module.css";

export function ReceiptPrintButton() {
  return <button type="button" className={styles.printButton} onClick={() => window.print()}>Imprimir / Guardar PDF</button>;
}
