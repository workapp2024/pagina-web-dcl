"use client";

import { useRef, useState } from "react";

export function WholesalePaymentForm({ due, currency, saving, accounts, onPayment }: {
  due: number; currency: string; saving: boolean;
  accounts: { method: string; name: string }[];
  onPayment: (fields: Record<string, unknown>) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [received, setReceived] = useState(false);
  const [attempt, setAttempt] = useState<Record<string, unknown> | null>(null);
  const inFlight = useRef(false);
  const money = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(n);
  const account = accounts.find(row => row.method === method);
  const valid = Number.isFinite(Number(amount)) && Number(amount) > 0 && Number(amount) <= due && Math.abs(Number(amount) * 100 - Math.round(Number(amount) * 100)) < 0.000001;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || saving || (!attempt && (!valid || !received || !account || currency !== "ARS"))) return;
    inFlight.current = true;
    const fields = attempt ?? { amount: Number(amount), method, externalReference: reference.trim() || null, occurredAt: new Date().toISOString() };
    setAttempt(fields);
    try {
      if (await onPayment(fields)) { setOpen(false); setAmount(""); setReceived(false); setReference(""); setAttempt(null); }
    } finally { inFlight.current = false; }
  }
  if (!open) return <button type="button" disabled={saving} onClick={() => setOpen(true)} className="min-h-12 w-full rounded-xl bg-red-600 px-5 py-3 font-bold disabled:opacity-50">Registrar pago</button>;
  const field = "mt-1 min-h-12 w-full rounded-xl border border-white/15 bg-zinc-950 px-3 py-3 text-white";
  return <form onSubmit={submit} className="space-y-4 rounded-xl border border-white/10 p-4">
    <h4 className="font-bold">Registrar pago</h4><p>Saldo pendiente: <b>{money(due)}</b></p>
    <fieldset disabled={saving || Boolean(attempt)} className="space-y-4 disabled:opacity-60">
      <label className="block text-sm text-zinc-300">Importe recibido<input required type="number" inputMode="decimal" min="0.01" max={due} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className={field} /></label>
      <button type="button" onClick={() => setAmount(due.toFixed(2))} className="min-h-12 rounded-xl border border-white/20 px-5 py-3">Cobrar todo</button>
      <label className="block text-sm text-zinc-300">Medio de pago<select value={method} onChange={e => { setMethod(e.target.value); setReceived(false); }} className={field}><option value="cash">Efectivo</option><option value="bank_transfer">Transferencia</option><option value="mercadopago">Mercado Pago · recibido manualmente</option></select></label>
      {account ? <p className="text-sm text-zinc-400">Se registrará automáticamente en {account.name}, atribuido a Mayoristas.</p> : <p role="alert" className="text-sm text-amber-200">Falta configurar la cuenta de este medio en Finanzas. No registres el pago nuevamente si ya figura cobrado.</p>}
      {currency !== "ARS" && <p role="alert" className="text-sm text-amber-200">La imputación automática solo admite pesos argentinos.</p>}
      {method === "mercadopago" && <p className="text-sm text-amber-200">Solo para dinero recibido fuera de un cobro automático. Los pagos automáticos los confirma el proveedor: no los registres otra vez aquí.</p>}
      <label className="block text-sm text-zinc-300">Referencia {method === "cash" ? "(opcional)" : "del comprobante"}<input required={method !== "cash"} maxLength={200} value={reference} onChange={e => setReference(e.target.value)} className={field} /></label>
      <label className="flex min-h-12 items-center gap-3 text-sm"><input type="checkbox" required checked={received} onChange={e => setReceived(e.target.checked)} />{method === "cash" ? "Confirmo que recibí el efectivo." : "Verifiqué que el dinero fue recibido y que este cobro no está registrado."}</label>
    </fieldset>
    {attempt && <p className="text-sm text-amber-200">Si el resultado es incierto, reintentá el mismo pago. Conservamos los datos y la clave para evitar duplicados.</p>}
    <button disabled={saving || (!attempt && (!valid || !received || !account || currency !== "ARS"))} className="min-h-12 w-full rounded-xl bg-red-600 px-5 py-3 font-bold disabled:opacity-50">{saving ? "Registrando…" : attempt ? "Reintentar el mismo pago" : "Confirmar pago recibido"}</button>
    {!attempt && <button type="button" disabled={saving} onClick={() => setOpen(false)} className="min-h-12 w-full rounded-xl border border-white/15 px-5 py-3">Cancelar</button>}
  </form>;
}
