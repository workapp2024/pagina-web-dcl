"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FinancePresentationData } from "@/lib/finance-presentation";
import { FinancesManager } from "@/components/admin/FinancesManager";
import { FinanceCashHistory } from "@/components/admin/FinanceCashHistory";
import { FinanceMoneyActions } from "@/components/admin/FinanceMoneyActions";

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
  const cash = current?.cashBySector;
  const summary = cash && sector !== "general" ? cash[sector] : null;
  const money = (value: number | undefined) => value === undefined || !Number.isFinite(value) ? "No disponible" : hidden ? "••••••" : new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(value);
  const pendingRetail = current?.retailPending ?? [];
  const pendingWholesale = current?.wholesale?.pendingFinancialEntries ?? [];
  const pendingCount = sector === "minoristas" ? pendingRetail.length : sector === "mayoristas" ? pendingWholesale.length : pendingRetail.length + pendingWholesale.length;
  const cards: [string, number | undefined][] = sector === "general" ? [
    ["Total consolidado", cash?.total], ["Minoristas", cash?.minoristas.available], ["Mayoristas", cash?.mayoristas.available],
    ...(cash && cash.unassigned.available !== 0 ? [["Sin atribución", cash.unassigned.available] as [string, number]] : []),
  ] : [["Saldo registrado del sector", summary?.available], ["Ingresos del período", summary?.income], ["Egresos del período", summary?.expense]];
  return <main className="mx-auto min-w-0 w-full max-w-5xl space-y-6 pb-10">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-red-300">DCL · Administración</p><h1 className="mt-2 text-3xl font-black">{sector === "general" ? "Finanzas generales" : `Finanzas ${sector}`}</h1><p className="mt-2 text-sm text-zinc-400">Dinero contabilizado, sin confundir ventas con cobros.</p></div><div className="flex flex-wrap gap-2"><button onClick={() => setRefresh(value => value+1)} className="min-h-11 rounded-xl border border-white/15 px-4 text-sm">Actualizar</button><button onClick={() => setHidden(value => !value)} className="min-h-11 rounded-xl border border-white/15 px-4 text-sm">{hidden ? "Mostrar montos" : "Ocultar montos"}</button></div></header>
    {error && <p role="alert" className="rounded-xl border border-red-400/30 p-4 text-red-200">{error}</p>}
    {!current && !error && <p role="status">Consultando período…</p>}
    {current?.activated && <>
      <label className="block text-sm text-zinc-400">Período<select value={period || current.selectedPeriod?.id || ""} onChange={e => setPeriod(e.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-zinc-900 px-3 text-base text-white">{current.periods.map(item => <option key={item.id} value={item.id}>{item.name}{item.status === "open" ? " · actual" : " · cerrado"}</option>)}</select></label>
      {!cash && <p role="alert" className="text-sm text-amber-200">No se pudo determinar la atribución del dinero. Actualizá la consulta antes de operar.</p>}
      <dl className={`grid gap-3 ${sector === "general" ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>{cards.map(([label,value]) => <div key={label} className={`min-w-0 rounded-2xl border p-5 ${label === "Total consolidado" ? "border-red-400/30 bg-red-400/5" : "border-white/10 bg-zinc-900/40"}`}><dt className="text-sm text-zinc-400">{label}</dt><dd className="mt-2 break-words text-2xl font-black [overflow-wrap:anywhere]">{money(value)}</dd></div>)}</dl>
      {cash?.attributionNeedsReview && <p role="alert" className="text-sm text-amber-200">Revisar movimientos sin sector.</p>}
      <details className="rounded-xl border border-white/10 px-4"><summary className="min-h-11 cursor-pointer py-3 text-sm text-zinc-400">Ayuda sobre los saldos</summary><div className="space-y-3 pb-4 text-sm leading-6 text-zinc-400"><p>Disponibilidad para retirar: sin verificar. Los saldos son los registrados por DCL.</p><p>Un cobro aprobado no confirma que el banco o Mercado Pago ya permita retirarlo. DCL todavía no registra acreditación, retenciones y comisiones verificadas para calcular el disponible real.</p><p>Solo contamos movimientos de dinero contabilizados. Las ventas y los cobros pendientes no se suman. Los montos compartidos y las aperturas quedan sin atribuir; no se reparten automáticamente.</p><p>Las transferencias internas no son ingresos ni egresos externos. Los saldos negativos se conservan para su revisión.</p>{cash?.sharedOpening && <p>Este período incluye una apertura compartida. No hay un reparto documentado por sector en ese asiento.</p>}</div></details>
      <details className="rounded-xl border border-white/10 p-4"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Revisión administrativa{pendingCount>0 ? " · pendientes" : ""}</summary>
        {pendingCount>0 ? <p className="mt-3 text-sm text-zinc-400">{pendingCount} {pendingCount===1 ? "registro pendiente de imputar" : "registros pendientes de imputar"}. No integra{pendingCount===1 ? "" : "n"} los saldos ni debe{pendingCount===1 ? "" : "n"} cobrarse nuevamente.</p> : <p className="mt-3 text-sm text-zinc-400">Sin cobros pendientes de imputar.</p>}
        {sector!=="minoristas" && pendingWholesale.map(entry=><p key={entry.id} className="mt-2 text-sm text-zinc-400">{entry.order_number}: {money(entry.amount)} · pendiente de revisión.</p>)}
        {cash?.attributionNeedsReview && <p className="mt-3 text-sm text-amber-200">Hay movimientos sin sector que requieren identificar su origen. Se conservan los importes negativos; revisalos en el historial. No se reasignan automáticamente.</p>}
        {sector!=="mayoristas" && pendingRetail.length>0 && <p className="mt-2 text-sm">Minoristas: {pendingRetail.length} {pendingRetail.length===1 ? "pendiente" : "pendientes"}.</p>}
      </details>
      {sector !== "minoristas" && current.wholesale?.available === false && <p role="alert" className="text-sm text-amber-200">La consulta de pendientes mayoristas no está disponible.</p>}
      {cash && sector === "general" && current.selectedPeriod?.status === "open" && <FinanceMoneyActions sectorBalances={cash.byAccount} sectorEnabled={current.sectorOperationsEnabled === true} accounts={current.accounts.filter(account => account.active !== false)} onSaved={() => { setData(null); setRefresh(value => value+1); }} />}
      {cash && <details className="rounded-2xl border border-white/10 bg-zinc-900/30 p-4 sm:p-5"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Historial de movimientos</summary><FinanceCashHistory rows={cash.movements} sector={sector === "general" ? undefined : sector} accounts={current.accounts} hidden={hidden} /></details>}
      {sector === "general" && <details className="rounded-2xl border border-white/10 p-4"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Saldos por cuenta</summary><ul className="mt-3 divide-y divide-white/10">{current.accounts.map(account => <li key={account.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span>{account.name}</span><b>{money(account.balance)}</b></li>)}</ul></details>}
      {sector !== "general" && <Link href="/admin/finanzas" className="inline-block min-h-11 py-3 text-sm text-red-300">Abrir Finanzas generales →</Link>}
    </>}
    {current && !current.activated && <p className="text-sm text-amber-200">Finanzas aún no está activada. No hay saldos iniciales confirmados para presentar.</p>}
    {sector === "general" && <details onToggle={event => { const open = event.currentTarget.open; setAdvanced(open); if (!open) setRefresh(value => value+1); }} className="rounded-2xl border border-white/10 p-4"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Herramientas avanzadas</summary>{advanced && <div className="mt-5"><FinancesManager toolsOnly /></div>}</details>}
  </main>;
}
