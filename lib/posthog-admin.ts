import "server-only";

export type AnalyticsSummary = {
  totals: Record<string, number>;
  visitors: number;
  sessions: number;
  pagesPerSession: number;
  pages: [string, number][];
  products: [string, number][];
  categories: [string, number][];
  stations: [string, number][];
  brands: [string, number][];
  models: [string, number][];
};

async function query(query: string, values: Record<string, unknown>) {
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  const project = process.env.POSTHOG_PROJECT_ID;
  const host = process.env.POSTHOG_UI_HOST || "https://eu.posthog.com";
  if (!key || !project) return null;
  const response = await fetch(`${host}/api/projects/${encodeURIComponent(project)}/query/`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: { kind: "HogQLQuery", query, values } }), cache: "no-store" });
  if (!response.ok) throw new Error(`PostHog respondió ${response.status}`);
  return response.json() as Promise<{ results?: unknown[][] }>;
}

export async function getAnalyticsSummary(from: string, to: string): Promise<AnalyticsSummary | null> {
  const values = { from, to };
  const totalsQuery = `SELECT event, count() FROM events WHERE timestamp >= toDateTime({from}) AND timestamp < toDateTime({to}) AND event IN ('page_view','product_view','add_to_cart','cart_view','checkout_started','whatsapp_click','vehicle_search_started','vehicle_search_completed','vehicle_search_no_results','dcl_music_open','radio_play') GROUP BY event`;
  const audienceQuery = `SELECT uniq(distinct_id), uniq(toString(properties['$session_id'])), countIf(event = 'page_view') FROM events WHERE timestamp >= toDateTime({from}) AND timestamp < toDateTime({to})`;
  const top = (property: string, events: string[]) => query(`SELECT toString(properties[{property}]), count() FROM events WHERE timestamp >= toDateTime({from}) AND timestamp < toDateTime({to}) AND event IN (${events.map((_, i) => `{event${i}}`).join(",")}) AND notEmpty(toString(properties[{property}])) GROUP BY toString(properties[{property}]) ORDER BY count() DESC LIMIT 8`, { ...values, property, ...Object.fromEntries(events.map((event, i) => [`event${i}`, event])) });
  const [totals, audience, pages, products, categories, stations, brands, models] = await Promise.all([query(totalsQuery, values), query(audienceQuery, values), top("path", ["page_view"]), top("product_id", ["product_view"]), top("category", ["category_view", "product_view"]), top("station_id", ["radio_play", "radio_station_selected"]), top("brand", ["vehicle_search_completed", "vehicle_search_no_results"]), top("model", ["vehicle_search_completed", "vehicle_search_no_results"])]);
  const pairs = (result: { results?: unknown[][] } | null) => (result?.results || []).map(row => [String(row[0]), Number(row[1])] as [string, number]);
  const audienceRow = audience?.results?.[0] || [];
  const visitors = Number(audienceRow[0] || 0);
  const sessions = Number(audienceRow[1] || 0);
  const pageViews = Number(audienceRow[2] || 0);
  return { totals: Object.fromEntries(pairs(totals)), visitors, sessions, pagesPerSession: sessions ? pageViews / sessions : 0, pages: pairs(pages), products: pairs(products), categories: pairs(categories), stations: pairs(stations), brands: pairs(brands), models: pairs(models) };
}
