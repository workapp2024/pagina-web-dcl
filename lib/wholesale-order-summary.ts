type Payment = { id: string; entry_type: string; refund_of: string | null; amount: number | string; currency: string };
type Recognition = { amount: number | string; currency: string; reversal: { amount: number | string } | null };

export function wholesaleMoneySummary(status: string, total: number, currency: string, payments: Payment[], recognitions: Recognition[]) {
  const sameCurrency = [...payments, ...recognitions].every(row => row.currency.trim() === currency.trim());
  const valid = sameCurrency && Number.isFinite(total) && [...payments, ...recognitions].every(row => Number.isFinite(Number(row.amount)))
    && recognitions.every(row => !row.reversal || Number.isFinite(Number(row.reversal.amount)));
  if (!valid) return null;
  const paid = payments.reduce((sum, row) => sum + (row.entry_type === "payment" ? 1 : -1) * Number(row.amount), 0);
  // Same read model as wholesale finance: recognition minus its reversal, never a negative full recognition.
  const recognized = recognitions.reduce((sum, row) => sum + Number(row.amount) - Number(row.reversal?.amount ?? 0), 0);
  const terminal = ["cancelled", "rejected"].includes(status);
  const commercialTotal = status === "confirmed" ? total : recognized;
  const due = Math.max(0, commercialTotal - paid);
  const credit = Math.max(0, paid - commercialTotal);
  return { paid, recognized, due, credit, refundReview: terminal ? credit : 0,
    compensated: payments.filter(row => row.entry_type === "refund").reduce((sum,row) => sum + Number(row.amount),0),
    terminal, settled: terminal && Math.abs(recognized - paid) < 0.005 };
}

export function refundablePayment(payment: Payment, payments: Payment[]) {
  return payment.entry_type === "payment" ? Math.max(0, Number(payment.amount) - payments
    .filter(row => row.entry_type === "refund" && row.refund_of === payment.id).reduce((sum,row) => sum + Number(row.amount),0)) : 0;
}

export const commercialMilestones: Record<string, string> = {
  order_created: "Pedido recibido", review_started: "En revisión", revision_proposed: "Propuesta enviada",
  revision_approved: "Propuesta aceptada", order_confirmed: "Confirmado", delivery_recorded: "Entrega registrada",
  order_fully_delivered: "Entregado", order_cancelled: "Cancelado", order_rejected: "Rechazado",
};
export function adminOrderDelivered(events: {type:string;createdAt:string;id:number}[]) {
  return [...events].sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||a.id-b.id)
    .filter(event=>["order_fully_delivered","order_delivery_completion_reversed"].includes(event.type)).at(-1)?.type === "order_fully_delivered";
}
export function adminCommercialTracking(events: {id: number;type: string;createdAt: string}[]) {
  const sorted = [...events].sort((a,b) => Date.parse(a.createdAt)-Date.parse(b.createdAt) || a.id-b.id);
  const end = sorted.findIndex(event => ["order_cancelled","order_rejected"].includes(event.type));
  return (end < 0 ? sorted : sorted.slice(0,end+1)).flatMap(event => commercialMilestones[event.type]
    ? [{id:String(event.id),label:commercialMilestones[event.type],at:event.createdAt,terminal:["order_cancelled","order_rejected"].includes(event.type)}] : []);
}

export function historicalOrder(status: string, delivered = false) {
  return ["cancelled", "rejected"].includes(status) || delivered;
}

export function commercialHistory(events: {id:number;type:string;createdAt:string}[]) {
  const labels: Record<string,string> = {...commercialMilestones,
    order_confirmed:"Pedido confirmado", order_cancelled:"Pedido cancelado", order_rejected:"Pedido rechazado",
    revision_rejected:"Propuesta rechazada", delivery_correction_recorded:"Entrega corregida",
    physical_return_recorded:"Devolución física registrada", order_delivery_completion_reversed:"Entrega completa rectificada"};
  return [...events].sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||a.id-b.id)
    .flatMap(event=>labels[event.type] ? [{id:String(event.id),label:labels[event.type],at:event.createdAt}] : []);
}
export function commercialStateClass(status:string, delivered=false) {
  if (["cancelled","rejected"].includes(status)) return "border-red-400/40 bg-red-950/30 text-red-200";
  if (delivered || status === "confirmed") return "border-emerald-300/30 bg-emerald-950/20 text-emerald-200";
  if (["in_review","awaiting_customer"].includes(status)) return "border-amber-300/30 bg-amber-950/20 text-amber-200";
  return "border-white/10 bg-white/5 text-zinc-300";
}
