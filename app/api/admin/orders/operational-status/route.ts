import { NextResponse } from "next/server";
import { apiError, apiInternalError, boundedString, isUuid, readJsonObject } from "@/lib/api";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { isOperationalStatus } from "@/lib/store/order-operations";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";

const errors: Record<string, string> = {
  OPERATIONAL_FINANCIAL_REVERSAL_REQUIRED: "El pedido requiere un proceso financiero de revisión o devolución. El estado operativo no lo reemplaza.",
  OPERATIONAL_CLOSE_PAYMENT_FIRST: "Primero debe resolverse la cancelación o el rechazo por el flujo actual. Esta acción no cancela pagos ni libera reservas.",
  OPERATIONAL_PAYMENT_REQUIRED: "Para avanzar se requiere pago aprobado y una venta vigente sin incidencia pendiente.",
  OPERATIONAL_STALE_STATE: "Otro cambio actualizó este pedido. Actualizá la lista antes de continuar.",
  OPERATIONAL_INVALID_TRANSITION: "La transición operativa solicitada no está permitida.",
};

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return apiError("UNAUTHORIZED", "No autorizado.", 401);
  if (!isServiceRoleConfigured()) return apiError("CONFIGURATION_ERROR", "Falta configurar el acceso al servidor.", 503);
  const body = await readJsonObject(request);
  const note = body ? boundedString(body.note ?? "", 1000) : null;
  if (!body || !isUuid(body.orderId) || !isOperationalStatus(body.expectedStatus) || !isOperationalStatus(body.status) || note === null) {
    return apiError("BAD_REQUEST", "Revisá el pedido, el estado y la nota.", 400);
  }
  try {
    const db = createAdminServerClient();
    const { data, error } = await db.rpc("set_order_operational_status" as never, {
      p_order: body.orderId, p_expected: body.expectedStatus, p_status: body.status, p_note: note,
    } as never) as unknown as { data: string | null; error: { message: string } | null };
    if (error) {
      if (error.message === "OPERATIONAL_ORDER_NOT_FOUND") return apiError("NOT_FOUND", "Pedido no encontrado.", 404);
      if (errors[error.message]) return apiError("BAD_REQUEST", errors[error.message], 409);
      throw new Error(error.message);
    }
    if (!data) throw new Error("No se pudo actualizar el estado operativo.");
    return NextResponse.json({ ok: true, operationalStatus: data });
  } catch (error) { return apiInternalError("admin_order_operational_status", error); }
}
