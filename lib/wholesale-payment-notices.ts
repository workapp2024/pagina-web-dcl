import "server-only";

export type TransferNotice = {id:string;order_id:string;amount:number|string;status:"pending"|"withdrawn"|"not_received"|"verified";created_at:string;payment_entry_id?:string|null};
export function wholesalePaymentNoticesEnabled() {
  return process.env.DCL_WHOLESALE_PAYMENT_NOTICES_ENABLED === "1";
}
// All IDs must originate in an authenticated, owner-scoped order lookup.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readTransferNotices(db:{from:(table:string)=>any}, orderIds:string[]):Promise<TransferNotice[]> {
  if (!wholesalePaymentNoticesEnabled() || !orderIds.length) return [];
  const {data,error}=await db.from("wholesale_transfer_notices").select("id,order_id,amount,status,created_at,payment_entry_id").in("order_id",orderIds).order("created_at");
  if(error) throw Error("No pudimos actualizar los avisos de transferencia.");
  return data ?? [];
}

export function unreservedPaymentAmount(due:number, notices:TransferNotice[], pendingAmount=0) {
  const reserved=notices.filter(n=>n.status==="pending").reduce((sum,n)=>sum+Math.round(Number(n.amount)*100),0);
  if(!Number.isFinite(reserved)||!Number.isFinite(pendingAmount)) return 0;
  return Math.max(0,Math.round(due*100)-reserved-Math.round(pendingAmount*100))/100;
}
