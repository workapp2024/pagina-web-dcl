"use client";

import { useEffect, useState } from "react";
import type { AnalyticsDetail, DetailKind, DetailResult } from "@/lib/posthog-admin";

const labels: Record<DetailKind, string> = {
  visitors: "Visitantes", sessions: "Sesiones", pages: "Páginas vistas", products: "Productos vistos",
  cart: "Agregados al carrito", vehicles: "Búsquedas por vehículo", connectors: "Búsquedas por conector",
  checkout: "Checkout iniciado (entrada)", whatsapp: "Clics comerciales a WhatsApp",
};

export function AnalyticsDetails({ metrics, period, from, to, replayUrl }: {
  metrics: { kind: DetailKind; value: number | null }[];
  period: string; from?: string; to?: string; replayUrl?: string;
}) {
  const [selected, setSelected] = useState<DetailKind | null>(null);
  const [result, setResult] = useState<DetailResult | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ kind: selected, period });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    fetch(`/api/admin/analytics/detail?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("No se pudo cargar el detalle.");
        return response.json() as Promise<DetailResult>;
      })
      .then(setResult)
      .catch(() => { if (!controller.signal.aborted) setResult({ status: "error", message: "No se pudo cargar el detalle." }); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selected, period, from, to]);
  const toggle = (kind: DetailKind) => {
    setResult(null);
    setLoading(selected !== kind);
    setSelected(selected === kind ? null : kind);
  };
  return <>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Indicadores de Analítica">
      {metrics.map(({ kind, value }) => <button key={kind} type="button" aria-expanded={selected === kind} aria-controls="analytics-detail" onClick={() => toggle(kind)} className={`min-h-28 rounded-lg border p-4 text-left transition-colors hover:border-red-400 focus-visible:outline-2 focus-visible:outline-red-400 ${selected === kind ? "border-red-400 bg-red-500/10" : "border-white/10 bg-white/5"}`}>
        <span className="block text-xs uppercase text-zinc-400">{labels[kind]}</span><b className="mt-2 block text-3xl">{value === null ? "No disponible" : value}</b>
        <span className="mt-2 block text-xs text-red-300">Ver detalle ›</span>
      </button>)}
    </section>
    {selected && <section id="analytics-detail" aria-label={`Detalle de ${labels[selected]}`} className="border-t border-white/10 pt-5" aria-live="polite">
      <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">{labels[selected]}</h2><button type="button" onClick={() => toggle(selected)} className="rounded border border-white/20 px-3 py-1 text-sm hover:bg-white/10">Cerrar</button></div>
      {loading && <p className="mt-4 text-sm text-zinc-400">Cargando detalle…</p>}
      {!loading && result?.status === "not_configured" && <p role="alert" className="mt-4 text-sm text-amber-300">Analytics no configurado.</p>}
      {!loading && result?.status === "error" && <p role="alert" className="mt-4 text-sm text-amber-300">{result.message}</p>}
      {!loading && result?.status === "ok" && <DetailTable detail={result.data} />}
      {selected === "sessions" && replayUrl && <a href={replayUrl} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm font-semibold text-red-300 underline">Ver sesiones en PostHog</a>}
    </section>}
  </>;
}

function DetailTable({ detail }: { detail: AnalyticsDetail }) {
  return <>
    {detail.stats && <div className="mt-4 flex flex-wrap gap-6">{detail.stats.map(([name, value]) => <p key={name} className="text-sm text-zinc-300">{name}: <b className="text-white">{value}</b></p>)}</div>}
    {detail.note && <p className="mt-3 text-sm text-zinc-400">{detail.note}</p>}
    {!detail.rows.length ? <p className="mt-4 text-sm text-zinc-400">Sin datos para este rango.</p> : <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[460px] text-left text-sm"><thead><tr className="border-b border-white/15 text-zinc-400">{detail.columns.map(column => <th key={column} scope="col" className="px-2 py-2 font-medium">{column}</th>)}</tr></thead><tbody>{detail.rows.map((row, index) => <tr key={`${row.label}-${index}`} className="border-b border-white/10"><th scope="row" className="px-2 py-2 font-medium">{row.label}{row.productId && <small className="ml-2 text-zinc-500">{row.productId}</small>}</th>{row.values.map((value, cell) => <td key={cell} className="px-2 py-2">{value === null ? "No disponible" : value}</td>)}</tr>)}</tbody></table></div>}
    {detail.secondary && <><h3 className="mt-6 font-semibold">{detail.secondary.title}</h3><DetailTable detail={detail.secondary} /></>}
  </>;
}
