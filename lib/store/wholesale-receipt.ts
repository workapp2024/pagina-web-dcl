import "server-only";
import { createAdminServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/api";
import type { ReceiptResult } from "@/lib/store/order-receipt";

type Order={id:string;order_number:string;customer_id:string;status:string;confirmed_revision_id:string|null;confirmed_at:string|null};
type Revision={id:string;order_id:string;currency:string;total_amount:string|number};
type Item={id:string;revision_id:string;product_name_snapshot:string;quantity:number;unit_price:string|number;line_total:string|number;currency:string};
type Payment={id:string;order_id:string;entry_type:string;amount:string|number;currency:string;payment_method:string;refund_of:string|null};
const incident=():ReceiptResult=>({status:"incident",message:"Los datos del comprobante requieren revisión administrativa."});
const cents=(value:unknown)=>{if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(String(value)))throw Error("Invalid money");const parts=String(value).split('.');const n=Number(parts[0])*100+Number((parts[1]??'').padEnd(2,'0'));if(!Number.isSafeInteger(n))throw Error('Invalid money');return n;};
export function validateWholesaleReceipt(order:Order,revision:Revision,items:Item[],payments:Payment[],customerName:string):ReceiptResult {
  try {
    if(order.status!=="confirmed"||!order.confirmed_at||!Number.isFinite(Date.parse(order.confirmed_at))||!/^MW-\d{6,19}$/.test(order.order_number)||!customerName.trim()||customerName.length>160||order.confirmed_revision_id!==revision.id||revision.order_id!==order.id||revision.currency!=="ARS"||!items.length)return incident();
    const total=cents(revision.total_amount),seen=new Set<string>();let sum=0;
    const lines=items.map(i=>{if(seen.has(i.id)||i.revision_id!==revision.id||i.currency!==revision.currency||!i.product_name_snapshot.trim()||!Number.isSafeInteger(i.quantity)||i.quantity<=0)throw Error('Invalid item');seen.add(i.id);const unit=cents(i.unit_price),line=cents(i.line_total);if(unit*i.quantity!==line)throw Error('Invalid line');sum+=line;return {name:i.product_name_snapshot,quantity:i.quantity,unitPrice:unit/100,lineTotal:line/100};});
    if(sum!==total||!Number.isSafeInteger(sum))return incident();
    const ids=new Set<string>(),refunds=new Map<string,number>();let paid=0,returned=0;
    for(const p of payments){if(ids.has(p.id)||p.order_id!==order.id||p.currency!==revision.currency||!["payment","refund"].includes(p.entry_type)||cents(p.amount)<=0)throw Error('Invalid payment');ids.add(p.id);if(p.entry_type==='payment'){if(p.refund_of)throw Error('Invalid reference');paid+=cents(p.amount);}else{const original=payments.find(x=>x.id===p.refund_of&&x.entry_type==='payment');if(!original)throw Error('Missing refund source');const amount=(refunds.get(original.id)??0)+cents(p.amount);if(amount>cents(original.amount))throw Error('Invalid refund');refunds.set(original.id,amount);returned+=cents(p.amount);}}
    const net=paid-returned;if(!Number.isSafeInteger(paid)||!Number.isSafeInteger(returned)||net<0||net>total)return incident();
    const methods:Record<string,string>={cash:"Efectivo",mercadopago:"Mercado Pago",bank_transfer:"Transferencia",other:"Otro"};
    return {status:"ok",receipt:{kind:"order",orderNumber:order.order_number,soldAt:order.confirmed_at,customerName:customerName.trim(),currency:revision.currency,total:total/100,items:lines,status:"valid",paymentStatus:net===total&&total>0?"Pagado":net>0?"Pago parcial":"Pendiente",paymentMethod:[...new Set(payments.filter(p=>p.entry_type==='payment').map(p=>methods[p.payment_method]??"Otro"))].join(" / ")||"Sin pagos confirmados",confirmedPaid:paid/100,refundedAmount:returned/100,pendingAmount:(total-net)/100}};
  }catch{return incident();}
}

// Admin-only callers authenticate before invoking this read-only loader.
export async function getWholesaleReceipt(id:string):Promise<ReceiptResult>{
  if(!isUuid(id))return {status:"not_found",message:"Pedido no encontrado."};
  try {
    const db=createAdminServerClient();
    const orderResult=await db.from('wholesale_orders').select('id,order_number,customer_id,status,confirmed_revision_id,confirmed_at').eq('id',id).maybeSingle();
    if(orderResult.error)throw orderResult.error;
    const order=orderResult.data as unknown as Order|null;
    if(!order)return {status:"not_found",message:"Pedido no encontrado."};
    if(order.status!=='confirmed'||!order.confirmed_revision_id)return {status:"unavailable",message:"El comprobante requiere un pedido mayorista confirmado."};
    const [revisionResult,customerResult]=await Promise.all([db.from('wholesale_order_revisions').select('id,order_id,currency,total_amount').eq('id',order.confirmed_revision_id).eq('order_id',id).maybeSingle(),db.from('customers').select('full_name').eq('id',order.customer_id).maybeSingle()]);
    if(revisionResult.error||customerResult.error||!revisionResult.data||!customerResult.data)throw Error('Read failed');
    async function read<T>(table:string,columns:string,field:string,value:string){const rows:T[]=[];for(let offset=0;offset<10000;offset+=500){const r=await db.from(table as never).select(columns).eq(field,value).order('id').range(offset,offset+499);if(r.error||!Array.isArray(r.data))throw Error('Read failed');rows.push(...r.data as unknown as T[]);if(r.data.length<500)return rows;}throw Error('Read limit');}
    const [items,payments]=await Promise.all([read<Item>('wholesale_order_revision_items','id,revision_id,product_name_snapshot,quantity,unit_price,line_total,currency','revision_id',order.confirmed_revision_id),read<Payment>('wholesale_payment_entries','id,order_id,entry_type,amount,currency,payment_method,refund_of','order_id',id)]);
    return validateWholesaleReceipt(order,revisionResult.data as unknown as Revision,items,payments,(customerResult.data as {full_name:string}).full_name);
  }catch{return incident();}
}
