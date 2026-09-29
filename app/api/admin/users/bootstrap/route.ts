import { NextResponse } from "next/server";
import { getAdminIdentity, legacyAdminEnabled } from "@/lib/admin-auth";
import { isBootstrapAvailable, validNewPassword } from "@/lib/admin-account";
import { apiError, readJsonObject } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const identity = await getAdminIdentity();
  if (!identity?.legacy || identity.role !== "ADMIN" || !legacyAdminEnabled()) return apiError("FORBIDDEN", "Se requiere el acceso administrativo anterior.", 403);
  const limited = rateLimit(request, "admin-bootstrap", { limit: 5, windowMs: 15 * 60 * 1000 });
  if (limited) return limited;
  const body = await readJsonObject(request);
  if (!body || Object.keys(body).some(key => !["name", "email", "password", "confirmation"].includes(key)) || typeof body.name !== "string" || !body.name.trim() || body.name.length > 160 || typeof body.email !== "string" || body.email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || !validNewPassword(body.password, body.confirmation)) {
    return apiError("BAD_REQUEST", "Revisá nombre, email y las contraseñas coincidentes de 12 a 128 caracteres.", 400);
  }
  try {
    if (!(await isBootstrapAvailable())) return apiError("FORBIDDEN", "El administrador principal ya fue creado.", 409);
    const db = createAdminServerClient();
    const { data, error } = await db.auth.admin.createUser({ email: body.email.trim(), password: body.password, email_confirm: true });
    if (error || !data.user) return apiError("BAD_REQUEST", "No se pudo crear el acceso. Revisá el email y la política de contraseñas.", 400);
    const result = await db.rpc("complete_admin_bootstrap", { p_user: data.user.id, p_email: data.user.email || body.email.trim(), p_name: body.name.trim() } as never);
    if (result.error) {
      // A definite SQL rejection rolled back. Never delete on an ambiguous network
      // failure: the profile may have committed even if its response was lost.
      if (result.error.message === "BOOTSTRAP_CLOSED") {
        await db.auth.admin.deleteUser(data.user.id);
        return apiError("FORBIDDEN", "El administrador principal ya fue creado.", 409);
      }
      return apiError("CONFIGURATION_ERROR", "No se pudo confirmar el alta. Probá iniciar sesión con el nuevo email antes de reintentar; el acceso anterior sigue disponible.", 503);
    }
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch { return apiError("CONFIGURATION_ERROR", "No se pudo confirmar el alta. Verificá la migración o probá el nuevo login. El acceso anterior sigue disponible.", 503); }
}
