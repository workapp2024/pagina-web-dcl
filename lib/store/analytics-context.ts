export type AnalyticsContext = { distinct_id: string; session_id?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Optional attribution must never prevent a valid purchase.
export function sanitizeAnalyticsContext(value: unknown): AnalyticsContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const context = value as Record<string, unknown>;
  if (Object.keys(context).some(key => key !== "distinct_id" && key !== "session_id")) return null;
  if (typeof context.distinct_id !== "string" || !uuid.test(context.distinct_id)) return null;
  if (context.session_id !== undefined && (typeof context.session_id !== "string" || !uuid.test(context.session_id))) return null;
  return { distinct_id: context.distinct_id, ...(context.session_id ? { session_id: context.session_id as string } : {}) };
}

export function readBrowserAnalyticsContext(sdk: { __loaded?: boolean; get_distinct_id(): string; get_session_id(): string }): AnalyticsContext | null {
  try {
    if (!sdk.__loaded) return null;
    const session = sdk.get_session_id();
    return sanitizeAnalyticsContext({ distinct_id: sdk.get_distinct_id(), ...(session ? { session_id: session } : {}) });
  } catch { return null; }
}
