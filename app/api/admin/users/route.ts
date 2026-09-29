import { NextResponse } from "next/server";
import { getAdminIdentity, isIndividualAdmin } from "@/lib/admin-auth";
import { isBootstrapAvailable } from "@/lib/admin-account";
import { apiError, isUuid, readJsonObject } from "@/lib/api";
import { createAdminServerClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";

export async function GET() {
  const identity = await getAdminIdentity();
  if (identity?.role !== "ADMIN") return apiError("FORBIDDEN", "Acceso denegado.", 403);
  if (identity.legacy) {
    try { return NextResponse.json({ ok: true, data: [], legacy: true, bootstrapAvailable: await isBootstrapAvailable() }); }
    catch { return apiError("CONFIGURATION_ERROR", "No se pudo comprobar el alta inicial. Verificá la migración.", 503); }
  }
  const { data, error } = await createAdminServerClient().from("admin_profiles")
    .select("id,email,display_name,role,active").order("created_at");
  if (error) return apiError("CONFIGURATION_ERROR", "No se pudieron leer los usuarios. Verificá la migración.", 503);
  return NextResponse.json({ ok: true, data, legacy: false, bootstrapAvailable: false });
}

export async function POST(request: Request) {
  if (!(await isIndividualAdmin())) return apiError("FORBIDDEN", "Ingresá con tu cuenta ADMIN individual.", 403);
  const limited = rateLimit(request, "admin-create-user", { limit: 10, windowMs: 15 * 60 * 1000 });
  if (limited) return limited;
  const body = await readJsonObject(request);
  if (!body || (body.role !== undefined && body.role !== "VENDEDOR")) return apiError("BAD_REQUEST", "Sólo se pueden crear vendedores desde esta pantalla.", 400);
  const { email, password, name } = body;
  if (typeof email !== "string" || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== "string" || password.length < 12 || password.length > 128 || typeof name !== "string" || name.length > 160) {
    return apiError("BAD_REQUEST", "Revisá nombre, email y contraseña (12 a 128 caracteres).", 400);
  }
  const db = createAdminServerClient();
  // Credentials stay in Auth; role is never taken from user_metadata.
  const { data, error } = await db.auth.admin.createUser({ email: email.trim(), password, email_confirm: true });
  if (error || !data.user) return apiError("BAD_REQUEST", "No se pudo crear el acceso. Verificá el email y la política de contraseñas.", 400);
  const profile = { id: data.user.id, email: data.user.email || email.trim(), display_name: name.trim(), role: "VENDEDOR" as const, active: true };
  const result = await db.from("admin_profiles").insert(profile as never);
  if (result.error) {
    // Only the just-created Auth identity can be removed on failed provisioning.
    await db.auth.admin.deleteUser(data.user.id);
    return apiError("CONFIGURATION_ERROR", "No se pudo crear el perfil. Verificá la migración antes de reintentar.", 503);
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function PATCH(request: Request) {
  if (!(await isIndividualAdmin())) return apiError("FORBIDDEN", "Ingresá con tu cuenta ADMIN individual.", 403);
  const body = await readJsonObject(request);
  if (!body || !isUuid(body.id) || typeof body.active !== "boolean" || Object.keys(body).some(key => !["id", "active"].includes(key))) return apiError("BAD_REQUEST", "Cambio no válido.", 400);
  // Owner accounts cannot be disabled or demoted through this V1 API.
  const { data, error } = await createAdminServerClient().from("admin_profiles").update({ active: body.active } as never)
    .eq("id", body.id).eq("role", "VENDEDOR").select("id").maybeSingle();
  if (error || !data) return apiError("BAD_REQUEST", "No se pudo actualizar el vendedor.", 400);
  return NextResponse.json({ ok: true });
}
