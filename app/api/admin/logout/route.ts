import { NextResponse } from "next/server";
import { ADMIN_COOKIE, adminSessionCookie } from "@/lib/admin-auth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, "", { ...adminSessionCookie, maxAge: 0 });

  return response;
}
