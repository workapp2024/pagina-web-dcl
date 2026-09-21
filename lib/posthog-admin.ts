import "server-only";

export type AnalyticsSummary = {
  totals: Record<string, number>;
  visitors: number | null;
  sessions: number | null;
  productionEvents: number;
  legacyEvents: number;
  connectorNoResults: number;
  pages: [string, number][];
  products: [string, number][];
  brands: [string, number][];
  models: [string, number][];
};

export type AnalyticsResult =
  | { status: "not_configured" }
  | { status: "error"; message: string }
  | { status: "ok"; data: AnalyticsSummary };

const productEvents = "'product_viewed','product_view'";
const measuredEvents = `'page_view',${productEvents},'add_to_cart','cart_view','checkout_started','whatsapp_click','vehicle_search_started','vehicle_search_completed','vehicle_search_no_results','vehicle_search_error','connector_search'`;
export const detailKinds = ["visitors", "sessions", "pages", "products", "cart", "vehicles", "connectors", "checkout", "whatsapp"] as const;
export type DetailKind = typeof detailKinds[number];
export type DetailRow = { label: string; values: (string | number | null)[]; productId?: string };
export type AnalyticsDetail = { title: string; columns: string[]; rows: DetailRow[]; note?: string; stats?: [string, string | number][] };
export type DetailResult = { status: "ok"; data: AnalyticsDetail } | { status: "error"; message: string } | { status: "not_configured" };

const dateFilter = "timestamp >= toDateTime({from}, 'UTC') AND timestamp < toDateTime({to}, 'UTC')";
const production = `${dateFilter} AND properties['environment'] = 'production'`;
const day = "toString(toDate(toTimeZone(timestamp, 'America/Argentina/Buenos_Aires')))";

async function hogQuery(key: string, project: string, host: string, sql: string, from: number, to: number, extra: Record<string, unknown> = {}): Promise<unknown[][]> {
  const response = await fetch(`${host}/api/projects/${encodeURIComponent(project)}/query/`, {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query: sql, values: { from, to, ...extra } } }),
    cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`PostHog respondió HTTP ${response.status}.`);
  const body = await response.json();
  if (body.error || body.query_status?.error || body.query_status?.complete === false || !Array.isArray(body.results) || !body.results.every(Array.isArray)) throw new Error("PostHog no devolvió resultados completos.");
  return body.results as unknown[][];
}

function safeError(error: unknown) {
  return error instanceof Error && /^(PostHog |Rango de fechas)/.test(error.message) ? error.message : "No se pudo consultar PostHog. Revisá conexión, host y acceso de consulta.";
}

function count(value: unknown): number {
  if ((typeof value !== "number" && typeof value !== "string") || value === "" || !Number.isSafeInteger(Number(value)) || Number(value) < 0) throw new Error("PostHog devolvió un conteo inválido.");
  return Number(value);
}

