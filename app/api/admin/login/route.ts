import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const formData = await request.formData();
  const password = String(formData.get("password") ?? "");

  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ ok: false, message: "Credenciales inválidas." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("dcl_admin_auth", password, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return response;
}
