"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import type { WholesaleCustomerOrder } from "@/lib/wholesale-customer-orders";
import type { TransferNotice } from "@/lib/wholesale-payment-notices";
import { WholesaleAutomaticPayment } from "@/components/wholesale/WholesaleAutomaticPayment";
import { canCoordinateWholesaleDelivery,isWholesaleDeliveryComplete } from "@/lib/wholesale-order-presentation";
import { createClientUuid } from "@/lib/client-uuid";
import { whatsappUrl } from "@/lib/whatsapp";

type Pending={id:string;state:string;amount:number|string;requested_amount:number|null;expires_at:string};
type PaymentData={checkoutEnabled?:boolean;pendingCheckout?:Pending|null;noticesEnabled?:boolean;notices?:TransferNotice[];availableDue?:number;deliveryComplete?:boolean;summary:WholesaleCustomerOrder["payment_summary"];status:string;orderNumber:string;transfer:null|{alias:string;cbuCvu:string;holder:string;institution:string;instructions:string;whatsapp:string}};
const button="min-h-12 w-full rounded-xl border border-white/15 px-4 py-3 text-sm font-bold disabled:opacity-50";
export function WholesaleOrderPayment({order,onUpdated}:{order:WholesaleCustomerOrder;onUpdated?:()=>Promise<unknown>}) {
  const [open,setOpen]=useState(false),[data,setData]=useState<PaymentData|null>(null),[error,setError]=useState("");
  const [choice,setChoice]=useState<"transfer"|"mercadopago"|null>(null),[amount,setAmount]=useState(""),[saving,setSaving]=useState(false);
  const [returned,setReturned]=useState(false);
  const [noticeLocked,setNoticeLocked]=useState(false);
  const [checkedAt,setCheckedAt]=useState(0);
  const pendingId=data?.pendingCheckout?.id;
  const noticeAttempt=useRef<{key:string;amount:number}|null>(null),inFlight=useRef(false),previousPaid=useRef(order.payment_summary?.paid);
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    try {
      const response=await fetch(`/api/wholesale/orders/${order.id}/payment`,{cache:"no-store",signal});
      const body=await response.json();if(!response.ok)throw Error(body.error||"No pudimos actualizar el pago.");
      if(signal?.aborted)return;
      setData(body);setError("");
      setCheckedAt(Date.now());
      try { setReturned(Boolean(window.sessionStorage.getItem(`dcl.wholesale.payment-return.${order.id}`)));if(body.summary?.due===0)window.sessionStorage.removeItem(`dcl.wholesale.payment-return.${order.id}`); } catch { /* Navigation hint only. */ }
      if(body.summary?.paid!==previousPaid.current){previousPaid.current=body.summary?.paid;void onUpdated?.();}
    }catch(cause){if(!signal?.aborted)setError(cause instanceof Error?cause.message:"No pudimos actualizar el pago.");}
  },[order.id,onUpdated]);
  useEffect(()=>{const controller=new AbortController();void Promise.resolve().then(()=>refresh(controller.signal));const focus=()=>void refresh(controller.signal);window.addEventListener("focus",focus);return()=>{controller.abort();window.removeEventListener("focus",focus);};},[refresh]);
  useEffect(()=>{
    if(!pendingId||data?.summary?.due===0)return;
    const controller=new AbortController();let polls=0;
    const timer=setInterval(()=>{if(++polls>12){clearInterval(timer);return;}if(document.visibilityState!=="hidden")void refresh(controller.signal);},10000);
    return()=>{clearInterval(timer);controller.abort();};
  },[pendingId,data?.summary?.due,refresh]);
  const summary=data?data.summary:order.payment_summary;
  const active=(data?.status??order.status)==="confirmed";
  const notices=data?.notices??order.transfer_notices??[],pendingNotices=notices.filter(n=>n.status==="pending");
  const pending=data?.pendingCheckout;
  const available=data?.availableDue??Math.max(0,(summary?.due??0)-pendingNotices.reduce((s,n)=>s+Number(n.amount),0));
  const processing=pending?.state==="pending"||pending?.state==="posting";
  const expired=Boolean(pending&&Date.parse(pending.expires_at)<=checkedAt);
  const money=(n:number)=>new Intl.NumberFormat("es-AR",{style:"currency",currency:order.currency.trim()}).format(n);
  const destination=data?.transfer?.whatsapp??order.whatsapp;
  const coordinate=canCoordinateWholesaleDelivery({...order,status:data?.status??order.status,payment_summary:summary,
    tracking_events:(data?.deliveryComplete??isWholesaleDeliveryComplete(order))?[{id:"current",type:"order_fully_delivered",at:""}]:[]});
  const value=Number(amount),valid=Boolean(summary&&Number.isFinite(value)&&value>0&&value<=available&&Math.abs(value*100-Math.round(value*100))<0.0001);
  const configured=Boolean(data?.transfer?.holder&&(data.transfer.alias||data.transfer.cbuCvu));
  async function notice(action:"inform"|"withdraw",noticeId?:string) {
    if(inFlight.current||(!valid&&!noticeAttempt.current&&action==='inform'))return;
    if(action==='withdraw'&&!window.confirm("¿Confirmás que no enviaste esa transferencia? Si ya transferiste, consultá con DCL antes de pagar otra vez."))return;
    inFlight.current=true;setSaving(true);setError("");
    const whatsapp=action==='inform'?window.open("about:blank","_blank"):null;
    if(whatsapp)whatsapp.opener=null;
    try {
      const attempt=action==='inform'?(noticeAttempt.current??{key:createClientUuid(),amount:value}):{key:createClientUuid(),amount:0};
      if(action==='inform'){noticeAttempt.current=attempt;setNoticeLocked(true);}
      const response=await fetch(`/api/wholesale/orders/${order.id}/transfer-notice`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,key:attempt.key,...(action==='inform'?{amount:attempt.amount}:{noticeId})})});
      const body=await response.json();if(!response.ok||!body.ok)throw Error(body.error||"DCL no recibió el aviso. Reintentá.");
      if(action==='inform'&&body.notice?.status!=='pending')throw Error("Este aviso ya fue resuelto. Actualizá el estado antes de continuar.");
      if(action==='inform'){
        const href=whatsappUrl(`Hola, voy a informar una transferencia del pedido ${data?.orderNumber??order.order_number} por ${money(attempt.amount)}. Envío el comprobante para que DCL verifique su recepción.`,destination);
        if(whatsapp)whatsapp.location.href=href;
        else setError("Aviso guardado. El navegador bloqueó WhatsApp; podés abrirlo desde el enlace del aviso.");
      }
      noticeAttempt.current=null;setNoticeLocked(false);setChoice(null);setAmount("");await refresh();void onUpdated?.();
    }catch(cause){whatsapp?.close();setError(cause instanceof Error?cause.message:"No se guardó el aviso.");}
    finally{inFlight.current=false;setSaving(false);}
  }
  return <section className="mt-4 space-y-3 rounded-xl border border-white/10 p-4" aria-label={`Pago ${order.order_number}`}>
    <h3 className="font-bold">Pago</h3>
    {summary?<><dl className="grid gap-1 text-sm"><div>Total: <b>{money(summary.total)}</b></div><div>Pagado: <b>{money(summary.paid)}</b></div><div>Saldo pendiente: <b>{money(summary.due)}</b></div></dl><p className={`text-sm font-bold ${summary.due===0?"text-emerald-200":"text-amber-200"}`}>{summary.due===0?"✓ Pago completo":summary.paid>0?"◷ Pago parcial":"◷ Pago pendiente"}</p></>:<p className="text-sm text-amber-200">No pudimos verificar el saldo.</p>}
    {coordinate&&<a href={whatsappUrl(`Hola, ya realicé el pedido ${data?.orderNumber??order.order_number} y el pago está completo. Quisiera coordinar la entrega o el retiro. Gracias.`,destination)} target="_blank" rel="noopener noreferrer" className={`${button} block bg-emerald-700 text-center`}>Coordinar entrega o retiro</a>}
    {summary?.due===0&&(data?.deliveryComplete??isWholesaleDeliveryComplete(order))&&<p className="text-sm text-emerald-200">✓ Entrega completa</p>}
    {summary?.due!==0&&pendingNotices.map(n=><div key={n.id} className="space-y-2 rounded-xl border border-amber-300/30 p-3 text-sm text-amber-100"><p>◷ Transferencia informada · Esperando confirmación de DCL: {money(Number(n.amount))}</p><p className="text-xs">El aviso no confirma que enviaste el mensaje ni que DCL recibió el dinero.</p><a className="block min-h-11 py-3 underline" href={whatsappUrl(`Hola, voy a informar una transferencia del pedido ${order.order_number} por ${money(Number(n.amount))}. Envío el comprobante para verificar su recepción.`,destination)} target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a><button type="button" disabled={saving} onClick={()=>void notice('withdraw',n.id)} className={button}>No envié la transferencia · Liberar importe</button></div>)}
    {pending&&summary?.due!==0&&<div role="status" className="rounded-xl border border-amber-300/30 p-3 text-sm text-amber-100"><p>{expired?"El intento venció. Revisá su estado antes de volver a pagar.":pending.state==="rejected"?"Pago rechazado o cancelado. Podés reintentar el mismo pago.":processing||returned?"Estamos confirmando tu pago":"Tenés un pago iniciado. Podés continuar el mismo intento."}</p>{!processing&&!expired&&data?.checkoutEnabled&&<button type="button" onClick={()=>{setChoice("mercadopago");setOpen(true);}} className={button}>Continuar pago iniciado</button>}{data?.noticesEnabled&&expired&&<button type="button" onClick={async()=>{if(!window.confirm("Se verificará con Mercado Pago antes de liberar el intento. ¿Continuar?"))return;const r=await fetch(`/api/wholesale/orders/${order.id}/checkout-recovery`,{method:"POST"});if(!r.ok)setError("El pago todavía requiere verificación de DCL.");else await refresh();}} className={button}>Revisar intento vencido</button>}</div>}
    {error&&<p role="alert" className="text-sm text-amber-200">{error}</p>}
    <button type="button" onClick={()=>void refresh()} className="min-h-11 text-sm underline">Actualizar estado</button>
    {active&&summary?.canPay&&available>0&&!open&&<button type="button" onClick={()=>{setOpen(true);setChoice(null);void refresh();}} className={`${button} bg-emerald-700`}>Continuar al pago</button>}
    {!active&&<p className="text-sm text-zinc-400">{["cancelled","rejected"].includes(order.status)?"Este pedido no admite nuevos pagos.":"El pago se habilita al confirmar el pedido."}</p>}
    {open&&active&&summary?.canPay&&data&&<div className="space-y-3">
      {!choice&&<><p className="text-sm">Disponible para pagar: {money(available)}</p><button type="button" disabled={!data.checkoutEnabled||Boolean(pending)} onClick={()=>setChoice("mercadopago")} className={button}>Pagar con Mercado Pago</button><button type="button" disabled={available<=0} onClick={()=>setChoice("transfer")} className={button}>{data.noticesEnabled?"Pagar por transferencia":"Consultar transferencia con DCL"}</button></>}
      {choice==='mercadopago'&&data.checkoutEnabled&&!processing&&!expired&&(pending||available>0)&&<WholesaleAutomaticPayment key={pending?.id??String(available)} orderId={order.id} due={pending?Number(pending.amount):available} pending={pending}/>}
      {choice==='transfer'&&data.noticesEnabled&&configured&&<><h4 className="font-semibold">Transferencia al CVU de Mercado Pago</h4><dl className="space-y-2 break-all text-sm">{data.transfer?.alias&&<div>Alias: <b>{data.transfer.alias}</b></div>}{data.transfer?.cbuCvu&&<div>CBU/CVU: <b>{data.transfer.cbuCvu}</b></div>}<div>Titular: <b>{data.transfer?.holder}</b></div></dl><label className="block text-sm">Importe a informar<input disabled={saving||noticeLocked} type="number" inputMode="decimal" min="0.01" max={available} step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-white/15 bg-zinc-950 px-3"/></label><button type="button" disabled={saving||noticeLocked} onClick={()=>setAmount(available.toFixed(2))} className={button}>Usar saldo disponible</button><button type="button" disabled={saving||(!valid&&!noticeLocked)} onClick={()=>void notice('inform')} className={`${button} bg-emerald-700`}>{saving?"Guardando aviso…":"Informar transferencia por WhatsApp"}</button><p className="text-xs text-zinc-400">Primero se guarda el aviso. El dinero se confirma solo cuando DCL verifica la recepción.</p></>}
      {choice==='transfer'&&!configured&&<p className="text-sm text-amber-200">Consultá con DCL los datos de transferencia.</p>}
      {choice==='transfer'&&!data.noticesEnabled&&configured&&<div className="space-y-2 text-sm"><p>Alias: <b>{data.transfer?.alias||data.transfer?.cbuCvu}</b></p><p>Titular: {data.transfer?.holder}</p><a className={`${button} block text-center`} href={whatsappUrl(`Hola, quisiera consultar el pago por transferencia del pedido ${order.order_number}.`,destination)} target="_blank" rel="noopener noreferrer">Consultar transferencia con DCL</a></div>}
      <button type="button" onClick={()=>{setOpen(false);setChoice(null);}} className={button}>Cerrar opciones de pago</button>
    </div>}
  </section>;
}
