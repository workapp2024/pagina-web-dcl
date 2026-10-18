/* eslint-disable @typescript-eslint/no-explicit-any */
export type CustomerPaymentSummary = { total: number; paid: number; due: number; state: "Pendiente" | "Parcial" | "Pago completo"; canPay: boolean };
export function customerPaymentSummary(status: string, total: unknown, currency: string, payments: {entry_type:string;amount:number|string;currency:string}[]): CustomerPaymentSummary | null {
  const amount = Number(total);
  if (total == null || !Number.isFinite(amount) || amount < 0 || payments.some(p => !["payment","refund"].includes(p.entry_type) || p.currency.trim() !== currency.trim() || !Number.isFinite(Number(p.amount)) || Number(p.amount) < 0)) return null;
  const paidCents = payments.reduce((n,p)=>n+(p.entry_type === "payment" ? 1 : -1)*Math.round(Number(p.amount)*100),0);
  const due = Math.max(0,Math.round(amount*100)-paidCents)/100;
  return {total:amount,paid:paidCents/100,due,state:due === 0 ? "Pago completo" : paidCents > 0 ? "Parcial" : "Pendiente",canPay:status === "confirmed" && due > 0 && currency.trim() === "ARS"};
}

export async function readCustomerPayments(db: {from: (table:string)=>any}, orderIds:string[]) {
  const rows: {order_id:string;entry_type:string;amount:number|string;currency:string}[] = [];
  if (!orderIds.length) return rows;
  for (let offset=0;;offset+=500) {
    const result=await db.from("wholesale_payment_entries").select("id,order_id,entry_type,amount,currency").in("order_id",orderIds).order("id").range(offset,offset+499);
    if(result.error) throw new Error("Payment summary unavailable");
    rows.push(...(result.data ?? []));
    if((result.data ?? []).length<500) return rows;
  }
}
