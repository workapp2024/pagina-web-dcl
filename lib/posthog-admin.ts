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
    const query = async (query: string, extra: Record<string, unknown> = {}) => {
      const response = await fetch(`${host}/api/projects/${encodeURIComponent(project)}/query/`, {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: { kind: "HogQLQuery", query, values: { from, to, ...extra } } }),
        cache: "no-store", signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`PostHog respondió HTTP ${response.status}.`);
      const body = await response.json();
      if (body.error || body.query_status?.error || body.query_status?.complete === false || !Array.isArray(body.results) || !body.results.every(Array.isArray)) throw new Error("PostHog no devolvió resultados completos.");
      return body.results as unknown[][];
    };
    const dateFilter = "timestamp >= toDateTime({from}, 'UTC') AND timestamp < toDateTime({to}, 'UTC')";
    const production = `${dateFilter} AND properties['environment'] = 'production'`;
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
    const message = error instanceof Error && /^(PostHog |Rango de fechas)/.test(error.message) ? error.message : "No se pudo consultar PostHog. Revisá conexión, host y acceso de consulta.";
    return { status: "error", message };
  }
}
