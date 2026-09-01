import { NextResponse } from "next/server";
import { adminSessionCookie, createAdminSession, isAdminSessionConfigured } from "@/lib/admin-auth";
import { apiError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const limited = rateLimit(request, "admin-login", { limit: 5, windowMs: 15 * 60 * 1000 });
  if (limited) return limited;
  const formData = await request.formData();
  const password = String(formData.get("password") ?? "");

  if (!isAdminSessionConfigured()) {
    console.error("Admin login unavailable", { stage: "admin_login_configuration" });
    return apiError("CONFIGURATION_ERROR", "El acceso administrativo no está configurado.", 503);
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    return apiError("UNAUTHORIZED", "Credenciales inválidas.", 401);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("dcl_admin_auth", createAdminSession(), adminSessionCookie);

  return response;
}
