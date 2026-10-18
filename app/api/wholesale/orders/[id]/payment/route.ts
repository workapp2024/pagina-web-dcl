import { wholesaleCheckoutPreparedEnabled } from "@/lib/prepared-finance-features";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getWholesaleSessionCustomerId } from "@/lib/wholesale-server";
import { createAdminServerClient } from "@/lib/supabase/server";
import { isWholesaleUuid } from "@/lib/wholesale-order-api";
import { customerPaymentSummary, readCustomerPayments } from "@/lib/wholesale-customer-payment";
import { readTransferNotices,unreservedPaymentAmount,wholesalePaymentNoticesEnabled } from "@/lib/wholesale-payment-notices";

const headers={"Cache-Control":"no-store, private"};
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  const customer=await getWholesaleSessionCustomerId();
  if(!customer) return NextResponse.json({error:"Ingresá a tu cuenta mayorista."},{status:401,headers});
  const {id}=await params;
  if(!isWholesaleUuid(id)) return NextResponse.json({error:"Pedido inválido."},{status:400,headers});
  try {
    const db=createAdminServerClient() as any;
    const {data:order,error}=await db.from("wholesale_orders").select("id,status,current_revision_id,order_number").eq("id",id).eq("customer_id",customer).maybeSingle();
    if(error) throw error;
    if(!order) return NextResponse.json({error:"Pedido no encontrado."},{status:404,headers});
    const {data:revision,error:revisionError}=await db.from("wholesale_order_revisions").select("total_amount,currency").eq("id",order.current_revision_id).eq("order_id",id).single();
    if(revisionError||!revision) throw revisionError;
    const payments=await readCustomerPayments(db,[id]);
    const summary=customerPaymentSummary(order.status,revision.total_amount,revision.currency,payments);
    const {data:settings,error:settingsError}=await db.from("site_settings").select("transfer_alias,transfer_cbu_cvu,transfer_holder,transfer_institution,transfer_instructions,whatsapp").eq("id",1).maybeSingle();
    if(settingsError) throw settingsError;
    const checkoutEnabled=wholesaleCheckoutPreparedEnabled();
    const notices=await readTransferNotices(db,[id]);
    const completion=await db.from("wholesale_order_events").select("event_type").eq("order_id",id).in("event_type",["order_fully_delivered","order_delivery_completion_reversed"]).order("id",{ascending:false}).limit(1).maybeSingle();
    if(completion.error)throw completion.error;
    let pendingCheckout=null;
    {
      const active=await db.from("wholesale_checkout_intents").select("id,state,amount,requested_amount,expires_at").eq("order_id",id).eq("customer_id",customer).not("state","in","(approved,closed)").maybeSingle();
      if(active.error) throw active.error;
      pendingCheckout=active.data;
      if(pendingCheckout){
        const receipts=await db.from("wholesale_checkout_receipts").select("outcome").eq("intent_id",pendingCheckout.id);
        if(receipts.error)throw receipts.error;
        if(receipts.data?.length&&receipts.data.every((r:{outcome:string})=>r.outcome==='rejected'))pendingCheckout={...pendingCheckout,state:'rejected'};
      }
    }
    return NextResponse.json({checkoutEnabled,pendingCheckout,noticesEnabled:wholesalePaymentNoticesEnabled(),notices,availableDue:summary?unreservedPaymentAmount(summary.due,notices,Number(pendingCheckout?.amount??0)):0,deliveryComplete:completion.data?.event_type==="order_fully_delivered",summary,orderNumber:order.order_number,status:order.status,transfer:settings ? {alias:settings.transfer_alias,cbuCvu:settings.transfer_cbu_cvu,holder:settings.transfer_holder,institution:settings.transfer_institution,instructions:settings.transfer_instructions,whatsapp:settings.whatsapp}:null},{headers});
  } catch { return NextResponse.json({error:"No pudimos actualizar el pago. Intentá nuevamente."},{status:503,headers}); }
}
