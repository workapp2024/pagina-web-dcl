import { NextResponse } from "next/server";
import { getWholesaleSessionCustomerId } from "@/lib/wholesale-server";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import { isSameOriginWrite } from "@/lib/store/buyer-session";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ITEM_ID_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,63}$/u;
const privateHeaders = { "Cache-Control": "no-store, private" };

function errorResponse(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status, headers: privateHeaders });
}

function rpcError(error: { message?: string; code?: string }) {
  const message = error.message || "";
  if (message.includes("WHOLESALE_IDEMPOTENCY_CONFLICT")) return errorResponse("La clave de solicitud ya se usó con otros productos. Iniciá una nueva solicitud.", 409);
  if (message.includes("WHOLESALE_PRODUCT_UNAVAILABLE")) return errorResponse("Uno o más productos ya no están disponibles para pedidos mayoristas. Actualizá el catálogo.", 422);
  if (message.includes("WHOLESALE_CUSTOMER_UNAVAILABLE")) return errorResponse("El acceso mayorista ya no está activo. Volvé a ingresar.", 401);
  if (message.includes("WHOLESALE_INVALID_ITEMS") || message.includes("WHOLESALE_INVALID_REQUEST")) return errorResponse("Revisá los productos y las cantidades e intentá nuevamente.", 400);
  return errorResponse("No se pudo crear la solicitud. Intentá nuevamente.", 503);
}

export async function POST(request: Request) {
  const customerId = await getWholesaleSessionCustomerId();
  if (!customerId) return errorResponse("Ingresá a tu cuenta mayorista para enviar una solicitud.", 401);
  if (!isSameOriginWrite(request)) return errorResponse("No se pudo validar el origen de la solicitud.", 403);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return errorResponse("El formato de la solicitud no es válido.", 400);

  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("El contenido de la solicitud no es JSON válido.", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse("Revisá los productos e intentá nuevamente.", 400);
  const payload = body as Record<string, unknown>;
  if (Object.keys(payload).sort().join(",") !== "idempotencyKey,items" || !UUID_PATTERN.test(String(payload.idempotencyKey))
    || !Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 50) {
    return errorResponse("Revisá los productos e intentá nuevamente.", 400);
  }
  const seen = new Set<string>();
  const items: { productId: string; quantity: number }[] = [];
  for (const entry of payload.items) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return errorResponse("Hay productos o cantidades inválidos.", 400);
    const item = entry as Record<string, unknown>;
    if (Object.keys(item).sort().join(",") !== "productId,quantity" || typeof item.productId !== "string"
      || !ITEM_ID_PATTERN.test(item.productId) || !Number.isInteger(item.quantity) || Number(item.quantity) < 1 || Number(item.quantity) > 100
      || seen.has(item.productId)) return errorResponse("Hay productos o cantidades inválidos.", 400);
    seen.add(item.productId);
    items.push({ productId: item.productId, quantity: Number(item.quantity) });
  }
  if (!isServiceRoleConfigured()) return errorResponse("El servicio de pedidos no está disponible. Intentá más tarde.", 503);

  try {
    const { data, error } = await createAdminServerClient().rpc("create_wholesale_order" as never, {
      p_customer: customerId,
      p_items: items as never,
      p_idempotency_key: payload.idempotencyKey as string,
    } as never) as unknown as { data: string | null; error: { message?: string; code?: string } | null };
    if (error || !data) return rpcError(error || { message: "empty response" });
    return NextResponse.json({ ok: true, orderId: data }, { headers: privateHeaders });
  } catch {
    return errorResponse("No se pudo crear la solicitud. Intentá nuevamente.", 503);
  }
}
