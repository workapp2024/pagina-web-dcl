import { createBrowserClient } from "./client";
import { createServerClient } from "./server";
import { isSupabaseConfigured } from "./test-connection";
import type { SiteSettings } from "@/lib/site-data";
import type { Database } from "./database.types";

export type HomeSettingsRow = Database["public"]["Tables"]["home_settings"]["Row"];

/**
 * Capa de lectura de home_settings (id=1) desde Supabase (Etapa 8).
 */
export async function getSupabaseHomeSettings(): Promise<Partial<SiteSettings> | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const client = typeof window === "undefined" ? createServerClient() : createBrowserClient();
    const { data, error } = await client
      .from("home_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      console.warn("Lectura de home_settings en Supabase no completada:", error.message);
      return null;
    }

    if (!data) {
      return null;
    }

    const row = data as unknown as HomeSettingsRow;

    const settings: Partial<SiteSettings> = {};
    if (row.hero_title) settings.heroTitle = row.hero_title;
    if (row.hero_subtitle) settings.heroSubtitle = row.hero_subtitle;
    if (row.hero_primary_cta) settings.heroPrimaryCta = row.hero_primary_cta;
    if (row.hero_secondary_cta) settings.heroSecondaryCta = row.hero_secondary_cta;
    if (row.hero_image_url) settings.heroImage = row.hero_image_url;

    return settings;
  } catch (err) {
    console.warn("Excepción al consultar home_settings en Supabase:", err);
    return null;
  }
}

/**
 * Persiste o actualiza home_settings (id=1) en Supabase llamando a la API segura del servidor (Etapa 8).
 */
export async function upsertSupabaseHomeSettings(
  homeSettings: Partial<SiteSettings>
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "Supabase no está configurado en las variables de entorno." };
  }

  try {
    const response = await fetch("/api/admin/home-settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ homeSettings }),
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
      error: err instanceof Error ? err.message : "Error al enviar configuración de Home a la nube.",
    };
  }
}
