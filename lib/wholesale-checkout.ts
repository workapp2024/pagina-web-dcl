import "server-only";
import { isUuid } from "@/lib/api";
import { providerGet } from "@/lib/store/mercadopago-recovery";

type Intent={id:string;customer_id:string;order_id:string;revision_id:string;amount:number|string;currency:string;expires_at:string;preference_id:string|null};
type DB={rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:any;error:any}>;from:(table:string)=>any}; // eslint-disable-line @typescript-eslint/no-explicit-any
function checkoutUrl(value:unknown) {
  if(typeof value!=="string")throw Error("Invalid checkout URL");
  const url=new URL(value);
  if(url.protocol!=="https:"||url.username||url.password||url.port||!["www.mercadopago.com.ar","mercadopago.com.ar","sandbox.mercadopago.com.ar"].includes(url.hostname))throw Error("Invalid checkout host");
  return url.toString();
}
export function verifyWholesalePreference(preference:Record<string,unknown>,intent:Intent) {
  const metadata=preference.metadata as Record<string,unknown>|undefined;
  const items=preference.items as Array<Record<string,unknown>>|undefined;
  const expiry=Date.parse(String(preference.expiration_date_to));
  if(!preference.id||preference.external_reference!==`wholesale:${intent.id}`||metadata?.wholesale_intent_id!==intent.id||metadata?.wholesale_order_id!==intent.order_id||metadata?.wholesale_revision_id!==intent.revision_id||metadata?.sector!=="mayoristas"
    ||!preference.expires||!Number.isFinite(expiry)||expiry>Date.parse(intent.expires_at)||items?.length!==1||items[0].id!==intent.order_id||Number(items[0].quantity)!==1||Number(items[0].unit_price)!==Number(intent.amount)||items[0].currency_id!==intent.currency.trim())throw Error("Preference proof mismatch");
  return checkoutUrl(preference.init_point);
}
export async function prepareWholesaleCheckout(db:DB,customer:string,order:string,amount:number|null,key:string,token:string,site:string) {
  const origin=new URL(site);
  if(origin.protocol!=="https:"||["localhost","127.0.0.1","::1"].includes(origin.hostname))throw Error("Public HTTPS site required");
  const begun=await db.rpc("begin_wholesale_checkout",{p_customer:customer,p_order:order,p_amount:amount,p_key:key});
  if(begun.error||!begun.data)throw Error("Checkout requires refresh or administrative review");
  const intent=begun.data as Intent;
  let preference:Record<string,unknown>;
  if(intent.preference_id) preference=await providerGet(`/checkout/preferences/${encodeURIComponent(intent.preference_id)}`,token);
  else {
    const claim=await db.rpc("claim_wholesale_checkout",{p_customer:customer,p_intent:intent.id});
    if(claim.error)throw Error("Checkout claim unavailable");
    if(claim.data===true){
      const response=await fetch("https://api.mercadopago.com/checkout/preferences",{method:"POST",redirect:"error",cache:"no-store",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json","X-Idempotency-Key":intent.id},body:JSON.stringify({external_reference:`wholesale:${intent.id}`,items:[{id:intent.order_id,title:"Pedido mayorista DCL",quantity:1,currency_id:intent.currency.trim(),unit_price:Number(intent.amount)}],metadata:{sector:"mayoristas",wholesale_intent_id:intent.id,wholesale_order_id:intent.order_id,wholesale_revision_id:intent.revision_id},notification_url:new URL("/api/payments/mercadopago/checkout-pro-webhook",origin.origin).toString(),back_urls:{success:new URL("/mayoristas?seccion=pedidos",origin.origin).toString(),pending:new URL("/mayoristas?seccion=pedidos",origin.origin).toString(),failure:new URL("/mayoristas?seccion=pedidos",origin.origin).toString()},auto_return:"approved",expires:true,expiration_date_to:intent.expires_at})});
      if(!response.ok)throw Error("Provider request result uncertain; do not create another preference");
      preference=await response.json();
    } else {
      // Never repeat a possibly successful POST. Recover by the unique external reference.
      const found=await providerGet(`/checkout/preferences/search?external_reference=${encodeURIComponent(`wholesale:${intent.id}`)}`,token);
      const results=found.elements as Array<{id?:string}>|undefined;
      if(results?.length!==1||!results[0].id)throw Error("Provider request needs recovery; no additional checkout created");
      preference=await providerGet(`/checkout/preferences/${encodeURIComponent(results[0].id)}`,token);
    }
  }
  const url=verifyWholesalePreference(preference,intent);
  if(Date.parse(String(preference.expiration_date_to))<=Date.now())throw Error("Checkout expired; administrative review required");
  const linked=await db.rpc("link_wholesale_checkout",{p_customer:customer,p_intent:intent.id,p_preference:String(preference.id),p_url:url});
  if(linked.error)throw Error("Checkout no longer available");
  return url;
}

export async function reconcileWholesaleCheckout(db:DB,paymentId:string,token:string) {
  const payment=await providerGet(`/v1/payments/${encodeURIComponent(paymentId)}`,token);
  return reconcileWholesaleCheckoutPayment(db,paymentId,token,payment);
}

// Internal server entry point for the shared webhook after its provider GET.
// Merchant order, preference, amount and intent proofs remain mandatory below.
export async function reconcileWholesaleCheckoutPayment(db:DB,paymentId:string,token:string,payment:Record<string,unknown>) {
  const reference=typeof payment.external_reference === "string" && payment.external_reference.startsWith("wholesale:") ? payment.external_reference.slice(10) : null;
  if(String(payment.id)!==paymentId||!isUuid(reference))throw Error("Provider identity mismatch");
  const lookup=await db.from("wholesale_checkout_intents").select("id,customer_id,order_id,revision_id,amount,currency,expires_at,preference_id").eq("id",reference).maybeSingle();
  if(lookup.error||!lookup.data)throw Error("Unknown wholesale intent");
  const intent=lookup.data as Intent,origin=payment.order as {id?:string|number;type?:string}|undefined;
  if(!origin?.id||origin.type!=="mercadopago")throw Error("Unverified merchant order");
  const merchant=await providerGet(`/merchant_orders/${encodeURIComponent(String(origin.id))}`,token);
  const merchantPayments=merchant.payments as Array<{id?:string|number}>|undefined;
  if(String(merchant.id)!==String(origin.id)||merchant.external_reference!==`wholesale:${intent.id}`||!merchantPayments?.some(p=>String(p.id)===paymentId)||typeof merchant.preference_id!=="string"||(intent.preference_id&&intent.preference_id!==merchant.preference_id))throw Error("Merchant relationship mismatch");
  const preference=await providerGet(`/checkout/preferences/${encodeURIComponent(merchant.preference_id)}`,token);
  verifyWholesalePreference(preference,intent);
  if(!["approved","pending","in_process","authorized","in_mediation","rejected","cancelled","refunded","charged_back"].includes(String(payment.status))||!Number.isFinite(Number(payment.transaction_amount))||typeof payment.currency_id!=="string")throw Error("Payment facts invalid");
  if(!intent.preference_id)throw Error("Preference needs recovery before settlement");
  const result=await db.rpc("settle_wholesale_checkout",{p_intent:intent.id,p_payment:paymentId,p_preference:merchant.preference_id,p_amount:Number(payment.transaction_amount),p_currency:payment.currency_id,p_status:String(payment.status),p_approved_at:payment.date_approved??null});
  if(result.error)throw Error("Settlement requires retry");
  return result.data as string;
}
