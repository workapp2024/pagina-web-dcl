import { isUuid, readJsonObject } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { buyerNotFound, getBuyerSession, isSameOriginWrite, recoverBuyerOrder } from "@/lib/store/buyer-session";
export async function POST(request: Request) {
  const limited = rateLimit(request, "buyer-recover", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  if (!isSameOriginWrite(request)) return buyerNotFound();
  try {
    const body = await readJsonObject(request), session = await getBuyerSession();
    if (!session || !isUuid(body?.idempotencyKey)) return buyerNotFound();
    const orderNumber = await recoverBuyerOrder(session.id, body.idempotencyKey);
    return Response.json({ ok: true, orderNumber }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ ok: false, error: "No pudimos recuperar el pedido. Conservamos tu intento." }, { status: 503 }); }
}
