import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { isWholesaleSessionWriteAllowed } from "@/lib/wholesale-session-origin";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminServerClient } from "@/lib/supabase/server";
import { STORAGE_BUCKET } from "@/lib/supabase/storage";
import { normalizeReceiptLogo, RECEIPT_LOGO_MAX_BYTES } from "@/lib/receipt-logo";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  if (!(await isAdminAuthenticated())) return reply({ error: "No autorizado." }, 401);
  if (!isWholesaleSessionWriteAllowed(request)) return reply({ error: "Origen inválido." }, 403);
  const limited = rateLimit(request, "receipt-logo", { limit: 12, windowMs: 60000 });
  if (limited) return limited;
  if (Number(request.headers.get("content-length")) > RECEIPT_LOGO_MAX_BYTES + 16384) return reply({ error: "Usá PNG o JPG de hasta 2 MB." }, 400);
  try {
    const form = await request.formData(), file = form.get("file");
    if (!(file instanceof File) || file.size > RECEIPT_LOGO_MAX_BYTES) return reply({ error: "Usá PNG o JPG de hasta 2 MB." }, 400);
    let bytes;
    try { bytes = await normalizeReceiptLogo(new Uint8Array(await file.arrayBuffer()), file.type); }
    catch { return reply({ error: "Usá una imagen PNG o JPG válida, estática, de hasta 2 MB y 4096 píxeles por lado." }, 400); }
    const path = `site/receipt-identity/${randomUUID()}.png`;
    const { error } = await createAdminServerClient().storage.from(STORAGE_BUCKET).upload(path, bytes, { upsert: false, contentType: "image/png", cacheControl: "3600" });
    if (error) return reply({ error: "No se pudo subir el logo." }, 503);
    return reply({ path });
  } catch { return reply({ error: "No se pudo subir el logo." }, 400); }
}
