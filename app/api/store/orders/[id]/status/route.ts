import { rateLimit } from "@/lib/rate-limit";
import { createAdminServerClient } from "@/lib/supabase/server";
import { authorizedBuyerOrder, buyerNotFound, isSameOriginWrite } from "@/lib/store/buyer-session";
import { getPublicOrder } from "@/lib/store/public-order";

// The existing path now accepts a commercial number, never an unprotected UUID.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(request, "public-order-status", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  try {
    const order = await getPublicOrder((await params).id);
    return order ? Response.json({ ok: true, ...order }, { headers: { "Cache-Control": "no-store" } }) : buyerNotFound();
  } catch { return Response.json({ ok: false, error: "No pudimos verificar el pedido. No vuelvas a pagar." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(request, "public-transfer-declared", { limit: 5, windowMs: 60_000 });
  if (limited) return limited;
  if (!isSameOriginWrite(request)) return buyerNotFound();
  try {
    const id = await authorizedBuyerOrder((await params).id);
    if (!id) return buyerNotFound();
    const { data, error } = await createAdminServerClient().rpc("declare_manual_transfer" as never, { p_order: id } as never);
    if (error || !data) return Response.json({ ok: false, error: "No pudimos registrar el aviso. Podés avisarnos por WhatsApp." }, { status: 409 });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ ok: false, error: "No pudimos registrar el aviso." }, { status: 503 }); }
}
