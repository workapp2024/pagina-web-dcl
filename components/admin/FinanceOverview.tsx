"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { sectorFinancialPresentation, type CurrencyAmount, type FinancePresentationData } from "@/lib/finance-presentation";
import { FinancesManager } from "@/components/admin/FinancesManager";
import { SearchableList } from "@/components/admin/SearchableList";

function amounts(rows: CurrencyAmount[] | null) {
  if (!rows) return "No disponible";
  if (!rows.length) return "Sin datos";
  return rows.map(row => new Intl.NumberFormat("es-AR", { style: "currency", currency: row.currency }).format(row.amount)).join(" · ");
}

export function FinanceOverview({ sector = "general" }: { sector?: "general" | "minoristas" | "mayoristas" }) {
  const [data, setData] = useState<FinancePresentationData | null>(null);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState("");
  const [hidden, setHidden] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/admin/finances?${new URLSearchParams(period ? { periodId: period } : {})}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok || !body.data) throw new Error(body.message || body.error || "No se pudo consultar Finanzas.");
        if (!controller.signal.aborted) { setData(body.data); setError(""); }
      } catch (cause) { if (!controller.signal.aborted) { setData(null); setError(cause instanceof Error ? cause.message : "No se pudo consultar Finanzas."); } }
    })();
    return () => controller.abort();
  }, [period, refresh]);
  const current = !period || data?.selectedPeriod?.id === period ? data : null;
  const sectorData = current && sector !== "general" ? sectorFinancialPresentation(current, sector) : null;
  const display = (value: string) => hidden && !["No disponible", "Sin datos"].includes(value) ? "••••••" : value;
  const pending = current?.wholesale?.pendingFinancialEntries ?? [];
  const title = sector === "general" ? "Finanzas generales" : `Finanzas ${sector}`;
  return <div className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-red-300">DCL · Administración</p><h1 className="mt-2 text-3xl font-black">{title}</h1><p className="mt-2 text-sm text-zinc-400">{sector === "general" ? "Saldos consolidados de DCL, contados una sola vez." : "Información del sector; ventas y cobros se consultan por separado."}</p></div><div className="flex flex-wrap gap-2"><button onClick={() => setRefresh(value => value + 1)} className="min-h-11 rounded-xl border border-white/15 px-4 text-sm">Actualizar</button><button onClick={() => setHidden(value => !value)} className="min-h-11 rounded-xl border border-white/15 px-4 text-sm">{hidden ? "Mostrar montos" : "Ocultar montos"}</button></div></header>
    {error && <p role="alert" className="rounded-xl border border-red-400/30 p-4 text-red-200">{error}</p>}
    {!current && !error && <p role="status">Consultando período…</p>}
    {current?.activated && <>
      <label className="block text-sm text-zinc-400">Período<select value={period || current.selectedPeriod?.id || ""} onChange={event => setPeriod(event.target.value)} className="ml-3 min-h-11 max-w-full rounded-xl bg-zinc-900 px-3 text-white">{current.periods.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {sectorData ? <>
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
          ["Dinero disponible", amounts(sectorData.cash)], ["Ventas", amounts(sectorData.sales)],
          ["Saldo por cobrar", amounts(sectorData.receivables)], ["Ganancia estimada", amounts(sectorData.profit)],
        ].map(([label, value]) => <div key={label} className="border-l-2 border-red-400/40 px-4 py-2"><dt className="text-sm text-zinc-400">{label}</dt><dd className="mt-2 break-words text-lg font-bold">{display(value)}</dd></div>)}</dl>
        <p className="text-sm leading-6 text-zinc-400">Las cuentas se comparten entre sectores; su saldo no puede separarse de forma fiable. Las ventas no equivalen a dinero cobrado. La ganancia es una estimación y requiere costos históricos completos.</p>
        <details className="rounded-xl border border-white/10 p-4"><summary className="min-h-11 cursor-pointer font-semibold">Cobros, saldos y movimientos del sector</summary>
          {sector === "mayoristas" && <><p className="my-3 text-sm">Cobros del período: {display(amounts(current.wholesale?.available ? current.wholesale.received ?? null : null))}</p><p className="my-3 text-sm">Reembolsos del período: {display(amounts(current.wholesale?.available ? current.wholesale.refunds ?? null : null))}</p><ul className="divide-y divide-white/10">{current.wholesale?.available && current.wholesale.receivables?.map(row => <li key={row.order_number} className="py-3 text-sm">{row.order_number} · {row.customer_name}<b className="ml-3">{display(amounts([row]))}</b></li>)}</ul></>}
          <p className="my-3 text-xs text-zinc-400">Solo movimientos con referencia fiable al sector. El historial está limitado a los últimos 1.000 registros del período; no se usa para calcular el dinero disponible.</p>
          <SearchableList rows={sectorData.movements} label="Historial" placeholder="Descripción, fecha, tipo o importe" searchText={movement => [movement.description, movement.occurred_at, new Date(movement.occurred_at).toLocaleDateString("es-AR"), movement.movement_type, movement.amount]}>
            {movements => <ul className="divide-y divide-white/10">{movements.map(movement => <li key={movement.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span>{movement.description}<time className="mt-1 block text-xs text-zinc-400">{new Date(movement.occurred_at).toLocaleString("es-AR")}</time></span><b>{display(amounts([{ currency: movement.currency || "ARS", amount: Number(movement.amount) }]))}</b></li>)}</ul>}
          </SearchableList>
        </details>
        <Link href="/admin/finanzas" className="inline-block min-h-11 py-3 text-sm text-red-300">Abrir herramientas financieras generales →</Link>
      </> : <>
        <dl className="grid gap-4 sm:grid-cols-3"><div className="border-l-2 border-red-400 px-4 py-2"><dt className="text-sm text-zinc-400">Total consolidado</dt><dd className="mt-2 text-2xl font-black">{display(amounts(Number.isFinite(current.totalAvailable) ? [{ currency: "ARS", amount: current.totalAvailable! }] : null))}</dd></div>{["Minoristas", "Mayoristas"].map(label => <div key={label} className="border-l border-white/15 px-4 py-2"><dt className="text-sm text-zinc-400">Dinero de {label}</dt><dd className="mt-2 font-semibold">No disponible</dd></div>)}</dl>
        <p className="text-sm text-zinc-400">El total incluye los cobros ya contabilizados. Los saldos compartidos quedan sin asignar a un sector.</p>
        <details className="rounded-xl border border-white/10 p-4"><summary className="min-h-11 cursor-pointer font-semibold">Saldos por cuenta</summary><ul className="divide-y divide-white/10">{current.accounts.map(account => <li key={account.id} className="flex justify-between gap-3 py-3 text-sm"><span>{account.name}</span><b>{display(amounts([{ currency: "ARS", amount: account.balance }]))}</b></li>)}</ul></details>
      </>}
    </>}
    {current && sector !== "minoristas" && pending.length > 0 && <details className="rounded-xl border border-amber-400/30 p-4"><summary className="min-h-11 cursor-pointer font-semibold text-amber-200">{pending.length} movimientos mayoristas pendientes de imputación</summary><p className="mb-3 text-sm text-zinc-400">No integran el dinero disponible. Un cobro y su contrarregistro son registros distintos y deben revisarse juntos.</p><ul className="divide-y divide-white/10">{pending.map(entry => <li key={entry.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span>{entry.order_number} · {entry.entry_type === "refund" ? "Contrarregistro / reembolso" : "Cobro"}<small className="block text-zinc-400">{entry.status === "pending_mapping" ? "Falta asignar cuenta" : entry.status === "pending_period" ? "Falta período disponible" : "Requiere revisión de moneda"}</small></span><b>{display(amounts([{ currency: entry.currency, amount: entry.amount }]))}</b></li>)}</ul></details>}
    {current && !current.activated && <p className="text-sm text-amber-200">Finanzas aún no está activada. No hay saldos iniciales confirmados para presentar.</p>}
    {sector === "general" && <details onToggle={event => { const open = event.currentTarget.open; setAdvanced(open); if (!open) setRefresh(value => value + 1); }} className="rounded-xl border border-white/10 p-4"><summary className="min-h-11 cursor-pointer font-semibold">Gestión avanzada: movimientos, gastos, cuentas y reportes</summary>{advanced && <div className="mt-5"><FinancesManager /></div>}</details>}
  </div>;
}
