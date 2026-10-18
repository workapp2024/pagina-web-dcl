import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminIdentity } from "@/lib/admin-auth";
import { getWholesaleReceipt } from "@/lib/store/wholesale-receipt";
import { OrderReceipt } from "@/components/admin/OrderReceipt";
import { ReceiptPrintButton } from "@/components/admin/ReceiptPrintButton";
import { ReceiptShareButton } from "@/components/admin/ReceiptShareButton";
import styles from "@/app/admin/pedidos/[orderNumber]/comprobante/comprobante.module.css";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Comprobante mayorista | DCL Cree LED",robots:{index:false,follow:false}};
export default async function WholesaleReceiptPage({params}:{params:Promise<{id:string}>}){
  if((await getAdminIdentity())?.role!=="ADMIN")redirect('/admin/login');
  const {id}=await params,result=await getWholesaleReceipt(id);
  return <main className={styles.page}><div className={styles.controls}><Link href="/admin/mayoristas/pedidos">← Volver a Pedidos</Link>{result.status==='ok'&&<><ReceiptShareButton receipt={result.receipt} source={`/api/admin/wholesale-orders/${id}/receipt`}/><ReceiptPrintButton/></>}</div>{result.status==='ok'?<><p className={styles.printHelp}>Compartí el PDF o descargalo para enviarlo desde tu teléfono. También podés usar Imprimir / Guardar PDF. Una copia guardada no se actualiza automáticamente.</p><OrderReceipt receipt={result.receipt}/></>:<section role="alert" className={styles.incident}><h1>Comprobante no disponible</h1><p>{result.message}</p></section>}</main>;
}
