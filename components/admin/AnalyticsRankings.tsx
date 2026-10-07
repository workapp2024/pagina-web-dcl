"use client";

import { useState } from "react";
import type { RankingResult } from "@/lib/analytics-v2";

export type AnalyticsRankingTab = { id: string; label: string; unit: string; result: RankingResult };
export function AnalyticsRankingRows({ result, unit }: { result: RankingResult; unit: string }) {
  if (result.status !== "ok") return <p className="py-4 text-sm text-zinc-400">No disponible en este momento.</p>;
  if (!result.rows.length) return <p className="py-4 text-sm text-zinc-400">Sin registros en este período.</p>;
  return <ol className="divide-y divide-white/10">{result.rows.slice(0, 5).map(row => <li key={row.key} className="flex min-w-0 items-center justify-between gap-3 py-3 text-sm">
    <span className="min-w-0 break-words text-zinc-200">{row.label}</span>
    <span className="shrink-0 text-right"><b className="block tabular-nums">{new Intl.NumberFormat("es-AR").format(row.count)}</b><span className="text-[11px] text-zinc-500">{unit}</span></span>
  </li>)}</ol>;
}
export function AnalyticsRankings({ id, title, tabs }: { id: string; title: string; tabs: AnalyticsRankingTab[] }) {
  const [active, setActive] = useState(tabs[0].id);
  const selected = tabs.find(tab => tab.id === active) || tabs[0];
  return <section aria-labelledby={`${id}-title`} className="min-w-0 rounded-2xl border border-white/10 p-3 sm:p-4">
    <h2 id={`${id}-title`} className="text-base font-bold">{title}</h2>
    <div aria-label={`Vistas de ${title}`} className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-white/5 p-1">{tabs.map(tab => <button key={tab.id} type="button" aria-pressed={active === tab.id} aria-controls={`${id}-ranking`} onClick={() => setActive(tab.id)}
      className={`min-h-11 min-w-0 rounded-lg px-1 py-2 text-[11px] font-semibold leading-4 transition sm:text-xs ${active === tab.id ? "bg-zinc-700 text-white" : "text-zinc-400 hover:bg-white/10"}`}>{tab.label}</button>)}</div>
    <div id={`${id}-ranking`} aria-live="polite" aria-label={selected.label} className="mt-1"><AnalyticsRankingRows result={selected.result} unit={selected.unit}/></div>
  </section>;
}
