import { createBrowserClient } from "./client";
import { createServerClient } from "./server";
import { isSupabaseConfigured } from "./test-connection";
import type { Database } from "./database.types";

export type VehicleBrandRow = Database["public"]["Tables"]["vehicle_brands"]["Row"];
export type VehicleModelRow = Database["public"]["Tables"]["vehicle_models"]["Row"];
export type VehicleCompatibilityRow = Database["public"]["Tables"]["vehicle_compatibilities"]["Row"];

export type VehicleBrand = { id: string; name: string };
export type VehicleModel = { id: string; brandId: string; name: string; vehicleType: string };
export type VehicleCompatibility = {
  id: string;
  modelId: string;
  active: boolean;
  yearFrom: number;
  yearTo: number | null;
  version: string | null;
  connectorLow: string | null;
  connectorHigh: string | null;
  connectorFog: string | null;
  connectorAux: string | null;
  combinedHighLow: boolean;
  notes: string;
};

/** Registro combinado usado por el listado del panel administrativo. */
export type VehicleCompatibilityFull = VehicleCompatibility & {
  brandName: string;
  modelName: string;
  vehicleType: string;
};

const VEHICLE_TYPES = ["Auto", "Camioneta", "Moto", "Camión"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];
export { VEHICLE_TYPES };

/**
 * Tipos de vehículo disponibles a partir de los modelos activos cargados.
 * Devuelve null si Supabase no está configurado o la tabla todavía no existe
 * (por ejemplo, si la migración 20260830_vehicle_compatibility.sql no fue aplicada).
 */
export async function getPublicVehicleTypes(): Promise<VehicleType[] | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const client = typeof window === "undefined" ? createServerClient() : createBrowserClient();
    const { data, error } = await client
      .from("vehicle_models")
      .select("vehicle_type")
      .eq("active", true);

    if (error || !data) return null;

    const rows = data as unknown as { vehicle_type: string }[];
    const unique = Array.from(new Set(rows.map((row) => row.vehicle_type))).filter(Boolean);
    return unique.length > 0 ? (unique as VehicleType[]) : null;
  } catch {
    return null;
  }
}

export async function getPublicVehicleBrands(vehicleType?: string): Promise<VehicleBrand[] | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const client = typeof window === "undefined" ? createServerClient() : createBrowserClient();

    if (vehicleType) {
      const { data: modelRows, error: modelsError } = await client
        .from("vehicle_models")
        .select("brand_id")
        .eq("active", true)
        .eq("vehicle_type", vehicleType);

      if (modelsError || !modelRows) return null;
      const rows = modelRows as unknown as { brand_id: string }[];
      const brandIds = Array.from(new Set(rows.map((row) => row.brand_id)));
      if (brandIds.length === 0) return [];

      const { data: brandRows, error: brandsError } = await client
        .from("vehicle_brands")
        .select("*")
        .eq("active", true)
        .in("id", brandIds)
        .order("name");

      if (brandsError || !brandRows) return null;
      return (brandRows as VehicleBrandRow[]).map((row) => ({ id: row.id, name: row.name }));
    }

    const { data, error } = await client.from("vehicle_brands").select("*").eq("active", true).order("name");
    if (error || !data) return null;
    return (data as VehicleBrandRow[]).map((row) => ({ id: row.id, name: row.name }));
  } catch {
    return null;
  }
}

export async function getPublicVehicleModels(brandId: string, vehicleType?: string): Promise<VehicleModel[] | null> {
  if (!isSupabaseConfigured() || !brandId) return null;
  try {
    const client = typeof window === "undefined" ? createServerClient() : createBrowserClient();
    let query = client.from("vehicle_models").select("*").eq("active", true).eq("brand_id", brandId);
    if (vehicleType) query = query.eq("vehicle_type", vehicleType);
    const { data, error } = await query.order("name");
    if (error || !data) return null;
    return (data as VehicleModelRow[]).map((row) => ({
      id: row.id,
      brandId: row.brand_id,
      name: row.name,
      vehicleType: row.vehicle_type,
    }));
  } catch {
    return null;
  }
}

export async function getPublicVehicleCompatibilitiesByModel(modelId: string): Promise<VehicleCompatibility[] | null> {
  if (!isSupabaseConfigured() || !modelId) return null;
  try {
    const client = typeof window === "undefined" ? createServerClient() : createBrowserClient();
    const { data, error } = await client
      .from("vehicle_compatibilities")
      .select("*")
      .eq("active", true)
      .eq("model_id", modelId)
      .order("year_from", { ascending: false });

    if (error || !data) return null;
    return (data as VehicleCompatibilityRow[]).map(mapCompatibilityRow);
  } catch {
    return null;
  }
}