export async function getAnalyticsSummary(from: number, to: number): Promise<AnalyticsResult> {
  const key = process.env.POSTHOG_PERSONAL_API_KEY?.trim();
  const project = process.env.POSTHOG_PROJECT_ID?.trim();
  const host = process.env.POSTHOG_UI_HOST || "https://eu.posthog.com";
  if (!key || !project) return { status: "not_configured" };
  try {
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new Error("Rango de fechas inválido.");
    const query = (sql: string, extra: Record<string, unknown> = {}) => hogQuery(key, project, host, sql, from, to, extra);
    const top = (property: string, events: string) => query(`SELECT toString(properties[{property}]), count() FROM events WHERE ${production} AND event IN (${events}) AND notEmpty(ifNull(toString(properties[{property}]), '')) GROUP BY toString(properties[{property}]) ORDER BY count() DESC LIMIT 8`, { property });
    const [totalsRows, audienceRows, coverageRows, pages, products, brands, models] = await Promise.all([
      query(`SELECT event, count() FROM events WHERE ${production} AND event IN (${measuredEvents}) GROUP BY event`),
      query(`SELECT uniqIf(distinct_id, notEmpty(ifNull(distinct_id, ''))), uniqIf(toString(properties['$session_id']), notEmpty(ifNull(toString(properties['$session_id']), ''))), count(), countIf(notEmpty(ifNull(distinct_id, ''))), countIf(notEmpty(ifNull(toString(properties['$session_id']), ''))) FROM events WHERE ${production} AND event = 'page_view'`),
      query(`SELECT countIf(properties['environment'] = 'production'), countIf(empty(ifNull(toString(properties['environment']), ''))), countIf(properties['environment'] = 'production' AND event = 'connector_search' AND properties['has_results'] = false) FROM events WHERE ${dateFilter} AND event IN (${measuredEvents})`),
      top("path", "'page_view'"), top("product_id", productEvents),
      top("brand", "'vehicle_search_completed','vehicle_search_no_results'"),
      top("model", "'vehicle_search_completed','vehicle_search_no_results'"),
    ]);
    const pairs = (rows: unknown[][]): [string, number][] => rows.map(row => {
      if (row.length !== 2 || typeof row[0] !== "string" || !row[0]) throw new Error("PostHog devolvió filas inválidas.");
      return [row[0], count(row[1])];
    });
    if (audienceRows.length !== 1 || audienceRows[0].length !== 5 || coverageRows.length !== 1 || coverageRows[0].length !== 3) throw new Error("PostHog devolvió un resumen incompleto.");
    const [visitors, sessions, pageViews, identifiedPages, sessionPages] = audienceRows[0].map(count);
    const [productionEvents, legacyEvents, connectorNoResults] = coverageRows[0].map(count);
    const totals = Object.fromEntries(pairs(totalsRows));
    // Each event row belongs to one name. No UNION or second count of the same row.
    totals.product_viewed = (totals.product_viewed ?? 0) + (totals.product_view ?? 0);
    delete totals.product_view;
    return { status: "ok", data: {
      totals, visitors: identifiedPages === pageViews ? visitors : null,
      sessions: sessionPages === pageViews ? sessions : null,
      productionEvents, legacyEvents, connectorNoResults,
      pages: pairs(pages), products: pairs(products), brands: pairs(brands), models: pairs(models),
    } };
  } catch (error) {
    // Do not expose request bodies, credentials or arbitrary remote error payloads.
    return { status: "error", message: safeError(error) };
  }
}

