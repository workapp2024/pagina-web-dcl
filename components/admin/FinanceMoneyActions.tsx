"use client";

import { useRef, useState } from "react";
import { createFinanceIdempotencyKey } from "@/components/admin/FinancesManager";

const input = "mt-1 min-h-11 w-full min-w-0 rounded-xl border border-white/15 bg-zinc-950 px-3 text-base";
export function FinanceMoneyActions({ accounts, onSaved }: { accounts: { id: string; name: string }[]; onSaved: () => void }) {
  const [mode, setMode] = useState<"income" | "cash_withdrawal" | "transfer" | null>(null);
  const [form, setForm] = useState({ accountId: "", amount: "", party: "", reason: "", toAccountId: "", kind: "cash_contribution" });
  const [requestKey, setRequestKey] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  function start(next: "income" | "cash_withdrawal" | "transfer") { setMode(next); setForm({ accountId: "", amount: "", party: "", reason: "", toAccountId: "", kind: next === "income" ? "cash_contribution" : "cash_withdrawal" }); setRequestKey(createFinanceIdempotencyKey()); setAttempted(false); setError(""); setNotice(""); }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!mode || inFlight.current) return;
    const amount = Number(form.amount);
    if (!form.accountId || !accounts.some(account => account.id === form.accountId) || !Number.isFinite(amount) || amount <= 0 || amount > 100000000 || Math.abs(amount*100-Math.round(amount*100))>0.0001 || (mode !== "transfer" && !form.party.trim()) || !form.reason.trim()) return;
    if (mode === "transfer" && (form.toAccountId === form.accountId || !accounts.some(account => account.id === form.toAccountId))) { setError("Elegí dos cuentas diferentes."); return; }
    const accountName = (id: string) => accounts.find(account => account.id === id)?.name || "Cuenta";
    if (!attempted && !window.confirm(mode === "transfer" ? `¿Registrar ${amount.toFixed(2)} ARS de ${accountName(form.accountId)} a ${accountName(form.toAccountId)}? Confirmá que la transferencia real se realizó. No cambia el sector del dinero.` : `¿Confirmás ${mode === "income" ? "el ingreso" : "el retiro"} de ${amount.toFixed(2)} ARS en ${accountName(form.accountId)}? Quedará sin atribución a un sector.`)) return;
    inFlight.current = true; setBusy(true); setAttempted(true); setError("");
    let saved = false;
    try {
      const payload = mode === "transfer" ? {action:"transfer",fromAccountId:form.accountId,toAccountId:form.toAccountId,amount,description:form.reason.trim(),idempotencyKey:requestKey} : { action: "movement", type: form.kind === "purchase" ? "expense" : form.kind, accountId: form.accountId, amount: mode === "income" ? amount : -amount,
        description: `${form.kind === "purchase" ? "Compra de mercadería. " : ""}${mode === "income" ? "Origen" : "Destino"}: ${form.party.trim()}. Motivo: ${form.reason.trim()}`, idempotencyKey: requestKey };
      const response = await fetch("/api/admin/finances", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || body.message || "No se pudo registrar el movimiento.");
      saved = true;
    } catch (cause) { setError(`${cause instanceof Error ? cause.message : "No se pudo confirmar el resultado."} Podés reintentar con los mismos datos y la misma clave.`); }
    finally { inFlight.current = false; setBusy(false); }
    if (saved) { setMode(null); setNotice(mode === "transfer" ? "Transferencia entre cuentas registrada. El total de DCL no cambia." : "Movimiento registrado sin atribución a un sector."); onSaved(); }
  }
  return <section aria-label="Operaciones de dinero" className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-3"><button disabled={Boolean(mode)} onClick={() => start("income")} className="min-h-12 rounded-xl bg-red-600 px-5 py-3 font-bold disabled:opacity-40">Ingresar dinero</button><button disabled={Boolean(mode)} onClick={() => start("cash_withdrawal")} className="min-h-12 rounded-xl border border-white/20 px-5 py-3 font-bold disabled:opacity-40">Retirar dinero</button><button disabled={Boolean(mode) || accounts.length < 2} onClick={() => start("transfer")} className="min-h-12 rounded-xl border border-white/20 px-5 py-3 font-bold disabled:opacity-40">Transferir dinero</button></div>
    <details className="text-sm text-zinc-400"><summary className="min-h-11 cursor-pointer py-3">Qué operación elegir</summary><p className="pb-3">Ingresos y retiros generales quedan sin sector. Transferir mueve dinero entre cuentas financieras; no reparte dinero entre Minoristas y Mayoristas. Cambiar sector, elegir otra fecha y revertir movimientos manuales requieren autorizar el procedimiento preparado. No se generan ventas ni movimientos de stock desde aquí.</p></details>
    {notice && <p role="status" className="text-sm text-emerald-200">{notice}</p>}
    {mode && <form onSubmit={submit} className="space-y-4 rounded-2xl border border-white/10 bg-zinc-900/50 p-4 sm:p-5">
      <h2 className="text-lg font-bold">{mode === "income" ? "Ingresar dinero" : mode === "transfer" ? "Transferir entre cuentas financieras" : "Retirar dinero"}</h2>
      <p className="text-sm text-zinc-400">Fecha y hora: al confirmar. El procedimiento actual registra la fecha del sistema.</p>
      <fieldset disabled={busy || attempted} className="grid gap-4 sm:grid-cols-2 disabled:opacity-70">
        <label className="text-sm text-zinc-400">Cuenta financiera<select required value={form.accountId} onChange={e => setForm({ ...form, accountId: e.target.value })} className={input}><option value="">Elegí una cuenta</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        <label className="text-sm text-zinc-400">Importe<input required type="number" inputMode="decimal" min="0.01" max="100000000" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className={input} /></label>
        {mode === "transfer" ? <label className="text-sm text-zinc-400">Cuenta de destino<select required value={form.toAccountId} onChange={e => setForm({...form,toAccountId:e.target.value})} className={input}><option value="">Elegí una cuenta diferente</option>{accounts.filter(account=>account.id!==form.accountId).map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label> : <><label className="text-sm text-zinc-400">{mode === "income" ? "Origen del dinero" : "Destino del dinero"}<input required maxLength={120} value={form.party} onChange={e => setForm({ ...form, party: e.target.value })} className={input} /></label><label className="text-sm text-zinc-400">Concepto<select value={form.kind} onChange={e=>setForm({...form,kind:e.target.value})} className={input}>{mode === "income" ? <><option value="cash_contribution">Aporte de dinero</option><option value="income">Otro ingreso manual</option></> : <><option value="cash_withdrawal">Retiro del propietario</option><option value="expense">Gasto operativo</option><option value="purchase">Compra de mercadería</option></>}</select></label></>}
        <label className="text-sm text-zinc-400">Motivo<input required maxLength={300} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} className={input} /></label>
      </fieldset>
      {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
      <div className="flex flex-wrap gap-3"><button disabled={busy} className="min-h-12 rounded-xl bg-red-600 px-5 py-3 font-bold disabled:opacity-40">{busy ? "Registrando…" : attempted ? "Reintentar la misma operación" : "Confirmar movimiento"}</button><button type="button" disabled={busy} onClick={() => { if (!attempted || window.confirm("El resultado puede estar pendiente de confirmar. Revisá el historial antes de registrar otra operación. ¿Cerrar este formulario?")) setMode(null); }} className="min-h-12 rounded-xl border border-white/15 px-5 py-3">Cerrar</button></div>
    </form>}
  </section>;
}
