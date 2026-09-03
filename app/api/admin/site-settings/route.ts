import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import type { SiteSettings } from "@/lib/site-data";
import type { Database } from "@/lib/supabase/database.types";
import { DEFAULT_THEME, isThemePreset } from "@/lib/theme";
import { boundedString, readJsonObject } from "@/lib/api";

export type SiteSettingsInsert = Database["public"]["Tables"]["site_settings"]["Insert"];

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
    const siteSettings = body.siteSettings as Partial<SiteSettings> | undefined;

    if (!siteSettings) {
      return NextResponse.json({ ok: false, message: "Datos de configuración no válidos." }, { status: 400 });
    }

    const radioName = boundedString(siteSettings.radioName, 100) || "La Nueva";
    const radioSubtitle = boundedString(siteSettings.radioSubtitle, 180) || "";
    const radioStreamUrl = boundedString(siteSettings.radioStreamUrl, 2000) || "";
    let parsedRadioUrl: URL | null = null; try { parsedRadioUrl = new URL(radioStreamUrl); } catch {}
    if (!parsedRadioUrl || parsedRadioUrl.protocol !== "https:") return NextResponse.json({ ok: false, message: "La URL de radio debe usar HTTPS." }, { status: 400 });
    const row: SiteSettingsInsert = {
      id: 1,
      logo_url: siteSettings.logo || "",
      whatsapp: siteSettings.whatsapp || "",
      instagram: siteSettings.instagram || "",
      facebook: siteSettings.facebook || "",
      email: siteSettings.email || "",
      phone: siteSettings.phone || "",
      address: siteSettings.address || "",
      vehicle_section_title: siteSettings.vehicleSectionTitle || "",
      needs_section_title: siteSettings.needsSectionTitle || "",
      why_us_section_title: siteSettings.whyUsSectionTitle || "",
      products_section_title: siteSettings.productsSectionTitle || "",
      promotions_section_title: siteSettings.promotionsSectionTitle || "",
      theme_preset: isThemePreset(siteSettings.themePreset) ? siteSettings.themePreset : DEFAULT_THEME,
      radio_enabled: siteSettings.radioEnabled !== false,
      radio_show_player: siteSettings.radioShowPlayer !== false,
      radio_name: radioName,
      radio_stream_url: radioStreamUrl,
      radio_subtitle: radioSubtitle,
      transfer_alias: boundedString(siteSettings.transferAlias, 120) || "",
      transfer_cbu_cvu: boundedString(siteSettings.transferCbuCvu, 40) || "",
      transfer_holder: boundedString(siteSettings.transferHolder, 160) || "",
      transfer_institution: boundedString(siteSettings.transferInstitution, 160) || "",
      transfer_instructions: boundedString(siteSettings.transferInstructions, 1000) || "",
    };

    const supabase = createAdminServerClient();
    const { data, error } = await supabase
      .from("site_settings")
      .upsert(row as never, { onConflict: "id" })
      .select("*")
      .single();

    if (error) {
      console.warn("Error al persistir site_settings en Supabase:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("Excepción en API site-settings admin:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error interno del servidor." },
      { status: 500 }
    );
  }
}
