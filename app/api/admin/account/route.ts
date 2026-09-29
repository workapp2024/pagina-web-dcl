import { NextResponse } from "next/server";
import { ADMIN_COOKIE, adminSessionCookie, createAdminSession, getAdminIdentity } from "@/lib/admin-auth";
import { validNewPassword } from "@/lib/admin-account";
import { apiError, readJsonObject } from "@/lib/api";
import { createAdminServerClient } from "@/lib/supabase/server";
import type { StaffProfile } from "@/lib/admin-permissions";
import { rateLimit } from "@/lib/rate-limit";

export async function GET() {
  const identity = await getAdminIdentity();
  if (!identity || identity.legacy) return apiError("UNAUTHORIZED", "Ingresá con tu cuenta individual.", 401);
  const { data, error } = await createAdminServerClient().from("admin_profiles")
    .select("display_name,email,role").eq("id", identity.id).eq("active", true).eq("session_version", identity.sessionVersion!).maybeSingle();
  if (error || !data) return apiError("UNAUTHORIZED", "Volvé a iniciar sesión.", 401);
  return NextResponse.json({ ok: true, data }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const identity = await getAdminIdentity();
  if (!identity || identity.legacy) return apiError("UNAUTHORIZED", "Ingresá con tu cuenta individual.", 401);
  const limited = rateLimit(request, "admin-account", { limit: 10, windowMs: 15 * 60 * 1000 });
  if (limited) return limited;
  const body = await readJsonObject(request);
  if (!body || Object.keys(body).some(key => !["name", "password", "confirmation"].includes(key))) return apiError("BAD_REQUEST", "Cambio no permitido.", 400);
  const passwordChange = Object.hasOwn(body, "password") || Object.hasOwn(body, "confirmation");
  if ((passwordChange && !validNewPassword(body.password, body.confirmation)) || (Object.hasOwn(body, "name") && (typeof body.name !== "string" || body.name.length > 160)) || (!passwordChange && !Object.hasOwn(body, "name"))) return apiError("BAD_REQUEST", "Revisá el nombre y las contraseñas coincidentes de 12 a 128 caracteres.", 400);
  const db = createAdminServerClient();
  // Compare-and-swap against the authenticated cookie version: concurrent password
  // changes, deactivation and role changes cannot revive an old session.
  const patch = { ...(typeof body.name === "string" ? { display_name: body.name.trim() } : {}), ...(passwordChange ? { session_version: identity.sessionVersion! + 1 } : {}) };
  const { data, error } = await db.from("admin_profiles").update(patch as never).eq("id", identity.id)
    .eq("active", true).eq("session_version", identity.sessionVersion!).select("*").maybeSingle();
  if (error || !data) return apiError("UNAUTHORIZED", "No se pudo actualizar la cuenta. Volvé a iniciar sesión.", 401);
  if (passwordChange) {
    try {
      const result = await db.auth.admin.updateUserById(identity.id, { password: body.password as string });
      if (result.error) throw new Error("PASSWORD_UPDATE_FAILED");
    } catch {
      const response = apiError("BAD_REQUEST", "No se pudo confirmar el cambio de contraseña. Volvé a iniciar sesión y revisá la política de contraseñas.", 400);
      response.cookies.set(ADMIN_COOKIE, "", { ...adminSessionCookie, maxAge: 0 });
      return response;
    }
    // Also retire cookies issued by a concurrent login while Auth was updating.
    const final = await db.from("admin_profiles").update({ session_version: identity.sessionVersion! + 2 } as never)
      .eq("id", identity.id).eq("active", true).eq("session_version", identity.sessionVersion! + 1).select("*").maybeSingle();
    if (final.error || !final.data) {
      const response = apiError("UNAUTHORIZED", "Contraseña actualizada. Iniciá sesión nuevamente.", 401);
      response.cookies.set(ADMIN_COOKIE, "", { ...adminSessionCookie, maxAge: 0 });
      return response;
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(ADMIN_COOKIE, createAdminSession(final.data as StaffProfile), adminSessionCookie);
    return response;
  }
  return NextResponse.json({ ok: true });
}
