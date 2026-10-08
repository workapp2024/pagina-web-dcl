import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isSameOriginWrite } from "@/lib/store/buyer-session";
import { deleteWholesaleSession, WHOLESALE_SESSION_COOKIE, wholesaleSessionCookieOptions } from "@/lib/wholesale-server";

export async function POST(request: Request) {
  if (!isSameOriginWrite(request)) return NextResponse.json({ ok: false }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const token = (await cookies()).get(WHOLESALE_SESSION_COOKIE)?.value;
  if (token && !(await deleteWholesaleSession(token))) return NextResponse.json({ ok: false, error: "No se pudo cerrar la sesión. Intentá nuevamente." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(WHOLESALE_SESSION_COOKIE, "", { ...wholesaleSessionCookieOptions, maxAge: 0 });
  return response;
}
