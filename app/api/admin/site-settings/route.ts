import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import { buildSiteSettingsPatch } from "@/lib/site-settings-patch";
import { readJsonObject } from "@/lib/api";

export async function POST(request: Request) {
  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ ok: false, message: "No autorizado." }, { status: 401 });
  }

  if (!isServiceRoleConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Falta configurar la variable de entorno privada SUPABASE_SERVICE_ROLE_KEY en .env.local para realizar escrituras administrativas en Supabase.",
      },
      { status: 500 }
    );
  }

  try {
    const body = await readJsonObject(request);
    if (!body) return NextResponse.json({ ok: false, message: "Datos de configuración no válidos." }, { status: 400 });
    let row;
    try {
      row = buildSiteSettingsPatch(body.section, body.siteSettings);
    } catch (error) {
      return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Datos no válidos." }, { status: 400 });
    }

    const supabase = createAdminServerClient();
    const { data, error } = await supabase
      .from("site_settings")
      .update(row as never)
      .eq("id", 1)
      .select("*")
      .maybeSingle();

    if (error) {
      console.warn("Error al persistir site_settings en Supabase:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    if (!data) return NextResponse.json({ ok: false, error: "No existe site_settings (id=1). No se creó ni reseteó configuración." }, { status: 409 });
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("Excepción en API site-settings admin:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error interno del servidor." },
      { status: 500 }
    );
  }
}
