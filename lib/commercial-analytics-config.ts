import "server-only";
import type { AnalyticsEnvironment } from "@/lib/analytics-environment";

export function commercialAnalyticsEnvironment(): AnalyticsEnvironment {
  if (process.env.NODE_ENV !== "production") return "development";
  const value = process.env.VERCEL_ENV || process.env.NEXT_PUBLIC_ANALYTICS_ENVIRONMENT;
  return value === "production" || value === "development" ? value : "preview";
}

export function commercialAnalyticsStartAt(): string | null {
  const value = process.env.COMMERCIAL_ANALYTICS_START_AT?.trim();
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === value.slice(0, 19) ? date.toISOString() : null;
}
