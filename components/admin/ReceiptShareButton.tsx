"use client";
import { useRef, useState } from "react";
import type { OrderReceipt } from "@/lib/store/order-receipt";
import styles from "@/app/admin/pedidos/[orderNumber]/comprobante/comprobante.module.css";

export function ReceiptShareButton({receipt,source}:{receipt:OrderReceipt;source?:string}) {
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const inFlight=useRef(false),prepared=useRef<{file:File;at:number;number:string}|null>(null);
  async function act(mode:'share'|'download'){
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setMessage('Generando PDF…');
    try {
      // A second tap must invoke Web Share before ANY await: Safari may discard
      // the user gesture even when awaiting a previously loaded import.
      const ready=prepared.current&&prepared.current.number===receipt.orderNumber&&Date.now()-prepared.current.at<30000?prepared.current.file:null;
      if(mode==='share'&&ready&&navigator.share&&navigator.canShare?.({files:[ready]})){
        setMessage('');await navigator.share({files:[ready],title:`DCL · ${receipt.orderNumber}`});prepared.current=null;return;
      }
      const {createReceiptPdf,downloadReceiptPdf}=await import('@/lib/receipt-pdf');
      let file=ready;
      if(!file){
        if(!source)throw Error('Source unavailable');
        const response=await fetch(source,{cache:'no-store',credentials:'same-origin',redirect:'error'}),body=await response.json();
        if(!response.ok||body.status!=='ok'||body.receipt?.orderNumber!==receipt.orderNumber)throw Error('Receipt unavailable');
        file=await createReceiptPdf(body.receipt);prepared.current={file,at:Date.now(),number:receipt.orderNumber};
      }
      setMessage('');
      if(mode==='download'){downloadReceiptPdf(file);prepared.current=null;return;}
      if(!navigator.share||!navigator.canShare?.({files:[file]})){setMessage('Este navegador no permite compartir archivos. Usá Descargar PDF y compartilo desde tu teléfono.');return;}
      if(navigator.userActivation?.isActive===false){setMessage('PDF listo. Tocá Compartir comprobante para elegir la aplicación.');return;}
      await navigator.share({files:[file],title:`DCL · ${receipt.orderNumber}`});prepared.current=null;
    }catch(error){
      const name=typeof error==='object'&&error!==null&&'name' in error?error.name:'';
      if(name==='AbortError')setMessage('');
      else if(name==='NotAllowedError'&&prepared.current)setMessage('PDF listo. Volvé a tocar Compartir comprobante o usá Descargar PDF.');
      else {prepared.current=null;setMessage('No se pudo preparar el archivo. Volvé a intentarlo o usá Imprimir / Guardar PDF.');}
    }finally{inFlight.current=false;setBusy(false);}
  }
  return <div><div className={styles.controls}><button type="button" disabled={busy} className={styles.printButton} onClick={()=>void act('share')}>{busy?'Generando PDF…':'Compartir comprobante'}</button><button type="button" disabled={busy} className={styles.printButton} onClick={()=>void act('download')}>Descargar PDF</button></div>{message&&<p role="status" aria-live="polite">{message}</p>}</div>;
}
