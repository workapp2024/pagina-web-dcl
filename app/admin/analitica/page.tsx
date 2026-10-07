import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getStoreActivity, getStoreSearches } from "@/lib/posthog-admin";
import { analyticsDates } from "@/lib/analytics-dates";
import { getStoreSales } from "@/lib/analytics-sales";
import { getStoreProductRanking } from "@/lib/analytics-products";
import { AnalyticsRankings, AnalyticsRankingRows } from "@/components/admin/AnalyticsRankings";
import { AnalyticsFunnel, AnalyticsFunnelMeasurement } from "@/components/admin/AnalyticsFunnel";
import { getCommercialFunnel } from "@/lib/posthog-funnel";
import { unavailableRanking } from "@/lib/analytics-v2";

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string }> }) {
  if (!(await isAdminAuthenticated())) redirect("/admin/login");
  const params = await searchParams;
  const period = params.period || "30d";
  let range: { from: number; to: number } | undefined;
  let dateError = "";
  try { range = analyticsDates(period, params.from, params.to); }
  catch (error) { dateError = error instanceof Error ? error.message : "Rango de fechas inválido."; }
  const [activity, sales, funnel, viewed, added, vehicles, connectors, noResults] = range ? await Promise.all([
    getStoreActivity(range.from, range.to), getStoreSales(range.from, range.to), getCommercialFunnel(range.from, range.to),
    getStoreProductRanking("products", range.from, range.to), getStoreProductRanking("cart", range.from, range.to),
    getStoreSearches("vehicles", range.from, range.to), getStoreSearches("connectors", range.from, range.to), getStoreSearches("no_results", range.from, range.to),
  ]) : [null, null, null, unavailableRanking, unavailableRanking, unavailableRanking, unavailableRanking, unavailableRanking];
  const behavior = activity?.status === "ok" ? activity.data : null;
  const real = sales?.status === "ok" ? sales : null;
  const quantity = (value: number | null | undefined) => value == null ? "No disponible" : new Intl.NumberFormat("es-AR").format(value);
  const kpis = [
    ["Visitantes medidos", quantity(behavior?.visitors)], ["Sesiones con carrito", quantity(behavior?.cartSessions)],
    ["Compras", quantity(real?.purchases)], ["Importe vendido", real ? new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(real.amount) : "No disponible"],
  ];
  const rangeLabel = range ? new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "short", year: "numeric" }) : null;
  return <div className="min-w-0 space-y-4">
    <header><h1 className="text-2xl font-black sm:text-3xl">Analítica</h1><p className="mt-1 text-sm text-zinc-400">Cómo está funcionando tu tienda</p></header>
    <nav aria-label="Período de analítica" className="grid grid-cols-4 gap-1 rounded-xl bg-white/5 p-1">{[["today", "Hoy"], ["7d", "7 días"], ["30d", "30 días"], ["custom", "Personalizado"]].map(([value, label]) => <Link key={value} href={value === "custom" ? `/admin/analitica?${new URLSearchParams({ period: value, ...(params.from ? { from: params.from } : {}), ...(params.to ? { to: params.to } : {}) })}` : `/admin/analitica?period=${value}`} aria-current={period === value ? "page" : undefined}
      className={`flex min-h-11 min-w-0 items-center justify-center rounded-lg text-center text-[10px] font-semibold tracking-tight sm:px-1 sm:text-sm ${period === value ? "bg-zinc-700 text-white" : "text-zinc-400 hover:bg-white/10"}`}>{label}</Link>)}</nav>
    {period === "custom" && <form className="grid min-w-0 grid-cols-2 gap-2"><input type="hidden" name="period" value="custom"/>
      <label className="min-w-0 text-xs text-zinc-400">Desde<input required name="from" type="date" defaultValue={params.from} className="mt-1 min-h-11 w-full min-w-0 rounded-lg bg-zinc-900 px-2 text-xs text-white"/></label>
      <label className="min-w-0 text-xs text-zinc-400">Hasta<input required name="to" type="date" defaultValue={params.to} className="mt-1 min-h-11 w-full min-w-0 rounded-lg bg-zinc-900 px-2 text-xs text-white"/></label>
      <button type="submit" className="col-span-2 min-h-11 rounded-lg bg-red-600 text-sm font-bold">Aplicar fechas</button></form>}
    {dateError && <p role="alert" className="text-sm text-amber-200">{dateError}</p>}
    {range && rangeLabel && <p className="text-xs text-zinc-500">{rangeLabel.format(new Date(range.from * 1000))} — {rangeLabel.format(new Date((range.to - 1) * 1000))}</p>}
    <section aria-label="Indicadores de la tienda" className="grid grid-cols-2 gap-2 xl:grid-cols-4">{kpis.map(([label, value]) => <article key={label} className="min-w-0 rounded-xl border border-white/10 bg-white/[.02] p-3">
      <h2 className="text-[11px] font-semibold leading-4 text-zinc-400">{label}</h2><p className={`mt-2 break-words font-bold leading-tight tabular-nums ${value === "No disponible" ? "text-sm text-zinc-500" : "text-lg sm:text-xl"}`}>{value}</p>{label === "Importe vendido" && <p className="mt-1 text-[10px] text-zinc-500">ARS</p>}
    </article>)}</section>
    {funnel && <AnalyticsFunnel result={funnel}/>}
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <AnalyticsRankings key={`products:${period}:${params.from}:${params.to}`} id="products" title="Productos" tabs={[
        { id: "sold", label: "Más vendidos", unit: "unidades", result: real ? { status: "ok", rows: real.products } : unavailableRanking },
        { id: "viewed", label: "Más vistos", unit: "vistas", result: viewed }, { id: "added", label: "Más agregados", unit: "agregados", result: added },
      ]}/>
      <AnalyticsRankings key={`searches:${period}:${params.from}:${params.to}`} id="searches" title="Qué están buscando" tabs={[
        { id: "vehicles", label: "Vehículos", unit: "búsquedas", result: vehicles }, { id: "connectors", label: "Conectores", unit: "búsquedas", result: connectors },
        { id: "no-results", label: "Sin resultados", unit: "sin resultados", result: noResults },
      ]}/>
    </div>
    <section aria-labelledby="whatsapp-title" className="rounded-2xl border border-white/10 p-3 sm:p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 id="whatsapp-title" className="text-base font-bold">Consultas por WhatsApp</h2><b className="text-lg tabular-nums">{quantity(behavior?.whatsappClicks)}</b></div>
      <p className="mt-1 text-xs text-zinc-400">Clics hacia WhatsApp</p><AnalyticsRankingRows result={behavior ? { status: "ok", rows: behavior.whatsappSources } : unavailableRanking} unit="clics"/>
    </section>
    <details className="rounded-2xl border border-white/10 p-3 sm:p-4"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-zinc-300">Detalles de medición</summary>
      <div className="mt-3 space-y-3 break-words text-xs leading-5 text-zinc-400">
        <p>Períodos en Argentina (UTC−3), incluyendo hoy hasta esta consulta. No se compara con el período anterior en esta etapa.</p>
        <p>Visitantes: distinct IDs únicos con page_view de producción; no son personas verificadas. Sin páginas medidas o con identificación incompleta: No disponible.</p>
        {behavior ? <p>{quantity(behavior.pageViews)} vistas de página; {quantity(behavior.pagesWithoutIdentity)} sin identificación. Carrito: {quantity(behavior.cartEvents)} acciones, {quantity(behavior.cartWithoutSession)} sin sesión (excluidas del KPI). {quantity(behavior.legacyEvents)} eventos históricos sin entorno, excluidos de producción.</p> : <p>Actividad de PostHog no disponible: revisar configuración, acceso y cobertura; no se reemplaza por ceros.</p>}
        <p>Compras e importe: Supabase, ventas con estado actual completed y vínculo payment_transactions.sale_id → sales.id, payment_transactions.order_id → orders.id. Fecha: sales.created_at. Cada venta una vez; archivadas incluidas y canceladas excluidas. Pagos sin venta no cuentan. Sin vínculo verificable no se atribuye origen público. El importe no es saldo ni facturación fiscal.</p>
        {!real && <p>Lectura de ventas no disponible: revisar configuración y acceso a Supabase. No se muestran totales parciales.</p>}
        <p>Más vendidos suma cantidades de sale_items sobre ese mismo conjunto. Mantiene product_id y el último nombre histórico disponible. Más vistos cuenta product_viewed y el legado product_view ya compatible; Más agregados cuenta eventos add_to_cart, no compradores. Solo productos con ID medido.</p>
        <p>Búsquedas: marcas/modelos y conectores capturados. No se reconstruye texto libre desconocido. Sin resultados usa vehicle_search_no_results y connector_search con has_results=false; datos históricos sin ese resultado no se suponen fallidos.</p>
        <p>WhatsApp cuenta clics, no conversaciones ni ventas. Orígenes sin contexto permitido se agrupan como Origen no disponible. CheckoutResult usa la fuente existente Otros. Los enlaces instrumentados desde ahora no tienen backfill histórico.</p>
        {funnel && <AnalyticsFunnelMeasurement result={funnel}/>}
      </div>
    </details>
  </div>;
}
