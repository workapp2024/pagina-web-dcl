import "server-only";
import { after } from "next/server";
import { createAdminServerClient } from "@/lib/supabase/server";
import { commercialAnalyticsEnvironment } from "@/lib/commercial-analytics-config";

type OutboxRow = {
  id: string; event_type: "order_created" | "payment_approved" | "purchase_completed";
  distinct_id: string; session_id: string | null; environment: string;
  occurred_at: string; properties: Record<string, unknown>; lease_token: string;
};

// Only persisted snapshots contribute to the event; retries never read orders again.
export function outboxPayload(row: OutboxRow, token: string) {
  return {
    api_key: token, uuid: row.id, event: row.event_type, distinct_id: row.distinct_id,
    timestamp: row.occurred_at,
    properties: { ...row.properties, environment: row.environment, $process_person_profile: false, $geoip_disable: true,
      ...(row.event_type === "order_created" && row.session_id ? { $session_id: row.session_id } : {}) },
  };
}

export async function flushAnalyticsOutbox() {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!token || !host) return;
  const endpoint = new URL("/i/v0/e/", host);
  if (endpoint.protocol !== "https:") return;
  const db = createAdminServerClient();
  const claimed = await db.rpc("claim_analytics_outbox" as never, { p_environment: commercialAnalyticsEnvironment(), p_limit: 5 } as never) as unknown as { data: OutboxRow[] | null; error: unknown };
  if (claimed.error || !claimed.data) return;
  await Promise.allSettled(claimed.data.map(async row => {
    let failure: string | null = null;
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(outboxPayload(row, token)), cache: "no-store", redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) failure = `http_${response.status}`;
    } catch { failure = "transport_error"; }
    // An unsuccessful acknowledgement leaves the lease to expire. Never alter the
    // immutable event or make the commercial request fail after its commit.
    if (failure) {
      await db.rpc("fail_analytics_outbox" as never, { p_id: row.id, p_lease: row.lease_token, p_error: failure } as never);
    } else {
      await db.rpc("ack_analytics_outbox" as never, { p_id: row.id, p_lease: row.lease_token } as never);
    }
  }));
}

export function scheduleAnalyticsFlush() {
  try {
    after(async () => {
      try { await flushAnalyticsOutbox(); } catch { /* Persisted events remain retryable. */ }
    });
  } catch { /* No request lifecycle: a later request can recover pending events. */ }
}
