import { funnelPercent, type FunnelResult } from "@/lib/analytics-funnel";

const localDate = (date: string) => new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short", hourCycle: "h23",
}).format(new Date(date));
const quantity = (value: number) => new Intl.NumberFormat("es-AR").format(value);

export function AnalyticsFunnel({ result }: { result: FunnelResult }) {
  const data = result.status === "ok" ? result.data : null;
  const message = result.status === "start_not_configured" ? "Fecha de inicio de analítica comercial no configurada"
    : result.status === "not_configured" ? "Analytics no configurado. El embudo no está disponible."
    : result.status === "before_start" ? "Embudo comercial no disponible para este período."
    : result.status === "pending" ? "Datos todavía no disponibles. Volvé a consultar en unos momentos."
    : result.status === "error" ? result.message : null;
  return <section aria-labelledby="commercial-funnel-title" className="rounded-2xl border border-white/10 bg-white/[.02] p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 id="commercial-funnel-title" className="text-lg font-black uppercase tracking-wide">Embudo comercial</h2>
        <p className="mt-1 text-sm text-zinc-300">Ventana de conversión: 7 días</p>
        {result.startAt && <p className="mt-1 text-xs text-zinc-400">Analítica comercial disponible desde {localDate(result.startAt)} (Argentina)</p>}
      </div>
      {data && <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3">
        <p className="text-xs text-zinc-300">Conversión completa de recorridos</p>
        <b className="mt-1 block text-2xl text-red-300">{funnelPercent(data.conversion)}</b>
        <p className="mt-1 text-xs text-zinc-400">Productos vistos → Compras completadas</p>
      </div>}
    </div>
    {message && <p role={result.status === "error" ? "alert" : "status"} className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-100">{message}</p>}
    {data && <>
      <ol className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.steps.map((step, index) => <li key={step.label} className="min-w-0 rounded-xl border border-white/10 bg-zinc-950/40 p-4">
          <h3 className="text-sm font-semibold"><span className="mr-2 text-red-400">{index + 1}.</span>{step.label}</h3>
          <p className="mt-3"><b className="text-3xl tabular-nums">{quantity(step.count)}</b><span className="ml-2 text-xs text-zinc-400">{index < 3 ? "recorridos" : "pedidos únicos"}</span></p>
          {index >= 3 && <p className="mt-1 text-xs text-zinc-400">En {quantity(step.journeys)} {step.journeys === 1 ? "recorrido" : "recorridos"}</p>}
          <div aria-hidden="true" className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-red-500" style={{ width: `${data.steps[0].journeys ? step.journeys / data.steps[0].journeys * 100 : 0}%` }} /></div>
          <dl className="mt-3 space-y-1 text-xs text-zinc-400">
            <div className="flex justify-between gap-2"><dt>{index ? `Conversión de ${step.comparisonUnit}` : "Paso inicial"}</dt><dd className="text-zinc-200">{funnelPercent(step.conversion)}</dd></div>
            <div className="flex justify-between gap-2"><dt>Caída desde el paso anterior</dt><dd className="text-right text-zinc-200">{step.drop === null ? "—" : `${quantity(step.drop)} ${step.comparisonUnit} · ${funnelPercent(step.dropPercent)}`}</dd></div>
          </dl>
        </li>)}
      </ol>
      {!data.steps[0].journeys && <p className="mt-4 text-sm text-zinc-300">La consulta se completó: 0 recorridos medibles en este período. Esto no demuestra ausencia de actividad o ventas.</p>}
      <p className="mt-4 text-xs text-zinc-400">Hasta Pedidos creados, las conversiones y caídas comparan recorridos; en Pagos aprobados y Compras completadas comparan pedidos. La conversión completa y las barras representan recorridos. Un recorrido es una sesión medida y puede generar varios pedidos; cada pedido se cuenta una sola vez por etapa.</p>
      <p className="mt-2 text-xs text-zinc-400">Sólo se incluyen eventos dentro del período elegido y posteriores al inicio de la analítica comercial. Los recorridos recientes pueden seguir convirtiendo hasta completar sus 7 días; los resultados se limitan al cierre del período.</p>
    </>}
    <p className="mt-4 text-sm text-zinc-400">El embudo representa recorridos que siguieron esta secuencia medible. Algunos clientes pueden omitir pasos o retomar la compra en otra sesión.</p>
    <p className="mt-2 text-xs text-zinc-500">Se requiere la misma sesión desde la vista del producto hasta la creación del pedido. Los pagos y las compras pueden completarse después, fuera de esa sesión. Los eventos de navegación sin sesión no se incluyen.</p>
  </section>;
}
