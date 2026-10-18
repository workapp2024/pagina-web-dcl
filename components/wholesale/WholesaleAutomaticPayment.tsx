"use client";
import { useRef, useState } from "react";
import { createClientUuid } from "@/lib/client-uuid";
export function WholesaleAutomaticPayment({orderId,due,pending}:{orderId:string;due:number;pending?:{id:string;amount:number|string;requested_amount:number|null}|null}) {
  const [amount,setAmount]=useState(Number(pending?.amount ?? due).toFixed(2)),[attempt,setAttempt]=useState<{amount:number|null;idempotencyKey:string}|null>(pending ? {amount:pending.requested_amount,idempotencyKey:pending.id} : null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const inFlight=useRef(false);
  async function pay(event:React.FormEvent){
    event.preventDefault();if(inFlight.current)return;
    const value=Number(amount);
    if(!attempt&&(!Number.isFinite(value)||value<=0||value>due||Math.abs(value*100-Math.round(value*100))>0.0001))return;
    inFlight.current=true;setBusy(true);setError("");
    try {
      const payload=attempt??{amount:value,idempotencyKey:createClientUuid()};setAttempt(payload);
      const response=await fetch(`/api/wholesale/orders/${orderId}/checkout`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
      const body=await response.json();if(!response.ok||!body.checkoutUrl)throw Error(body.error||"No pudimos preparar el pago.");
      try { window.sessionStorage.setItem(`dcl.wholesale.payment-return.${orderId}`,payload.idempotencyKey); } catch { /* Optional navigation hint; never payment proof. */ }
      window.location.assign(body.checkoutUrl);
    }catch(cause){setError(cause instanceof Error?cause.message:"Reintentá el mismo pago. No crees otro intento.");}
    finally{inFlight.current=false;setBusy(false);}
  }
  return <form onSubmit={pay} className="space-y-3"><label className="block text-sm">Importe a pagar<input required disabled={busy||Boolean(attempt)} type="number" inputMode="decimal" min="0.01" step="0.01" max={due} value={amount} onChange={e=>setAmount(e.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-white/15 bg-zinc-950 px-3" /></label><button disabled={busy} className="min-h-12 w-full rounded-xl bg-emerald-700 px-4 py-3 font-bold">{busy?"Preparando…":attempt?"Reintentar el mismo pago":"Pagar con Mercado Pago"}</button>{error&&<p role="alert" className="text-sm text-amber-200">{error}</p>}<p className="text-sm text-zinc-400">El pago se confirma cuando Mercado Pago lo aprueba. Mientras esté en proceso, no transfieras ni registres otro cobro.</p></form>;
}
