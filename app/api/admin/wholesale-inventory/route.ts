import { NextResponse } from "next/server";
import { getAdminIdentity } from "@/lib/admin-auth";
import { apiError, boundedString, isUuid, readJsonObject } from "@/lib/api";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import { isWholesaleSessionWriteAllowed } from "@/lib/wholesale-session-origin";

type WholesaleInventoryRpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

async function guard(write = false) {
  const identity = await getAdminIdentity();
  if (identity?.role !== "ADMIN" || (write && (identity.legacy || !isUuid(identity.id)))) return { response: apiError("FORBIDDEN", "No autorizado.", 403), identity: null };
  if (!isServiceRoleConfigured()) return { response: apiError("CONFIGURATION_ERROR", "Administración no configurada.", 503), identity: null };
  return { response: null, identity };
}

export async function GET() {
  const { response } = await guard();
  if (response) return response;
  try {
    const db = createAdminServerClient();
    const { data, error } = await db.rpc("list_wholesale_inventory");
    if (error) throw error;
    const { data: metadata, error: metadataError } = await db.from("products").select("id,connector_type");
    if (metadataError) throw metadataError;
    const connectors = new Map(((metadata || []) as { id: string; connector_type: string | null }[]).map(product => [product.id, product.connector_type]));
    const inventory = data as unknown as { products: { productId: string }[]; movements: unknown[] };
    return NextResponse.json({ ok: true, data: { ...inventory, products: inventory.products.map(product => ({ ...product, connectorType: connectors.get(product.productId) })) } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo cargar el inventario mayorista.", 500);
  }
}

export async function POST(request: Request) {
  const { response, identity } = await guard(true);
  if (response) return response;
  if (!isWholesaleSessionWriteAllowed(request)) return apiError("FORBIDDEN", "No se pudo validar el origen de la solicitud.", 403);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return apiError("BAD_REQUEST", "Formato de solicitud inválido.", 400);
  const body = await readJsonObject(request);
  if (!body || Object.keys(body).some(key => !["productId", "type", "quantity", "reason", "idempotencyKey"].includes(key))) return apiError("BAD_REQUEST", "Datos del movimiento inválidos.", 400);
  const productId = boundedString(body.productId, 64, { required: true });
  const reason = boundedString(body.reason, 500, { required: true });
  const type = body.type;
  const quantity = body.quantity;
  if (!productId || !reason || !["receipt", "adjustment"].includes(String(type)) || !Number.isInteger(quantity) || quantity === 0 || Math.abs(Number(quantity)) > 100000 || !isUuid(body.idempotencyKey)) {
    return apiError("BAD_REQUEST", "Indicá producto, tipo, cantidad, motivo y clave válidos.", 400);
  }
  if (type === "receipt" && Number(quantity) < 1) return apiError("BAD_REQUEST", "Una recepción debe ser mayor que cero.", 400);
  try {
    const rpcClient = createAdminServerClient() as unknown as WholesaleInventoryRpcClient;
    const { data, error } = await rpcClient.rpc("record_wholesale_stock_movement", {
      p_product_id: productId, p_movement_type: type, p_quantity: quantity, p_reason: reason,
      p_key: body.idempotencyKey, p_actor: identity!.id,
    });
    if (error) {
      if (error.message.includes("WHOLESALE_STOCK_BELOW_RESERVED")) return apiError("BAD_REQUEST", "El ajuste no puede dejar el stock por debajo de las unidades reservadas.", 409);
      if (error.message.includes("WHOLESALE_IDEMPOTENCY_CONFLICT")) return apiError("BAD_REQUEST", "La clave de operación ya se usó con otros datos.", 409);
      if (error.message.includes("WHOLESALE_ADMIN_REQUIRED")) return apiError("FORBIDDEN", "No autorizado para registrar movimientos.", 403);
      throw error;
    }
    return NextResponse.json({ ok: true, data: { movementId: data } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo registrar el movimiento mayorista.", 500);
  }
}
