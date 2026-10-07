import { funnelPercent, type FunnelResult } from "@/lib/analytics-funnel";

export function AnalyticsFunnel({ result }: { result: FunnelResult }) {
  const data = result.status === "ok" ? result.data : null;
  // Keep strict six-step attribution; display consistent journey units.
  const steps = data ? [0, 1, 2, 5].map((index, position) => ({
    label: ["Producto", "Carrito", "Checkout", "Compra atribuida"][position], count: data.steps[index].journeys,
  })) : [];
  return <section aria-labelledby="commercial-funnel-title" className="rounded-2xl border border-white/10 p-3 sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 id="commercial-funnel-title" className="text-base font-bold">De visita a compra</h2><p className="mt-1 text-xs text-zinc-400">Recorridos que pudimos medir dentro de la tienda</p></div>
      {data && <span className="rounded-lg bg-red-500/10 px-2 py-1 text-xs font-bold text-red-300">{funnelPercent(data.conversion)} completan</span>}</div>
    {data ? <ol className="mt-4 space-y-3">{steps.map(step => <li key={step.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <span className="text-sm text-zinc-300">{step.label}</span><b className="text-sm tabular-nums">{new Intl.NumberFormat("es-AR").format(step.count)}</b>
      <div aria-hidden="true" className="col-span-2 h-1 rounded-full bg-white/5"><div className="h-full rounded-full bg-red-500/70" style={{ width: `${steps[0].count ? step.count / steps[0].count * 100 : 0}%` }}/></div>
    </li>)}</ol> : <p role="status" className="mt-4 text-sm text-zinc-400">Recorridos atribuidos no disponibles para este período. Ver detalles de medición.</p>}
    <p className="mt-3 text-xs leading-5 text-zinc-500">Las compras totales y los recorridos atribuidos pueden ser distintos: no todas las ventas se vinculan a una sesión medida.</p>
  </section>;
}

export function AnalyticsFunnelMeasurement({ result }: { result: FunnelResult }) {
  const message = result.status === "start_not_configured" ? "Fecha de inicio de analítica comercial no configurada (COMMERCIAL_ANALYTICS_START_AT)."
    : result.status === "not_configured" ? "PostHog no configurado para el embudo."
    : result.status === "before_start" ? "El período es anterior al inicio de medición comercial."
    : result.status === "pending" ? "La consulta del embudo todavía no tiene resultados completos."
    : result.status === "error" ? result.message : null;
  return <div className="space-y-2">
    {message && <p>{message}</p>}
    {result.startAt && <p>Inicio comercial: {new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short", hourCycle: "h23" }).format(new Date(result.startAt))} (Argentina).</p>}
    <p>El embudo comienza en Producto: la consulta existente no atribuye una visita previa. No se agrega una etapa de visitas con un conteo independiente.</p>
    <p>Ventana de conversión: 7 días. Misma identidad y sesión desde Producto → Carrito → Checkout → Pedido; pago y compra se vinculan después por pedido e identidad. Todos los eventos deben estar dentro del período y posteriores al inicio comercial.</p>
    <p>La vista compacta cuenta recorridos en las cuatro etapas. La compra atribuida requiere pedido creado y pago aprobado; es un evento histórico y no refleja anulaciones posteriores.</p>
    {result.status === "ok" && <p>Compra atribuida: {result.data.steps[5].journeys} recorridos, {result.data.steps[5].count} pedidos únicos. {result.data.steps[0].journeys === 0 && "La consulta devolvió 0 recorridos medibles; esto no demuestra ausencia de ventas."}</p>}
    <p>Los recorridos sin sesión quedan fuera. Los recientes pueden seguir convirtiendo; la consulta se corta al final del período.</p>
  </div>;
}
