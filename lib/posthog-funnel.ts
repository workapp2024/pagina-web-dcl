import "server-only";
import { commercialAnalyticsStartAt } from "@/lib/commercial-analytics-config";
import { commercialFunnelQuery, parseFunnelRows, type FunnelResult } from "@/lib/analytics-funnel";

// Read-only query; no outbox recovery, database access or event capture here.
export async function getCommercialFunnel(from: number, to: number): Promise<FunnelResult> {
  const startAt = commercialAnalyticsStartAt();
  if (!startAt) return { status: "start_not_configured", startAt };
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return { status: "error", startAt, message: "Rango de fechas inválido." };
  const effectiveFrom = Math.max(from, Date.parse(startAt) / 1000);
  if (effectiveFrom >= to) return { status: "before_start", startAt };
  const key = process.env.POSTHOG_PERSONAL_API_KEY?.trim();
  const project = process.env.POSTHOG_PROJECT_ID?.trim();
  if (!key || !project) return { status: "not_configured", startAt };
  try {
    const host = process.env.POSTHOG_UI_HOST || "https://eu.posthog.com";
    const response = await fetch(`${host}/api/projects/${encodeURIComponent(project)}/query/`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query: commercialFunnelQuery, values: { from: effectiveFrom, to } } }),
      cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Query failed");
    const body = await response.json();
    if (body.error || body.query_status?.error) throw new Error("Query failed");
    if (body.query_status?.complete === false || body.hasMore === true || body.has_more === true || body.results?.length === 0) return { status: "pending", startAt };
    return { status: "ok", startAt, from: effectiveFrom, to, data: parseFunnelRows(body.results) };
  } catch {
    // Arbitrary upstream messages can contain credentials or queried identifiers.
    return { status: "error", startAt, message: "No se pudo consultar el embudo en PostHog. Intentá nuevamente." };
  }
}
