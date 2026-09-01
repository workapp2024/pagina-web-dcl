import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "CONFIGURATION_ERROR"
  | "INTERNAL_ERROR";

export function apiError(code: ApiErrorCode, message: string, status: number) {
  // `error` is kept as a safe compatibility alias while clients migrate to `message`.
  return NextResponse.json({ ok: false, code, message, error: message }, { status });
}

export function apiInternalError(stage: string, error: unknown) {
  console.error("API request failed", {
    stage,
    error: error instanceof Error ? error.message : "unknown_error",
  });
  return apiError("INTERNAL_ERROR", "No se pudo completar la operación. Intentá nuevamente.", 500);
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function boundedString(value: unknown, maxLength: number, options?: { required?: boolean; trim?: boolean }) {
  const result = typeof value === "string" ? (options?.trim === false ? value : value.trim()) : "";
  if ((options?.required && !result) || result.length > maxLength) return null;
  return result;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
