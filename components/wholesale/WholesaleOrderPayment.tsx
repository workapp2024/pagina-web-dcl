"use client";
import { useEffect, useState } from "react";
import type { WholesaleCustomerOrder } from "@/lib/wholesale-customer-orders";
import { WholesaleAutomaticPayment } from "@/components/wholesale/WholesaleAutomaticPayment";
import { whatsappUrl } from "@/lib/whatsapp";

type PaymentData={checkoutEnabled?:boolean;pendingCheckout?:{id:string;amount:number|string;requested_amount:number|null}|null;summary:WholesaleCustomerOrder["payment_summary"];status:string;orderNumber:string;transfer:null|{alias:string;cbuCvu:string;holder:string;institution:string;instructions:string;whatsapp:string}};
export function WholesaleOrderPayment({order}:{order:WholesaleCustomerOrder}) {
  const [open,setOpen]=useState(false),[data,setData]=useState<PaymentData|null>(null),[error,setError]=useState("");
  const [choice,setChoice]=useState<"transfer"|"mercadopago"|null>(null);
  const [amount,setAmount]=useState(""),[notified,setNotified]=useState(false);
  useEffect(()=>{if(!open)return;const controller=new AbortController();void fetch(`/api/wholesale/orders/${order.id}/payment`,{cache:"no-store",signal:controller.signal}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.error);if(!controller.signal.aborted)setData(body);}).catch(cause=>{if(!controller.signal.aborted)setError(cause.message||"No se pudo actualizar el pago.");});return()=>controller.abort();},[open,order.id]);
  const summary=data ? data.summary : order.payment_summary;
  const money=(n:number)=>new Intl.NumberFormat("es-AR",{style:"currency",currency:order.currency.trim()}).format(n);
  const active=(data?.status ?? order.status)==="confirmed";
  const transfer=data?.transfer;
  const configured=Boolean(transfer?.holder && (transfer.alias||transfer.cbuCvu));
  const value=Number(amount),valid=Number.isFinite(value)&&value>0&&summary&&value<=summary.due&&Math.abs(value*100-Math.round(value*100))<0.0001;
  return <section className="mt-4 space-y-3 rounded-xl border border-white/10 p-4" aria-label={`Pago ${order.order_number}`}>
    <h3 className="font-bold">Pago</h3>
    {summary ? <><dl className="space-y-1 text-sm"><div>Total: <b>{money(summary.total)}</b></div><div>Pagado: <b>{money(summary.paid)}</b></div><div>Saldo pendiente: <b>{money(summary.due)}</b></div></dl><p className={`text-sm font-bold ${summary.due===0?"text-emerald-200":"text-amber-200"}`}>{summary.due===0?"✓ ":"◷ "}{summary.state}</p></> : <p className="text-sm text-amber-200">No pudimos verificar el saldo del pago.</p>}
    {active&&summary?.canPay&&!open&&<button type="button" onClick={()=>{setData(null);setError("");setChoice(null);setAmount("");setNotified(false);setOpen(true);}} className="min-h-12 w-full rounded-xl bg-emerald-700 px-4 py-3 font-bold">Continuar al pago</button>}
    {!active&&<p className="text-sm text-zinc-400">{["cancelled","rejected"].includes(order.status)?"Este pedido no admite nuevos pagos.":"El pago se habilita al confirmar el pedido."}</p>}
    {open&&<div className="space-y-3">
      {error?<p role="alert" className="text-sm text-amber-200">{error}</p>:!data?<p role="status">Actualizando saldo…</p>:active&&data.summary?.canPay?<>
        <div className="grid gap-2"><button type="button" disabled={!data.checkoutEnabled} onClick={()=>setChoice("mercadopago")} className="min-h-12 rounded-xl border border-white/15 px-4 py-3 font-bold disabled:opacity-50">{data.pendingCheckout ? "Continuar pago iniciado" : "Pagar con Mercado Pago"}{!data.checkoutEnabled && " (pendiente de habilitar)"}</button><button type="button" disabled={Boolean(data.pendingCheckout)} onClick={()=>setChoice("transfer")} className="min-h-12 rounded-xl border border-white/15 px-4 py-3 font-bold disabled:opacity-50">Pagar por transferencia</button></div>
        {data.pendingCheckout && <p className="text-sm text-amber-200">Hay un pago en proceso. Continuá el mismo intento o consultá con DCL antes de transferir.</p>}
        {choice==="mercadopago" && data.checkoutEnabled && <WholesaleAutomaticPayment orderId={order.id} due={data.summary.due} pending={data.pendingCheckout} />}
        {choice==="transfer" && <><h4 className="font-semibold">Transferencia al CVU de Mercado Pago</h4>
        {configured?<><dl className="space-y-2 break-all text-sm">{transfer?.alias&&<div>Alias: <b>{transfer.alias}</b></div>}{transfer?.cbuCvu&&<div>CBU/CVU: <b>{transfer.cbuCvu}</b></div>}<div>Titular: <b>{transfer?.holder}</b></div>{transfer?.institution&&<div>Cuenta: {transfer.institution}</div>}</dl>
          <p className="whitespace-pre-wrap text-sm text-zinc-400">{transfer?.instructions}</p>
          <label className="block text-sm">Importe a transferir<input type="number" inputMode="decimal" min="0.01" max={data.summary.due} step="0.01" value={amount} onChange={e=>{setAmount(e.target.value);setNotified(false);}} className="mt-1 min-h-12 w-full rounded-xl border border-white/15 bg-zinc-950 px-3" /></label>
          <button type="button" onClick={()=>setAmount(data.summary!.due.toFixed(2))} className="min-h-12 rounded-xl border border-white/15 px-4">Pagar todo</button>
          {valid?<a href={whatsappUrl(`Hola DCL, informo una transferencia del pedido mayorista ${order.order_number} por ${money(value)}. Envío el comprobante para verificar su recepción.`,transfer?.whatsapp)} target="_blank" rel="noopener noreferrer" onClick={()=>setNotified(true)} className="block min-h-12 rounded-xl bg-emerald-700 px-4 py-3 text-center font-bold">Informar transferencia por WhatsApp</a>:<p className="text-sm text-zinc-400">Indicá un importe parcial o el saldo completo, sin superarlo.</p>}
          <p className="text-sm text-zinc-400">{notified?"Aviso abierto en WhatsApp. ":""}Enviar el comprobante no confirma el cobro. El pago seguirá pendiente hasta que DCL verifique la recepción y lo registre. Actualizá la página antes de transferir para comprobar el saldo vigente.</p>
        </>:<p className="text-sm text-amber-200">DCL debe completar los datos de transferencia antes de que puedas pagar.</p>}
        </>}

      </>:<p className="text-sm">No hay un pago pendiente habilitado para este pedido.</p>}
      <button type="button" onClick={()=>setOpen(false)} className="min-h-11 px-4 text-sm">Cerrar opciones de pago</button>
    </div>}
  </section>;
}
