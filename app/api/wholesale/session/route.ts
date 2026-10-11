import { NextResponse } from "next/server";
import { boundedString, readJsonObject } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { isWholesaleSessionWriteAllowed } from "@/lib/wholesale-session-origin";
import { createWholesaleSessionToken, isValidManualWholesaleCode, normalizeWholesaleCode, verifyWholesaleCode } from "@/lib/wholesale-access";
import {
  createWholesaleSession, findActiveWholesaleCustomerByCode, WHOLESALE_SESSION_COOKIE,
  wholesaleSessionCookieOptions,
} from "@/lib/wholesale-server";

const invalidCode = () => NextResponse.json({ ok: false, error: "Código inválido o acceso inactivo." }, { status: 401, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const limited = rateLimit(request, "wholesale-access", { limit: 8, windowMs: 60_000 });
  if (limited) return limited;
  if (!isWholesaleSessionWriteAllowed(request)) return invalidCode();

  const body = await readJsonObject(request);
  const code = boundedString(body?.code, 64, { required: true });
  if (!code) return invalidCode();
  const normalizedCode = normalizeWholesaleCode(code);
  const isManualCode = isValidManualWholesaleCode(normalizedCode);
  const isExistingGeneratedCode = /^[A-Za-z0-9_-]{24}$/.test(code);
  if (!isManualCode && !isExistingGeneratedCode) return invalidCode();

  const { customer, matchedCode, unavailable } = await findActiveWholesaleCustomerByCode(code);
  if (unavailable) return NextResponse.json({ ok: false, error: "No se pudo validar el acceso. Intentá nuevamente." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (!customer || !matchedCode || !verifyWholesaleCode(matchedCode, customer.wholesale_code_hash)) return invalidCode();

  const token = createWholesaleSessionToken();
  const created = await createWholesaleSession(customer.id, customer.wholesale_code_updated_at!, token);
  if (!created) return NextResponse.json({ ok: false, error: "No se pudo iniciar la sesión. Intentá nuevamente." }, { status: 503, headers: { "Cache-Control": "no-store" } });

  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(WHOLESALE_SESSION_COOKIE, token, wholesaleSessionCookieOptions);
  return response;
}
