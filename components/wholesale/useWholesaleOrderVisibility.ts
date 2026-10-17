"use client";
import { useEffect, useState } from "react";

export function useWholesaleOrderVisibility(endpoint: string) {
  const [available,setAvailable]=useState(false);
  const [ids,setIds]=useState<string[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{
    const controller=new AbortController();
    void fetch(endpoint,{cache:"no-store",signal:controller.signal}).then(async response=>{
      const body=await response.json();
      if (!response.ok || !body.ok) throw new Error("No se pudo consultar la visibilidad de los pedidos.");
      if (!controller.signal.aborted && response.ok && body.ok && body.available && Array.isArray(body.ids)) { setIds(body.ids);setAvailable(true); }
    }).catch(()=>{if(!controller.signal.aborted) setError("No se pudo consultar el archivo. Se muestran los pedidos sin ocultarlos.");});
    return ()=>controller.abort();
  },[endpoint]);
  async function setArchived(orderId:string,archived:boolean) {
    if (busy || !available) return false;
    setBusy(true);setError("");
    try {
      const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({orderId,archived})});
      const body=await response.json();
      if (!response.ok || !body.ok) throw new Error(body.message || "No se pudo cambiar la visibilidad del pedido.");
      setIds(current=>archived ? [...new Set([...current,orderId])] : current.filter(id=>id!==orderId));
      return true;
    } catch(cause) {setError(cause instanceof Error ? cause.message : "No se pudo cambiar la visibilidad.");return false;}
    finally {setBusy(false);}
  }
  return {available,ids,busy,error,setArchived};
}
