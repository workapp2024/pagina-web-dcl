"use client";

import { useState } from "react";
import type { AttributedCashRow } from "@/lib/finance-sector-cash";
import { matchesAdminSearch } from "@/components/admin/SearchableList";

export const financeSectorLabels = { minoristas: "Minoristas", mayoristas: "Mayoristas", unassigned: "Sin atribución" };
export const financeCashLabels: Record<string, string> = { sale_income: "Cobro minorista", sale_reversal: "Reversión minorista", income: "Ingreso manual", expense: "Gasto", cash_contribution: "Aporte de dinero", cash_withdrawal: "Retiro del propietario", adjustment: "Ajuste o reversión", refund: "Reembolso", opening_balance: "Apertura", transfer: "Transferencia interna" };
const input = "mt-1 min-h-11 w-full min-w-0 rounded-xl border border-white/10 bg-zinc-950 px-3 text-base";
export function FinanceCashHistory({ rows, sector, accounts, hidden }: { rows: AttributedCashRow[]; sector?: "minoristas" | "mayoristas"; accounts: { id: string; name: string }[]; hidden: boolean }) {
  const [filters, setFilters] = useState({ q: "", from: "", to: "", type: "", sector: "", min: "", max: "" });
  const [page, setPage] = useState(1);
  const change = (key: keyof typeof filters, value: string) => { setFilters(current => ({ ...current, [key]: value })); setPage(1); };
  const names = new Map(accounts.map(account => [account.id, account.name]));
  const money = (value: number) => hidden ? "••••••" : new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(value);
  const filtered = rows.filter(row => {
    const day = new Date(row.occurred_at).toLocaleDateString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" });
    const type = row.transfer_id ? "transfer" : row.wholesale_payment_entry_id ? (row.amount < 0 ? "refund" : "income") : row.movement_type;
    return (!sector || row.sector === sector) && (!filters.sector || row.sector === filters.sector)
      && (!filters.from || day >= filters.from) && (!filters.to || day <= filters.to)
      && (!filters.type || type === filters.type)
      && (!filters.min || Math.abs(row.amount) >= Number(filters.min)) && (!filters.max || Math.abs(row.amount) <= Number(filters.max))
      && matchesAdminSearch(filters.q, [row.description, financeCashLabels[type], financeSectorLabels[row.sector], names.get(row.account_id || ""), row.amount, day, row.operation?.id, row.id, row.order_number]);
  });
  const pages = Math.max(1, Math.ceil(filtered.length / 25)), current = Math.min(page, pages);
  return <div className="mt-4 min-w-0 space-y-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm text-zinc-400">Buscar<input type="search" value={filters.q} onChange={e => change("q",e.target.value)} placeholder="Motivo, cuenta o importe" className={input} /></label>
      <label className="text-sm text-zinc-400">Tipo<select value={filters.type} onChange={e => change("type",e.target.value)} className={input}><option value="">Todos</option>{Object.entries(financeCashLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {!sector && <label className="text-sm text-zinc-400">Sector<select value={filters.sector} onChange={e => change("sector",e.target.value)} className={input}><option value="">Todos</option>{Object.entries(financeSectorLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
      {([['from','Desde'],['to','Hasta']] as const).map(([key,label]) => <label key={key} className="text-sm text-zinc-400">{label}<input type="date" value={filters[key]} onChange={e => change(key,e.target.value)} className={input} /></label>)}
      {([['min','Importe mínimo'],['max','Importe máximo']] as const).map(([key,label]) => <label key={key} className="text-sm text-zinc-400">{label}<input type="number" min="0" step="0.01" inputMode="decimal" value={filters[key]} onChange={e => change(key,e.target.value)} className={input} /></label>)}
    </div>
    <p className="text-xs text-zinc-500">{filtered.length} movimientos del período.</p>
    <ul className="divide-y divide-white/10">{filtered.slice((current-1)*25,current*25).map(row => <li key={row.id} className="min-w-0 py-4">
      <time className="block text-xs text-zinc-500">{new Date(row.occurred_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}</time>
      <div className="mt-2 flex flex-wrap justify-between gap-2"><b className="min-w-0 break-words text-sm [overflow-wrap:anywhere]">{(row.description || (row.transfer_id ? "Transferencia interna" : financeCashLabels[row.movement_type] || "Movimiento")).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,"operación vinculada")}</b><b className={row.amount < 0 ? "text-red-200" : "text-emerald-200"}>{money(row.amount)}</b></div>
      <p className={`mt-1 text-xs ${row.amount < 0 ? "text-red-200" : "text-emerald-200"}`}>{(row.operation?.reverse_of || (row.operation?.action === "reverse" && row.operation?.legacy_movement_id) || row.reversal_of_id) ? "Reversión · " : ""}{row.operation?.action === "reclassify" && "Reclasificado · "}{row.transfer_id ? (row.amount < 0 ? "↗ Transferencia enviada" : "↙ Transferencia recibida") : row.movement_type === "opening_balance" ? "Saldo inicial" : row.amount < 0 ? "− Egreso" : "+ Ingreso"}</p>
      <details className="mt-2 text-sm text-zinc-400"><summary className="min-h-11 cursor-pointer py-3">Ver detalle</summary><dl className="space-y-2 break-words [overflow-wrap:anywhere]">
        <div><dt>Cuenta</dt><dd>{names.get(row.account_id || "") || "No disponible"}</dd></div><div><dt>Sector</dt><dd>{financeSectorLabels[row.sector]}</dd></div>
        <div><dt>Tipo</dt><dd>{row.transfer_id ? "Transferencia interna" : row.wholesale_payment_entry_id ? (row.amount < 0 ? "Reembolso mayorista" : "Cobro mayorista") : financeCashLabels[row.movement_type] || "Movimiento"}</dd></div>
        {row.operation?.request.from && <div><dt>Sector de origen</dt><dd>{financeSectorLabels[row.operation.request.from]}</dd></div>}{row.operation?.request.to && <div><dt>Sector de destino</dt><dd>{financeSectorLabels[row.operation.request.to]}</dd></div>}
        {row.operation?.request.party && <div><dt>Origen / destino externo</dt><dd>{row.operation.request.party}</dd></div>}
        {row.payment_method && <div><dt>Medio de pago</dt><dd>{({cash:"Efectivo",transfer:"Transferencia",bank_transfer:"Transferencia",mercadopago:"Mercado Pago",card:"Tarjeta",debit_card:"Débito",credit_card:"Crédito",other:"Otro"} as Record<string,string>)[row.payment_method] || "Otro"}</dd></div>}
        {row.order_number && <div><dt>Pedido</dt><dd>{row.order_number}</dd></div>}
        {(row.operation?.created_at || row.created_at) && <div><dt>{row.operation?.action === "reclassify" ? "Reclasificado el" : "Registrado el"}</dt><dd>{new Date(row.operation?.created_at || row.created_at!).toLocaleString("es-AR",{timeZone:"America/Argentina/Buenos_Aires"})}</dd></div>}
        {row.operation?.actor_id && <div><dt>Registrado por (referencia de auditoría)</dt><dd>{row.operation.actor_id}</dd></div>}
        {(row.operation?.reverse_of || row.operation?.legacy_movement_id || row.reversal_of_id) && <div><dt>Operación original</dt><dd><button type="button" className="min-h-11 text-red-300 underline" onClick={() => { setFilters({q:(row.operation?.reverse_of || row.operation?.legacy_movement_id || row.reversal_of_id)!,from:"",to:"",type:"",sector:"",min:"",max:""}); setPage(1); }}>Ver original en este período</button><span className="block break-all text-xs">{row.operation?.reverse_of || row.operation?.legacy_movement_id || row.reversal_of_id}</span><span className="block text-xs">Si corresponde a otro período, elegilo para consultar el original.</span></dd></div>}
        <div><dt>Referencia del movimiento</dt><dd className="break-all text-xs">{row.id}</dd></div>{row.transfer_id && <div><dt>Transferencia vinculada</dt><dd className="break-all text-xs">{row.transfer_id}</dd></div>}{row.sale_id && <div><dt>Venta vinculada</dt><dd className="break-all text-xs">{row.sale_id}</dd></div>}{row.wholesale_payment_entry_id && <div><dt>Cobro vinculado</dt><dd className="break-all text-xs">{row.wholesale_payment_entry_id}</dd></div>}
      </dl></details>
    </li>)}</ul>
    {!filtered.length && <p role="status" className="text-sm text-zinc-400">No hay movimientos para estos filtros.</p>}
    {pages > 1 && <nav aria-label="Páginas del historial" className="flex flex-wrap items-center justify-between gap-3 text-sm"><button disabled={current === 1} onClick={() => setPage(current-1)} className="min-h-11 px-3 disabled:opacity-40">Anterior</button><span>{current} / {pages}</span><button disabled={current === pages} onClick={() => setPage(current+1)} className="min-h-11 px-3 disabled:opacity-40">Siguiente</button></nav>}
  </div>;
}
