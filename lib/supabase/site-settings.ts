import { createBrowserClient } from "./client";
import { createServerClient } from "./server";
import { isSupabaseConfigured } from "./test-connection";
import { sanitizeStoredImageUrl } from "./storage";
import type { SiteSettings } from "@/lib/site-data";
import type { Database } from "./database.types";
import { isThemePreset } from "@/lib/theme";
import { whatsappUrl } from "@/lib/whatsapp";

export type SiteSettingsRow = Database["public"]["Tables"]["site_settings"]["Row"];

/**
 * Capa de lectura de site_settings (id=1) desde Supabase (Etapa 8).
 */
export async function getSupabaseSiteSettings(): Promise<Partial<SiteSettings> | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const client = typeof window === "undefined" ? createServerClient() : createBrowserClient();
    const { data, error } = await client
      .from("site_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      console.warn("Lectura de site_settings en Supabase no completada:", error.message);
      return null;
    }

    if (!data) {
      return null;
    }

    const row = data as unknown as SiteSettingsRow;

    const settings: Partial<SiteSettings> = {};
    const sanitizedLogo = sanitizeStoredImageUrl(row.logo_url);
    if (sanitizedLogo) settings.logo = sanitizedLogo;
    settings.whatsapp = whatsappUrl("Hola DCL Cree LED, quiero consultar por iluminación para mi vehículo.");
    if (row.instagram) settings.instagram = row.instagram;
    if (row.facebook) settings.facebook = row.facebook;
    if (row.email) settings.email = row.email;
    if (row.phone) settings.phone = row.phone;
    if (row.address) settings.address = row.address;
    if (isThemePreset(row.theme_preset)) settings.themePreset = row.theme_preset;
    if (row.vehicle_section_title) settings.vehicleSectionTitle = row.vehicle_section_title;
    if (row.needs_section_title) settings.needsSectionTitle = row.needs_section_title;
    if (row.why_us_section_title) settings.whyUsSectionTitle = row.why_us_section_title;
    if (row.products_section_title) settings.productsSectionTitle = row.products_section_title;
    if (row.promotions_section_title) settings.promotionsSectionTitle = row.promotions_section_title;
    if (typeof row.radio_enabled === "boolean") settings.radioEnabled = row.radio_enabled;
    if (typeof row.radio_show_player === "boolean") settings.radioShowPlayer = row.radio_show_player;
    if (row.radio_name) settings.radioName = row.radio_name;
    if (row.radio_stream_url) settings.radioStreamUrl = row.radio_stream_url;
    if (row.radio_subtitle) settings.radioSubtitle = row.radio_subtitle;
    settings.transferAlias = row.transfer_alias || "";
    settings.transferCbuCvu = row.transfer_cbu_cvu || "";
    settings.transferHolder = row.transfer_holder || "";
    settings.transferInstitution = row.transfer_institution || "";
    settings.transferInstructions = row.transfer_instructions || "";

    return settings;
  } catch (err) {
    console.warn("Excepción al consultar site_settings en Supabase:", err);
    return null;
  }
}

/**
 * Persiste o actualiza site_settings (id=1) en Supabase llamando a la API segura del servidor (Etapa 8).
 */
export async function upsertSupabaseSiteSettings(
  siteSettings: Partial<SiteSettings>
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "Supabase no está configurado en las variables de entorno." };
  }

  try {
    const response = await fetch("/api/admin/site-settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ siteSettings }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { success: false, error: data.error || data.message || "Error al conectar con la API de administración." };
    }

    const data = await response.json();
    return { success: Boolean(data.ok), error: data.error };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error al enviar configuración general a la nube.",
    };
  }
}
