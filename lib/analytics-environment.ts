export type AnalyticsEnvironment = "production" | "development" | "preview";

export function analyticsEnvironment(hostname: string, configured?: string, nodeEnv?: string): AnalyticsEnvironment {
  const local = /^(localhost|127\..*|\[?::1\]?|0\.0\.0\.0|10\..*|192\.168\..*|172\.(1[6-9]|2\d|3[01])\..*)$/.test(hostname);
  if (local || nodeEnv !== "production") return "development";
  if (configured === "production" || configured === "development" || configured === "preview") return configured;
  // An unclassified deployment must never contaminate commercial metrics.
  return "preview";
}
