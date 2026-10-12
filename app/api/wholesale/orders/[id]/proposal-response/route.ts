import { NextResponse } from "next/server";
import { getWholesaleSessionCustomerId } from "@/lib/wholesale-server";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import { isWholesaleSessionWriteAllowed } from "@/lib/wholesale-session-origin";
import { isWholesaleUuid } from "@/lib/wholesale-order-api";

const privateHeaders = { "Cache-Control": "no-store, private" };
const fail = (code: string, error: string, status: number) =>
  NextResponse.json({ ok: false, code, error }, { status, headers: privateHeaders });

function mapRpcError(message: string) {
  if (message.includes("WHOLESALE_ORDER_NOT_FOUND")) return fail("NOT_FOUND", "No encontramos esta solicitud para tu cuenta.", 404);
  if (message.includes("WHOLESALE_REVISION_STALE")) return fail("REVISION_STALE", "La propuesta cambió. Actualizá el historial antes de responder.", 409);
  if (message.includes("WHOLESALE_REVISION_NOT_RESPONDABLE")) return fail("REVISION_NOT_RESPONDABLE", "Esta propuesta ya no está disponible para responder.", 409);
  if (message.includes("WHOLESALE_INVALID_REQUEST")) return fail("BAD_REQUEST", "Revisá los datos de la respuesta.", 400);
  return fail("OPERATION_UNAVAILABLE", "No se pudo registrar la respuesta. Actualizá el pedido y volvé a intentar.", 503);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const customerId = await getWholesaleSessionCustomerId();
  if (!customerId) return fail("UNAUTHORIZED", "Ingresá a tu cuenta mayorista para responder.", 401);
  if (!isWholesaleSessionWriteAllowed(request)) return fail("FORBIDDEN", "No se pudo validar el origen de la solicitud.", 403);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return fail("BAD_REQUEST", "El formato de la respuesta no es válido.", 400);
  const { id: orderId } = await context.params;
  if (!isWholesaleUuid(orderId)) return fail("BAD_REQUEST", "La solicitud seleccionada no es válida.", 400);

  let body: unknown;
  try { body = await request.json(); } catch { return fail("BAD_REQUEST", "El contenido no es JSON válido.", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("BAD_REQUEST", "Revisá los datos de la respuesta.", 400);
  const payload = body as Record<string, unknown>;
  if (Object.keys(payload).sort().join(",") !== "decision,revisionId"
    || !isWholesaleUuid(payload.revisionId)
    || (payload.decision !== "accept" && payload.decision !== "reject")) {
    return fail("BAD_REQUEST", "Elegí una respuesta válida para la propuesta vigente.", 400);
  }
  if (!isServiceRoleConfigured()) return fail("CONFIGURATION_ERROR", "El servicio mayorista no está disponible.", 503);

  const rpcName = payload.decision === "accept"
    ? "approve_wholesale_order_revision_portal"
    : "reject_wholesale_order_revision_portal";
  try {
    const { data, error } = await createAdminServerClient().rpc(rpcName as never, {
      p_order: orderId,
      p_customer: customerId,
      p_revision: payload.revisionId,
    } as never) as unknown as { data: boolean | null; error: { message?: string } | null };
    if (error) return mapRpcError(error.message || "operation failed");
    if (data !== true) return fail("OPERATION_UNAVAILABLE", "No se pudo confirmar la respuesta. Actualizá el pedido.", 503);
    return NextResponse.json({ ok: true, decision: payload.decision, revisionId: payload.revisionId }, { headers: privateHeaders });
  } catch {
    return fail("OPERATION_UNAVAILABLE", "No se pudo confirmar la respuesta. Actualizá el pedido antes de volver a intentar.", 503);
  }
}
