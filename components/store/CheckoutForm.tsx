/* eslint-disable @next/next/no-location-assign-relative-destination */
"use client";
import { useEffect, useRef, useState } from "react";
import { useCart } from "@/components/store/CartProvider";
import { MercadoPagoBrick } from "@/components/store/MercadoPagoBrick";
import { analyticsEvents, capture, captureOnce } from "@/lib/analytics";
import { createClientUuid } from "@/lib/client-uuid";

import { checkoutFingerprint, normalizeOrderItems } from "@/lib/store/order-input";

type Method="mercadopago"|"card"|"transfer";
type Transfer={alias:string;cbuCvu:string;holder:string;institution:string;instructions:string};
const methods:{id:Method;title:string;description:string}[]=[{id:"mercadopago",title:"Mercado Pago",description:"Pagá con dinero en cuenta o los medios disponibles en Mercado Pago."},{id:"card",title:"Tarjeta",description:"Crédito, débito y cuotas disponibles."},{id:"transfer",title:"Transferencia",description:"Transferencia bancaria directa."}];

export function CheckoutForm({transfer}:{transfer:Transfer}){
  const {lines,total}=useCart();
  const attempt=useRef<{fingerprint:string;key:string}|null>(null),inFlight=useRef(false);
  const [method,setMethod]=useState<Method|null>(null),[form,setForm]=useState({name:"",phone:"",email:"",fulfillment:"pickup",address:"",notes:""});
  const [paymentState,setPayment]=useState<{orderId:string;amount:number;publicKey:string;fingerprint:string}|null>(null);
  const [transferState,setTransferOrder]=useState<{orderId:string;amount:number;fingerprint:string}|null>(null);
  const [error,setError]=useState(""),[saving,setSaving]=useState(false),[copied,setCopied]=useState("");
  let fingerprint="";
  try { fingerprint=checkoutFingerprint(lines.map(item=>({productId:item.id,quantity:item.quantity})),method,form); } catch { /* Invalid persisted cart is rejected on submit. */ }
  const payment=paymentState?.fingerprint===fingerprint?paymentState:null;
  const transferOrder=transferState?.fingerprint===fingerprint?transferState:null;
  const transferConfigured=Boolean((transfer.alias.trim()||transfer.cbuCvu.trim())&&transfer.holder.trim()&&transfer.institution.trim());
  const availableMethods=methods.filter(item=>item.id!=="transfer"||transferConfigured);
  useEffect(()=>{if(transferOrder)captureOnce('transfer-instructions:'+transferOrder.orderId,analyticsEvents.transferInstructionsViewed)},[transferOrder]);
  function select(next:Method){if(inFlight.current||next===method)return;setMethod(next);setPayment(null);setTransferOrder(null);setError("");capture(analyticsEvents.paymentMethodSelected,{method:next})}
  async function createOrder(){
    if(!fingerprint)throw new Error("Revisa los productos y cantidades del carrito.");
    if(attempt.current?.fingerprint!==fingerprint)attempt.current={fingerprint,key:createClientUuid()};
    const response=await fetch("/api/store/orders",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...form,paymentMethod:method,idempotencyKey:attempt.current.key,items:normalizeOrderItems(lines.map(item=>({productId:item.id,quantity:item.quantity})))})});
    const body=await response.json();
    if(!response.ok){
      // A new key is used only on the next explicit submission, never automatically.
      if(["RESERVATION_EXPIRED","IDEMPOTENCY_CONFLICT"].includes(body.code))attempt.current=null;
      throw new Error(body.error||"No se pudo crear el pedido.");
    }
    return body as {orderId:string;total:number;publicKey:string|null};
  }
  async function submit(event:React.FormEvent){
    event.preventDefault();if(inFlight.current)return;if(!method)return setError("Elegi como queres pagar.");
    inFlight.current=true;setSaving(true);setError("");
    try {
      const order=await createOrder();
      if(method==="mercadopago"){
        const response=await fetch("/api/payments/mercadopago/preference",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({orderId:order.orderId})}),body=await response.json();
        if(!response.ok||!body.checkoutUrl)throw new Error(body.error||"No se pudo abrir Mercado Pago.");
        capture(analyticsEvents.mercadopagoCheckoutOpened);location.assign(body.checkoutUrl);return;
      }
      if(method==="card"){
        if(!order.publicKey)throw new Error("Mercado Pago no esta configurado.");
        setPayment({orderId:order.orderId,amount:order.total,publicKey:order.publicKey,fingerprint});
      } else setTransferOrder({orderId:order.orderId,amount:order.total,fingerprint});
    }catch(cause){setError(cause instanceof Error?cause.message:"No se pudo continuar.")}
    finally{inFlight.current=false;setSaving(false)}
  }
  async function copy(label:string,value:string){await navigator.clipboard.writeText(value);setCopied(label)}
  async function markSent(){
    if(!transferOrder||inFlight.current)return;inFlight.current=true;setSaving(true);setError("");
    try {
      const response=await fetch('/api/store/orders/'+encodeURIComponent(transferOrder.orderId)+'/status',{method:"POST"});
      if(!response.ok)throw new Error("No se pudo registrar el aviso de transferencia.");
      captureOnce('transfer-sent:'+transferOrder.orderId,analyticsEvents.manualTransferMarkedSent);
      location.assign('/checkout/resultado?result=pending&order='+encodeURIComponent(transferOrder.orderId));
    }catch(cause){setError(cause instanceof Error?cause.message:"No se pudo continuar.")}
    finally{inFlight.current=false;setSaving(false)}
  }
  return <main className="mx-auto max-w-3xl px-4 py-10 text-white"><h1 className="text-3xl font-black">Checkout</h1><p className="mt-2 text-zinc-400">Total: <b className="text-white">${total.toLocaleString("es-AR")}</b></p><section className="mt-8"><h2 className="text-xl font-black">¿Cómo querés pagar?</h2><div className="mt-4 grid gap-3 sm:grid-cols-3">{availableMethods.map(item=><button key={item.id} type="button" disabled={saving} onClick={()=>select(item.id)} className={`min-h-28 rounded-2xl border p-4 text-left ${method===item.id?"border-red-500 bg-red-600/15":"border-white/10 bg-zinc-950"}`}><b className="block">{item.title}</b><span className="mt-2 block text-sm text-zinc-400">{item.description}</span></button>)}</div></section>{!payment&&!transferOrder&&<form onSubmit={submit} className="mt-7 grid gap-3 rounded-2xl border border-white/10 bg-zinc-950 p-4 sm:p-6"><fieldset disabled={saving} className="contents"><input required placeholder="Nombre completo" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/><input required placeholder="WhatsApp" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/><input placeholder="Email opcional" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/><select value={form.fulfillment} onChange={e=>setForm({...form,fulfillment:e.target.value})}><option value="pickup">Retiro</option><option value="delivery">Entrega</option></select>{form.fulfillment==="delivery"&&<input required placeholder="Dirección" value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/>}<textarea placeholder="Observaciones" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/>{error&&<p role="alert" className="text-red-300">{error}</p>}<button disabled={saving||!lines.length||!method} className="min-h-12 rounded-full bg-red-600 font-bold disabled:opacity-40">{saving?"Preparando…":method==="mercadopago"?"Pagar con Mercado Pago":method==="card"?"Continuar con tarjeta":"Ver datos para transferir"}</button></fieldset></form>}{payment&&<div className="mt-7"><MercadoPagoBrick {...payment}/></div>}{transferOrder&&<section className="mt-7 rounded-2xl border border-white/10 bg-zinc-950 p-5"><h2 className="text-xl font-black">Transferí exactamente ${transferOrder.amount.toLocaleString("es-AR")}</h2>{[["Alias",transfer.alias],["CBU/CVU",transfer.cbuCvu]].filter(([,value])=>value).map(([label,value])=><div key={label} className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-white/5 p-3"><span><small className="block text-zinc-400">{label}</small><b>{value}</b></span><button type="button" onClick={()=>void copy(label,value)} className="min-h-11 rounded-full border border-white/15 px-4 text-xs font-bold">{copied===label?"Copiado":"Copiar"}</button></div>)}<dl className="mt-5 space-y-2 text-sm"><div><dt className="text-zinc-400">Titular</dt><dd className="font-bold">{transfer.holder}</dd></div><div><dt className="text-zinc-400">Banco/billetera</dt><dd className="font-bold">{transfer.institution}</dd></div></dl>{transfer.instructions&&<p className="mt-5 text-sm text-zinc-400">{transfer.instructions}</p>}{error&&<p role="alert" className="mt-4 text-red-300">{error}</p>}<button type="button" disabled={saving} onClick={()=>void markSent()} className="mt-6 min-h-12 w-full rounded-full bg-red-600 font-bold disabled:opacity-50">{saving?"Registrando…":"Ya realicé la transferencia"}</button><p className="mt-3 text-xs text-zinc-500">Esto no aprueba el pago. El pedido queda pendiente de verificación manual.</p></section>}</main>
}
