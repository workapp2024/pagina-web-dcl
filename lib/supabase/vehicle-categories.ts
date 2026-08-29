import { createBrowserClient } from "./client";
import { createServerClient } from "./server";
import { isSupabaseConfigured } from "./test-connection";
import { sanitizeStoredImageUrl } from "./storage";
import type { VehicleCategory } from "@/lib/site-data";
import type { Database } from "./database.types";

export type VehicleCategoryRow = Database["public"]["Tables"]["vehicle_categories"]["Row"];

/**
 * Capa de lectura de categorías de vehículos desde Supabase (Etapa 7).
 */
export async function getSupabaseVehicleCategories(): Promise<VehicleCategory[] | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const client = typeof window === "undefined" ? createServerClient() : createBrowserClient();
    const { data, error } = await client
      .from("vehicle_categories")
      .select("*")
      .order("sort_order", { ascending: true });

    if (error) {
      console.warn("Lectura de categorías de vehículos en Supabase no completada:", error.message);
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    const rows = data as unknown as VehicleCategoryRow[];

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      image: sanitizeStoredImageUrl(row.image_url),
      href: row.href || "/vehiculos",
      active: row.active,
      order: row.sort_order,
    }));
  } catch (err) {
    console.warn("Excepción al consultar categorías de vehículos en Supabase:", err);
    return null;
  }
}

/**
 * Persiste o actualiza una categoría de vehículo en Supabase llamando a la API segura del servidor (Etapa 7).
 */
export async function upsertSupabaseVehicleCategory(
  vehicleCategory: VehicleCategory
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "Supabase no está configurado en las variables de entorno." };
  }

  try {
    const response = await fetch("/api/admin/vehicle-categories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ vehicleCategory }),
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
      error: err instanceof Error ? err.message : "Error al enviar datos de la categoría de vehículo a la nube.",
    };
  }
}
