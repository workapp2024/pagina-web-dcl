import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getOrderReceipt } from "@/lib/store/order-receipt";
import { withReceiptIdentity } from "@/lib/receipt-identity-server";
import { OrderReceipt } from "@/components/admin/OrderReceipt";
import { ReceiptPrintButton } from "@/components/admin/ReceiptPrintButton";
import { ReceiptShareButton } from "@/components/admin/ReceiptShareButton";
import styles from "./comprobante.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Comprobante de compra | DCL Cree LED", robots: { index: false, follow: false } };

export default async function ReceiptPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  if (!(await isAdminAuthenticated("commercial"))) redirect("/admin/login");
  const { orderNumber } = await params;
  const result = await withReceiptIdentity(await getOrderReceipt(orderNumber));
  return <main className={styles.page}>
    <div className={styles.controls}>
      <Link href="/admin/pedidos">← Volver a Pedidos</Link>
      {result.status === "ok" && <><ReceiptShareButton receipt={result.receipt} source={`/api/admin/orders/${orderNumber}/receipt`} /><ReceiptPrintButton /></>}
    </div>
    {result.status === "ok" ? <>
      <p className={styles.printHelp}>Compartí el PDF o descargalo para enviarlo desde tu teléfono. También podés usar Imprimir / Guardar PDF. Una copia guardada no se actualiza automáticamente.</p>
      <OrderReceipt receipt={result.receipt} />
    </> : <section role="alert" className={styles.incident}>
      <h1>{result.status === "incident" ? "Comprobante pendiente de revisión" : "Comprobante no disponible"}</h1>
      <p>{result.message}</p>
    </section>}
  </main>;
}
