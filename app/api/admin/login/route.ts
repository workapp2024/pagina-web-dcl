import { NextResponse } from "next/server";
import { adminSessionCookie, createAdminSession, isAdminSessionConfigured, legacyAdminEnabled } from "@/lib/admin-auth";
import { createServerClient, createAdminServerClient } from "@/lib/supabase/server";
import type { StaffProfile } from "@/lib/admin-permissions";
import { apiError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";

type AdminLoginOutcome =
  | "auth_rejected"
  | "profile_query_error"
  | "profile_missing"
  | "profile_inactive"
  | "profile_role_rejected"
  | "login_success";

function logAdminLoginOutcome(outcome: AdminLoginOutcome) {
  console.info(`[admin-login] ${outcome}`);
}

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
  let individualLogin = false;
  if (email) {
    let data;
    let error;
    try {
      ({ data, error } = await createServerClient().auth.signInWithPassword({ email, password }));
    } catch {
      logAdminLoginOutcome("auth_rejected");
      return apiError("UNAUTHORIZED", "No se pudo iniciar sesión.", 401);
    }
    if (error || !data.user) {
      logAdminLoginOutcome("auth_rejected");
      return apiError("UNAUTHORIZED", "Credenciales inválidas o usuario inactivo.", 401);
    }

    let result;
    try {
      result = await createAdminServerClient().from("admin_profiles").select("*").eq("id", data.user.id).maybeSingle();
    } catch {
      logAdminLoginOutcome("profile_query_error");
      return apiError("UNAUTHORIZED", "No se pudo iniciar sesión.", 401);
    }
    if (result.error) {
      logAdminLoginOutcome("profile_query_error");
      return apiError("UNAUTHORIZED", "Credenciales inválidas o usuario inactivo.", 401);
    }
    const found = result.data as StaffProfile | null;
    if (!found) {
      logAdminLoginOutcome("profile_missing");
      return apiError("UNAUTHORIZED", "Credenciales inválidas o usuario inactivo.", 401);
    }
    if (!found.active) {
      logAdminLoginOutcome("profile_inactive");
      return apiError("UNAUTHORIZED", "Credenciales inválidas o usuario inactivo.", 401);
    }
    if (!["ADMIN", "VENDEDOR"].includes(found.role)) {
      logAdminLoginOutcome("profile_role_rejected");
      return apiError("UNAUTHORIZED", "Credenciales inválidas o usuario inactivo.", 401);
    }
    profile = found;
    individualLogin = true;
  } else if (!legacyAdminEnabled() || !process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return apiError("UNAUTHORIZED", "Credenciales inválidas.", 401);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("dcl_admin_auth", createAdminSession(profile), adminSessionCookie);
  if (individualLogin) logAdminLoginOutcome("login_success");

  return response;
}
