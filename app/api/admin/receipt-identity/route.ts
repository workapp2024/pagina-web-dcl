import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { isWholesaleSessionWriteAllowed } from "@/lib/wholesale-session-origin";
import { rateLimit } from "@/lib/rate-limit";
import { parseReceiptIdentity } from "@/lib/receipt-identity";
import { readReceiptIdentity, saveReceiptIdentity } from "@/lib/receipt-identity-server";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function GET() {
  if (!(await isAdminAuthenticated())) return reply({ error: "No autorizado." }, 401);
  try { return reply(await readReceiptIdentity()); } catch { return reply({ error: "No se pudo cargar la configuración." }, 503); }
}
export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return reply({ error: "No autorizado." }, 401);
  if (!isWholesaleSessionWriteAllowed(request)) return reply({ error: "Origen inválido." }, 403);
  const limited = rateLimit(request, "receipt-identity", { limit: 30, windowMs: 60000 });
  if (limited) return limited;
  if (Number(request.headers.get("content-length")) > 10000) return reply({ error: "Configuración demasiado grande." }, 400);
  let body;
  try { body = await request.json(); body.settings = parseReceiptIdentity(body.settings); } catch { return reply({ error: "Revisá los colores, logos y controles elegidos." }, 400); }
  try {
    if (!(await readReceiptIdentity()).available) return reply({ error: "Guardar requiere habilitar la configuración en la base de datos." }, 503);
    const result = await saveReceiptIdentity(body.settings, body.revision);
    return result ? reply(result) : reply({ error: "Otra persona actualizó el diseño. Recargá antes de guardar." }, 409);
  } catch { return reply({ error: "No se pudo guardar. Recargá y volvé a intentarlo." }, 503); }
}
