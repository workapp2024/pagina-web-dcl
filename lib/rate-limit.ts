import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";

type RateLimitRule = { limit: number; windowMs: number };
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function clientAddress(request: Request) {
  return request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

/** Per-instance guard compatible with serverless. Replace with a shared store when multi-region scale requires it. */
export function rateLimit(request: Request, scope: string, rule: RateLimitRule): NextResponse | null {
  const now = Date.now();
  const key = `${scope}:${clientAddress(request)}`;
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return null;
  }
  current.count += 1;
  if (current.count <= rule.limit) return null;
  const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  const response = apiError("RATE_LIMITED", "Demasiados intentos. Esperá unos minutos e intentá nuevamente.", 429);
  response.headers.set("Retry-After", String(retryAfter));
  return response;
}
