import { NextResponse } from "next/server";
import { adminSessionCookie, createAdminSession, isAdminSessionConfigured, legacyAdminEnabled } from "@/lib/admin-auth";
import { createServerClient, createAdminServerClient } from "@/lib/supabase/server";
import type { StaffProfile } from "@/lib/admin-permissions";
import { apiError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const limited = rateLimit(request, "admin-login", { limit: 5, windowMs: 15 * 60 * 1000 });
  if (limited) return limited;
  const formData = await request.formData();
  const password = String(formData.get("password") ?? "");
  const email = String(formData.get("email") ?? "").trim();

  if (!isAdminSessionConfigured()) {
    console.error("Admin login unavailable", { stage: "admin_login_configuration" });
    return apiError("CONFIGURATION_ERROR", "El acceso administrativo no está configurado.", 503);
  }

  let profile: StaffProfile | undefined;
  if (email) {
    try {
      const { data, error } = await createServerClient().auth.signInWithPassword({ email, password });
      if (error || !data.user) return apiError("UNAUTHORIZED", "Credenciales inválidas o usuario inactivo.", 401);
      const result = await createAdminServerClient().from("admin_profiles").select("*").eq("id", data.user.id).maybeSingle();
      const found = result.data as StaffProfile | null;
      if (result.error || !found?.active || !["ADMIN", "VENDEDOR"].includes(found.role)) return apiError("UNAUTHORIZED", "Credenciales inválidas o usuario inactivo.", 401);
      profile = found;
    } catch { return apiError("UNAUTHORIZED", "No se pudo iniciar sesión.", 401); }
  } else if (!legacyAdminEnabled() || !process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return apiError("UNAUTHORIZED", "Credenciales inválidas.", 401);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("dcl_admin_auth", createAdminSession(profile), adminSessionCookie);

  return response;
}
