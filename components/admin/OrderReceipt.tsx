import Image from "next/image";
import type { OrderReceipt as ReceiptData } from "@/lib/store/order-receipt";
import styles from "@/app/admin/pedidos/[orderNumber]/comprobante/comprobante.module.css";

const date = (value: string) => new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires", dateStyle: "medium", timeStyle: "short", hourCycle: "h23",
}).format(new Date(value));
const states = { valid: "VIGENTE", refunded: "REEMBOLSADO", cancelled: "ANULADO" };

export function OrderReceipt({ receipt }: { receipt: ReceiptData }) {
  const money = (value: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: receipt.currency }).format(value);
  return <article className={styles.receipt} aria-labelledby="receipt-title">
    <header className={styles.header}>
      <div className={styles.brand}><Image src="/brand/logo-dcl.png.png" width={100} height={100} alt="Logo DCL" unoptimized loading="eager" /><p className={styles.company}>DCL Cree LED</p></div>
      <div><h1 id="receipt-title">COMPROBANTE DE COMPRA</h1><p className={styles.nonFiscal}>Comprobante comercial — No es factura fiscal</p></div>
    </header>
    <div className={receipt.status === "valid" ? styles.valid : styles.reversed}>
      <strong>{states[receipt.status]}</strong>
      {receipt.resolvedAt && <span>Resolución registrada: {date(receipt.resolvedAt)} · Argentina</span>}
      {receipt.status !== "valid" && <p>Se conservan los productos e importes originales de la venta.</p>}
    </div>
    <dl className={styles.details}>
      <div><dt>Pedido</dt><dd className={styles.reference}>{receipt.orderNumber}</dd></div>
      <div><dt>Fecha de venta · Argentina</dt><dd>{date(receipt.soldAt)}</dd></div>
      <div><dt>Cliente</dt><dd>{receipt.customerName}</dd></div>
      {receipt.maskedPhone && <div><dt>Teléfono · últimos 4 dígitos</dt><dd>{receipt.maskedPhone}</dd></div>}
    </dl>
    <table className={styles.items}>
      <caption>Detalle de la compra</caption>
      <thead><tr><th scope="col">Producto</th><th scope="col">Cantidad</th><th scope="col">Precio unitario</th><th scope="col">Subtotal</th></tr></thead>
      <tbody>{receipt.items.map((item, index) => <tr key={index}>
        <th scope="row">{item.name}</th><td data-label="Cantidad">{item.quantity}</td>
        <td data-label="Precio unitario">{money(item.unitPrice)}</td><td data-label="Subtotal">{money(item.lineTotal)}</td>
      </tr>)}</tbody>
    </table>
    <div className={styles.summary}>
      <dl className={styles.payment}><div><dt>Medio de pago</dt><dd>{receipt.paymentMethod}</dd></div><div><dt>Estado del pago</dt><dd>{receipt.paymentStatus}</dd></div></dl>
      <div className={styles.total}><span>TOTAL <small>{receipt.currency}</small></span><strong>{money(receipt.total)}</strong></div>
    </div>
    <footer className={styles.footer}><strong>DCL Cree LED</strong><span>WhatsApp: +54 9 261 779-1393</span><p>Comprobante comercial de la venta registrada. No acredita la entrega del pedido.</p></footer>
  </article>;
}
