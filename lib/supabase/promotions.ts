import { createBrowserClient } from "./client";
import { createServerClient } from "./server";
import { isSupabaseConfigured } from "./test-connection";
import { sanitizeStoredImageUrl } from "./storage";
import type { Promotion } from "@/lib/site-data";
import type { Database } from "./database.types";

export type PromotionRow = Database["public"]["Tables"]["promotions"]["Row"];

/**
 * Capa de lectura de promociones desde Supabase (Etapa 7).
 */
export async function getSupabasePromotions(): Promise<Promotion[] | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const client = typeof window === "undefined" ? createServerClient() : createBrowserClient();
    const { data, error } = await client
      .from("promotions")
      .select("*")
      .order("sort_order", { ascending: true });

    if (error) {
      console.warn("Lectura de promociones en Supabase no completada:", error.message);
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    const rows = data as unknown as PromotionRow[];

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      image: sanitizeStoredImageUrl(row.image_url),
      price: row.price ?? undefined,
      ctaText: row.cta_text || "APROVECHAR PROMO",
      ctaHref: row.cta_href || "#contacto",
      startDate: row.start_date ?? undefined,
      endDate: row.end_date ?? undefined,
      active: row.active,
      order: row.sort_order,
    }));
  } catch (err) {
    console.warn("Excepción al consultar promociones en Supabase:", err);
    return null;
  }
}

/**
 * Persiste o actualiza una promoción en Supabase llamando a la API segura del servidor (Etapa 7).
 */
export async function upsertSupabasePromotion(promotion: Promotion): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "Supabase no está configurado en las variables de entorno." };
  }

  try {
    const response = await fetch("/api/admin/promotions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ promotion }),
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
      error: err instanceof Error ? err.message : "Error al enviar datos de la promoción a la nube.",
    };
  }
}
