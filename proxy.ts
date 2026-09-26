import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_MAINTENANCE_MESSAGE,
  MAINTENANCE_MESSAGE,
  isMaintenanceMode,
} from "@/lib/maintenance-mode";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const WEBHOOK_PATHS = new Set([
  "/api/payments/mercadopago/webhook",
  "/api/payments/mercadopago/checkout-pro-webhook",
]);
const PUBLIC_WRITE_PATHS = new Set([
  "/api/store/buyer-session",
  "/api/store/orders/recover",
  "/api/store/orders",
  "/api/payments/mercadopago/orders",
  "/api/payments/mercadopago/preference",
]);

export function proxy(request: NextRequest) {
  if (!isMaintenanceMode() || !WRITE_METHODS.has(request.method)) {
    return NextResponse.next();
  }

  const path = request.nextUrl.pathname;
  const webhook = WEBHOOK_PATHS.has(path);
  const admin = path.startsWith("/api/admin/") &&
    path !== "/api/admin/login" && path !== "/api/admin/logout";
  const transfer = /^\/api\/store\/orders\/[^/]+\/status$/.test(path);

  if (!webhook && !admin && !transfer && !PUBLIC_WRITE_PATHS.has(path)) {
    return NextResponse.next();
  }

  // Mercado Pago treats a non-2xx response as unacknowledged and retries later.
  // No handler, provider call, or local database write runs for this request.
  const message = admin ? ADMIN_MAINTENANCE_MESSAGE : MAINTENANCE_MESSAGE;
  return NextResponse.json(
    { ok: false, code: "MAINTENANCE", message, error: message },
    {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "60" },
    },
  );
}

export const config = { matcher: "/api/:path*" };
