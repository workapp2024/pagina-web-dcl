import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getOrderReceipt } from "@/lib/store/order-receipt";
import { OrderReceipt } from "@/components/admin/OrderReceipt";
import { ReceiptPrintButton } from "@/components/admin/ReceiptPrintButton";
import styles from "./comprobante.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Comprobante de compra | DCL Cree LED", robots: { index: false, follow: false } };

export default async function ReceiptPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  if (!(await isAdminAuthenticated())) redirect("/admin/login");
  const { orderNumber } = await params;
  const result = await getOrderReceipt(orderNumber);
  return <main className={styles.page}>
    <div className={styles.controls}>
      <Link href="/admin/pedidos">← Volver a Pedidos</Link>
      {result.status === "ok" && <ReceiptPrintButton />}
    </div>
    {result.status === "ok" ? <>
      <p className={styles.printHelp}>Para guardar una copia, elegí “Guardar como PDF” en el diálogo de impresión. El estado corresponde a esta consulta; una copia guardada no se actualiza automáticamente.</p>
      <OrderReceipt receipt={result.receipt} />
    </> : <section role="alert" className={styles.incident}>
      <h1>{result.status === "incident" ? "Comprobante pendiente de revisión" : "Comprobante no disponible"}</h1>
      <p>{result.message}</p>
    </section>}
  </main>;
}
