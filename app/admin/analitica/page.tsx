import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getAnalyticsSummary, type AnalyticsResult } from "@/lib/posthog-admin";
import { analyticsDates } from "@/lib/analytics-dates";

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string }> }) {
  if (!(await isAdminAuthenticated())) redirect("/admin/login");
  const params = await searchParams;
  const period = params.period || "30d";
  let result: AnalyticsResult | undefined;
  let dateError = "";
  try {
    const range = analyticsDates(period, params.from, params.to);
    result = await getAnalyticsSummary(range.from, range.to);
  } catch (error) { dateError = error instanceof Error ? error.message : "Rango de fechas inválido."; }
  const data = result?.status === "ok" ? result.data : null;
  const total = (event: string) => data?.totals[event] ?? 0;
  const metrics: [string, number | null][] = data ? [
    ["Visitantes", data.visitors], ["Sesiones", data.sessions], ["Páginas vistas", total("page_view")],
    ["Productos vistos", total("product_viewed")], ["Agregados al carrito", total("add_to_cart")],
    ["Búsquedas por vehículo", total("vehicle_search_started")], ["Búsquedas por conector", total("connector_search")],
    ["Vehículo sin resultados", total("vehicle_search_no_results")], ["Conector sin resultados", data.connectorNoResults],
    ["Checkout iniciado (entrada)", total("checkout_started")], ["Clics comerciales a WhatsApp", total("whatsapp_click")],
  ] : [];
  const project = process.env.POSTHOG_PROJECT_ID;
  const ui = process.env.POSTHOG_UI_HOST || "https://eu.posthog.com";
  return <div className="space-y-6">
    <header><span className="text-xs font-bold uppercase tracking-[.2em] text-red-400">Decisiones comerciales</span><h1 className="mt-2 text-3xl font-black">Analítica</h1><p className="mt-2 text-sm text-zinc-400">Actividad pública de producción. Días de Argentina (UTC−3); los períodos incluyen hoy hasta el momento de consulta.</p></header>
    <form className="grid gap-2 rounded-2xl border border-white/10 p-3 sm:grid-cols-5">
      <select name="period" defaultValue={period} className="min-h-11 rounded-xl bg-zinc-900 px-3"><option value="today">Hoy</option><option value="7d">Últimos 7 días</option><option value="30d">Últimos 30 días</option><option value="month">Este mes</option><option value="custom">Personalizado</option></select>
      <input name="from" type="date" defaultValue={params.from} className="min-h-11 rounded-xl bg-zinc-900 px-3" /><input name="to" type="date" defaultValue={params.to} className="min-h-11 rounded-xl bg-zinc-900 px-3" />
      <button className="min-h-11 rounded-xl bg-red-600 px-4 text-xs font-bold uppercase">Aplicar</button>
      {project && <Link href={`${ui}/project/${project}/replay/home`} target="_blank" className="flex min-h-11 items-center justify-center rounded-xl border border-white/15 text-xs font-bold">Ver sesiones en PostHog</Link>}
    </form>
    {(dateError || result?.status === "not_configured" || result?.status === "error") && <div role="alert" className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-5 text-sm text-amber-100">
      <b>{dateError ? "Revisá las fechas" : result?.status === "not_configured" ? "Analytics no configurado" : "Error consultando PostHog"}</b>
      <p className="mt-2">{dateError || (result?.status === "not_configured" ? "Faltan POSTHOG_PERSONAL_API_KEY o POSTHOG_PROJECT_ID en el servidor. Métricas no disponibles." : result?.status === "error" ? result.message : "")}</p>
    </div>}
    {data && <>
      <p className="text-sm text-zinc-400">Eventos comerciales históricos sin entorno en este rango: <b>{data.legacyEvents}</b>. Se conservan, pero no se suman a producción porque pueden incluir pruebas. El enlace a PostHog abre el proyecto completo.</p>
      {!data.productionEvents ? <p className="rounded-2xl border border-white/10 p-5 text-sm text-zinc-300">Métricas no disponibles: la consulta no encontró eventos comerciales etiquetados como producción en este rango. Esto no demuestra ausencia de clientes; verificá la captura y el entorno del despliegue.</p> : <>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{metrics.map(([label, value]) => <article key={label} className="rounded-2xl border border-white/10 bg-white/5 p-4"><small className="uppercase text-zinc-400">{label}</small><b className="mt-2 block text-3xl">{value === null ? "No disponible" : value}</b></article>)}</section>
        <p className="text-sm text-zinc-400">Visitantes y sesiones se calculan sobre páginas vistas con identificación completa; visitantes aproxima navegadores, no personas verificadas. Los demás valores cuentan eventos, no productos únicos ni conversiones. Checkout cuenta entradas a la página, incluso repetidas. Conectores cuenta resultados mostrados de búsquedas reconocidas, no texto libre.</p>
        <p className="text-sm text-zinc-400">Errores técnicos de búsqueda por vehículo: <b>{total("vehicle_search_error")}</b>. No se incluyen en búsquedas sin resultados.</p>
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{([ ["Páginas", data.pages], ["Productos", data.products], ["Marcas buscadas", data.brands], ["Modelos buscados", data.models] ] as [string, [string, number][]][]).map(([title, rows]) => <article key={title} className="rounded-2xl border border-white/10 p-5"><h2 className="font-black">{title}</h2><div className="mt-3 space-y-2">{rows.length ? rows.map(([name, count]) => <div key={name} className="flex justify-between gap-3 text-sm"><span className="truncate text-zinc-300">{name}</span><b>{count}</b></div>) : <p className="text-sm text-zinc-400">Sin datos para este rango.</p>}</div></article>)}</section>
      </>}
    </>}
  </div>;
}