export async function searchPublicVehicleCompatibilities(vehicleType: string, brandId?: string, modelId?: string): Promise<VehicleCompatibilityFull[] | null> {
  if (!isSupabaseConfigured() || !vehicleType) return [];
  try {
    const client = typeof window === "undefined" ? createServerClient() : createBrowserClient();
    let modelsQuery = client.from("vehicle_models").select("*").eq("active", true).eq("vehicle_type", vehicleType);
    if (brandId) modelsQuery = modelsQuery.eq("brand_id", brandId);
    if (modelId) modelsQuery = modelsQuery.eq("id", modelId);
    const { data: modelRows, error: modelsError } = await modelsQuery;
    if (modelsError || !modelRows) return null;
    const models = modelRows as VehicleModelRow[];
    if (!models.length) return [];
    const { data: compatibilityRows, error: compatibilityError } = await client.from("vehicle_compatibilities").select("*").eq("active", true).in("model_id", models.map(row => row.id)).order("year_from", { ascending: true, nullsFirst: true });
    if (compatibilityError || !compatibilityRows) return null;
    const brandIds = Array.from(new Set(models.map(row => row.brand_id)));
    const { data: brandRows, error: brandsError } = await client.from("vehicle_brands").select("*").in("id", brandIds);
    if (brandsError || !brandRows) return null;
    const modelsById = new Map(models.map(row => [row.id, row]));
    const brandsById = new Map((brandRows as VehicleBrandRow[]).map(row => [row.id, row]));
    return (compatibilityRows as VehicleCompatibilityRow[]).map(row => { const model = modelsById.get(row.model_id)!; return { ...mapCompatibilityRow(row), modelName: model.name, brandName: brandsById.get(model.brand_id)?.name || "", vehicleType: model.vehicle_type }; });
  } catch { return null; }
}

function mapCompatibilityRow(row: VehicleCompatibilityRow): VehicleCompatibility {
  return {
    id: row.id,
    modelId: row.model_id,
    active: row.active,
    yearFrom: row.year_from,
    yearTo: row.year_to,
    version: row.version,
    connectorLow: row.connector_low,
    connectorHigh: row.connector_high,
    connectorFog: row.connector_fog,
    connectorAux: row.connector_aux,
    combinedHighLow: row.combined_high_low,
    notes: row.notes,
  };
}

/** Lista completa (marca + modelo + compatibilidad) para el panel administrativo. */
export async function getAdminVehicleCompatibilities(): Promise<VehicleCompatibilityFull[] | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const client = typeof window === "undefined" ? createServerClient() : createBrowserClient();

    const { data: compatRows, error: compatError } = await client
      .from("vehicle_compatibilities")
      .select("*")
      .order("created_at", { ascending: false });
    if (compatError || !compatRows) return null;

    const { data: modelRows, error: modelsError } = await client.from("vehicle_models").select("*");
    if (modelsError || !modelRows) return null;

    const { data: brandRows, error: brandsError } = await client.from("vehicle_brands").select("*");
    if (brandsError || !brandRows) return null;

    const modelsById = new Map((modelRows as VehicleModelRow[]).map((row) => [row.id, row]));
    const brandsById = new Map((brandRows as VehicleBrandRow[]).map((row) => [row.id, row]));

    return (compatRows as VehicleCompatibilityRow[]).map((row) => {
      const model = modelsById.get(row.model_id);
      const brand = model ? brandsById.get(model.brand_id) : undefined;
      return {
        ...mapCompatibilityRow(row),
        brandName: brand?.name || "",
        modelName: model?.name || "",
        vehicleType: model?.vehicle_type || "",
      };
    });
  } catch {
    return null;
  }
}

export type CompatibilityFormPayload = {
  id?: string;
  active?: boolean;
  vehicleType: string;
  brandName: string;
  modelName: string;
  yearFrom: number;
  yearTo?: number | null;
  version?: string;
  connectorLow?: string;
  connectorHigh?: string;
  connectorFog?: string;
  connectorAux?: string;
  combinedHighLow?: boolean;
  notes?: string;
};

export async function upsertAdminVehicleCompatibility(
  payload: CompatibilityFormPayload
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch("/api/admin/vehicle-compatibility", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      return { success: false, error: data.error || data.message || "Error al guardar en Supabase." };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error al guardar la compatibilidad." };
  }
}

export async function deleteAdminVehicleCompatibility(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`/api/admin/vehicle-compatibility?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      return { success: false, error: data.error || data.message || "Error al eliminar en Supabase." };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error al eliminar la compatibilidad." };
  }
}
