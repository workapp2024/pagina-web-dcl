import { createBrowserClient } from "./client";
import { createServerClient } from "./server";
import { isSupabaseConfigured } from "./test-connection";
import type { SiteSettings } from "@/lib/site-data";
import type { Database } from "./database.types";

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
    if (row.logo_url) settings.logo = row.logo_url;
    if (row.whatsapp) settings.whatsapp = row.whatsapp;
    if (row.instagram) settings.instagram = row.instagram;
    if (row.facebook) settings.facebook = row.facebook;
    if (row.email) settings.email = row.email;
    if (row.phone) settings.phone = row.phone;
    if (row.address) settings.address = row.address;
    if (row.vehicle_section_title) settings.vehicleSectionTitle = row.vehicle_section_title;
    if (row.needs_section_title) settings.needsSectionTitle = row.needs_section_title;
    if (row.why_us_section_title) settings.whyUsSectionTitle = row.why_us_section_title;
    if (row.products_section_title) settings.productsSectionTitle = row.products_section_title;
    if (row.promotions_section_title) settings.promotionsSectionTitle = row.promotions_section_title;

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
