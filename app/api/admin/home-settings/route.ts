import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import type { SiteSettings } from "@/lib/site-data";
import type { Database } from "@/lib/supabase/database.types";

export type HomeSettingsInsert = Database["public"]["Tables"]["home_settings"]["Insert"];

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
    const body = await request.json();
    const homeSettings = body.homeSettings as Partial<SiteSettings> | undefined;

    if (!homeSettings) {
      return NextResponse.json({ ok: false, message: "Datos de configuración de Home no válidos." }, { status: 400 });
    }

    const row: HomeSettingsInsert = {
      id: 1,
      hero_title: homeSettings.heroTitle || "",
      hero_subtitle: homeSettings.heroSubtitle || "",
      hero_primary_cta: homeSettings.heroPrimaryCta || "",
      hero_secondary_cta: homeSettings.heroSecondaryCta || "",
      hero_image_url: homeSettings.heroImage || "",
    };

    const supabase = createAdminServerClient();
    const { data, error } = await supabase
      .from("home_settings")
      .upsert(row as any, { onConflict: "id" })
      .select("*")
      .single();

    if (error) {
      console.warn("Error al persistir home_settings en Supabase:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("Excepción en API home-settings admin:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error interno del servidor." },
      { status: 500 }
    );
  }
}
