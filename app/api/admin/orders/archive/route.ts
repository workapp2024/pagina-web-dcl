import { NextResponse } from "next/server";
import { apiError, apiInternalError, isUuid, readJsonObject } from "@/lib/api";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { archiveBlockMessages } from "@/lib/store/order-archive";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return apiError("UNAUTHORIZED", "No autorizado.", 401);
  if (!isServiceRoleConfigured()) return apiError("CONFIGURATION_ERROR", "Falta configurar el acceso al servidor.", 503);
  const body = await readJsonObject(request);
  if (!body || !isUuid(body.orderId) || typeof body.archive !== "boolean") return apiError("BAD_REQUEST", "Seleccioná un pedido y una acción válida.", 400);
  try {
    const db = createAdminServerClient();
    const { data, error } = await db.rpc("set_order_archived" as never, { p_order: body.orderId, p_archive: body.archive } as never) as unknown as { data: boolean | null; error: { message: string } | null };
    if (error) {
      if (error.message === "ARCHIVE_ORDER_NOT_FOUND") return apiError("NOT_FOUND", "Pedido no encontrado.", 404);
      if (error.message.startsWith("ARCHIVE_NOT_ALLOWED: ")) {
        const reason = error.message.slice("ARCHIVE_NOT_ALLOWED: ".length);
        return apiError("BAD_REQUEST", archiveBlockMessages[reason] || "El pedido requiere revisión y no puede archivarse.", 409);
      }
      throw new Error(error.message);
    }
    if (typeof data !== "boolean") throw new Error("No se pudo registrar el archivado.");
    return NextResponse.json({ ok: true, archived: data });
  } catch (error) { return apiInternalError("admin_order_archive", error); }
}