function label(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 160 || /[\r\n<>@?&#]/.test(value)) throw new Error("PostHog devolvió filas inválidas.");
  return value;
}

function decimal(value: unknown): number {
  const parsed = Number(value);
  if ((typeof value !== "string" && typeof value !== "number") || value === "" || !Number.isFinite(parsed) || parsed < 0) throw new Error("PostHog devolvió filas inválidas.");
  return Math.round(parsed * 100) / 100;
}

export async function getAnalyticsDetail(kind: DetailKind, from: number, to: number): Promise<DetailResult> {
  const key = process.env.POSTHOG_PERSONAL_API_KEY?.trim();
  const project = process.env.POSTHOG_PROJECT_ID?.trim();
  if (!key || !project) return { status: "not_configured" };
  try {
    if (!detailKinds.includes(kind) || !Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new Error("Rango de fechas inválido.");
    const host = process.env.POSTHOG_UI_HOST || "https://eu.posthog.com";
    const query = (sql: string) => hogQuery(key, project, host, sql, from, to);
    let title = "";
    let columns: string[] = [];
    let note: string | undefined;
    let stats: [string, string | number][] | undefined;
    let rows: DetailRow[] = [];
    if (kind === "visitors" || kind === "sessions") {
      title = kind === "visitors" ? "Visitantes por día" : "Sesiones por día";
      columns = ["Día", "Visitantes aprox.", "Sesiones", "Páginas vistas"];
      note = "Visitantes aproxima navegadores, no personas verificadas. Los valores sin identificación completa no se estiman.";
      const found = await query(`SELECT ${day}, count(), countIf(notEmpty(ifNull(distinct_id, ''))), uniqIf(distinct_id, notEmpty(ifNull(distinct_id, ''))), countIf(notEmpty(ifNull(toString(properties['$session_id']), ''))), uniqIf(toString(properties['$session_id']), notEmpty(ifNull(toString(properties['$session_id']), ''))) FROM events WHERE ${production} AND event = 'page_view' GROUP BY ${day} ORDER BY ${day} DESC LIMIT 90`);
      rows = found.map(row => {
        if (row.length !== 6) throw new Error("PostHog devolvió filas inválidas.");
        const [views, identified, visitors, sessionPages, sessions] = row.slice(1).map(count);
        return { label: label(row[0]), values: [identified === views ? visitors : null, sessionPages === views ? sessions : null, views] };
      });
      if (kind === "sessions") {
        columns = ["Día", "Sesiones", "Páginas vistas", "Páginas por sesión"];
        rows = rows.map(row => ({ label: row.label, values: [row.values[1], row.values[2], typeof row.values[1] === "number" && row.values[1] > 0 ? Math.round(Number(row.values[2]) / row.values[1] * 100) / 100 : null] }));
      }
    } else if (kind === "pages") {
      title = "Páginas vistas"; columns = ["Página", "Vistas", "Visitantes aprox.", "Sesiones"];
      const found = await query(`SELECT toString(properties['path']), count(), countIf(notEmpty(ifNull(distinct_id, ''))), uniqIf(distinct_id, notEmpty(ifNull(distinct_id, ''))), countIf(notEmpty(ifNull(toString(properties['$session_id']), ''))), uniqIf(toString(properties['$session_id']), notEmpty(ifNull(toString(properties['$session_id']), ''))) FROM events WHERE ${production} AND event = 'page_view' AND startsWith(toString(properties['path']), '/') AND NOT startsWith(toString(properties['path']), '/admin') AND NOT startsWith(toString(properties['path']), '/api') GROUP BY toString(properties['path']) ORDER BY count() DESC LIMIT 30`);
      rows = found.map(row => {
        if (row.length !== 6) throw new Error("PostHog devolvió filas inválidas.");
        const path = label(row[0]);
        if (!/^\/[a-zA-Z0-9/_-]*$/.test(path)) throw new Error("PostHog devolvió filas inválidas.");
        const [views, identified, visitors, sessionPages, sessions] = row.slice(1).map(count);
        return { label: path, values: [views, identified === views ? visitors : null, sessionPages === views ? sessions : null] };
      });
    } else if (kind === "products" || kind === "cart") {
      title = kind === "products" ? "Productos vistos" : "Agregados al carrito";
      columns = ["Producto", kind === "products" ? "Vistas" : "Veces agregado", "Sesiones"];
      const events = kind === "products" ? productEvents : "'add_to_cart'";
      const found = await query(`SELECT toString(properties['product_id']), count(), countIf(notEmpty(ifNull(toString(properties['$session_id']), ''))), uniqIf(toString(properties['$session_id']), notEmpty(ifNull(toString(properties['$session_id']), ''))) FROM events WHERE ${production} AND event IN (${events}) AND notEmpty(ifNull(toString(properties['product_id']), '')) GROUP BY toString(properties['product_id']) ORDER BY count() DESC LIMIT 30`);
      rows = found.map(row => {
        if (row.length !== 4) throw new Error("PostHog devolvió filas inválidas.");
        const productId = label(row[0]);
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(productId)) throw new Error("PostHog devolvió filas inválidas.");
        const [eventsCount, identified, sessions] = row.slice(1).map(count);
        return { label: "Producto no disponible", productId, values: [eventsCount, identified === eventsCount ? sessions : null] };
      });
    } else if (kind === "vehicles" || kind === "connectors") {
      title = kind === "vehicles" ? "Búsquedas por vehículo" : "Búsquedas por conector";
      columns = [kind === "vehicles" ? "Vehículo" : "Conector", "Búsquedas", "Con resultados", "Sin resultados"];
      const vehicle = kind === "vehicles";
      const dimensions = vehicle ? "toString(properties['vehicle_type']), toString(properties['brand']), toString(properties['model'])" : "toString(properties['connector'])";
      const events = vehicle ? "event IN ('vehicle_search_completed','vehicle_search_no_results')" : "event = 'connector_search'";
      const success = vehicle ? "event = 'vehicle_search_completed'" : "properties['has_results'] = true";
      const failure = vehicle ? "event = 'vehicle_search_no_results'" : "properties['has_results'] = false";
      const found = await query(`SELECT ${dimensions}, count(), countIf(${success}), countIf(${failure}) FROM events WHERE ${production} AND ${events} GROUP BY ${dimensions} ORDER BY count() DESC LIMIT 30`);
      rows = found.map(row => {
        if (row.length !== (vehicle ? 6 : 4)) throw new Error("PostHog devolvió filas inválidas.");
        const dimensionsCount = vehicle ? 3 : 1;
        const parts = row.slice(0, dimensionsCount).map(label);
        if (vehicle && parts.some(part => !/^[\p{L}\p{N} ._-]{1,80}$/u.test(part))) throw new Error("PostHog devolvió filas inválidas.");
        if (!vehicle && !/^[A-Z0-9/]{1,20}$/.test(parts[0])) throw new Error("PostHog devolvió filas inválidas.");
        return { label: parts.join(" → "), values: row.slice(dimensionsCount).map(count) };
      });
    } else if (kind === "checkout") {
      title = "Checkout iniciado"; columns = ["Día", "Entradas"];
      const [daily, aggregates] = await Promise.all([
        query(`SELECT ${day}, count() FROM events WHERE ${production} AND event = 'checkout_started' GROUP BY ${day} ORDER BY ${day} DESC LIMIT 90`),
        query(`SELECT count(), countIf(toFloat64OrNull(toString(properties['item_count'])) IS NOT NULL AND toFloat64OrNull(toString(properties['item_count'])) >= 0), avgIf(toFloat64OrNull(toString(properties['item_count'])), toFloat64OrNull(toString(properties['item_count'])) >= 0), countIf(toFloat64OrNull(toString(properties['cart_total'])) IS NOT NULL AND toFloat64OrNull(toString(properties['cart_total'])) >= 0), avgIf(toFloat64OrNull(toString(properties['cart_total'])), toFloat64OrNull(toString(properties['cart_total'])) >= 0) FROM events WHERE ${production} AND event = 'checkout_started'`),
      ]);
      rows = daily.map(row => {
        if (row.length !== 2) throw new Error("PostHog devolvió filas inválidas.");
        return { label: label(row[0]), values: [count(row[1])] };
      });
      if (aggregates.length !== 1 || aggregates[0].length !== 5) throw new Error("PostHog devolvió filas inválidas.");
      const [total, validItems, averageItems, validTotals, averageTotal] = aggregates[0];
      stats = [["Entradas", count(total)]];
      if (count(total) > 0 && count(validItems) === count(total)) stats.push(["Ítems promedio", decimal(averageItems)]);
      if (count(total) > 0 && count(validTotals) === count(total)) stats.push(["Carrito promedio", decimal(averageTotal)]);
      note = "Entradas al checkout, no pedidos ni ventas. Puede haber entradas repetidas.";
    } else {
      title = "Clics comerciales a WhatsApp"; columns = ["Origen", "Clics"];
      const found = await query(`SELECT toString(properties['source']), toString(properties['promotion_id']), count() FROM events WHERE ${production} AND event = 'whatsapp_click' GROUP BY toString(properties['source']), toString(properties['promotion_id']) ORDER BY count() DESC LIMIT 30`);
      rows = found.map(row => {
        if (row.length !== 3) throw new Error("PostHog devolvió filas inválidas.");
        const source = label(row[0]);
        if (!/^[a-z_]{1,40}$/.test(source)) throw new Error("PostHog devolvió filas inválidas.");
        const promotion = row[1] ? label(row[1]) : "";
        if (promotion && !/^[a-zA-Z0-9_-]{1,100}$/.test(promotion)) throw new Error("PostHog devolvió filas inválidas.");
        return { label: promotion ? `${source} · promoción ${promotion}` : source, values: [count(row[2])] };
      });
    }
    return { status: "ok", data: { title, columns, rows, note, stats } };
  } catch (error) {
    return { status: "error", message: safeError(error) };
  }
}
