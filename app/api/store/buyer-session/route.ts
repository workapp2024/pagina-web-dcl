import { rateLimit } from "@/lib/rate-limit";
import { establishBuyerSession, isSameOriginWrite } from "@/lib/store/buyer-session";
export async function POST(request: Request) {
  const limited = rateLimit(request, "buyer-session", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;
  if (!isSameOriginWrite(request)) return Response.json({ ok: false }, { status: 403 });
  try {
    await establishBuyerSession();
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ ok: false, error: "No pudimos preparar la recuperación del pedido." }, { status: 503 }); }
}
