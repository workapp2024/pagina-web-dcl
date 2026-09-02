/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import type { CompatibilityFormPayload } from "@/lib/supabase/vehicle-compatibility";
import { boundedString, readJsonObject } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";

type BrandRow = Database["public"]["Tables"]["vehicle_brands"]["Row"];
type ModelRow = Database["public"]["Tables"]["vehicle_models"]["Row"];
type BrandInsert = Database["public"]["Tables"]["vehicle_brands"]["Insert"];
type ModelInsert = Database["public"]["Tables"]["vehicle_models"]["Insert"];
type CompatibilityInsert = Database["public"]["Tables"]["vehicle_compatibilities"]["Insert"];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function POST(request: Request) {
  const limited = rateLimit(request, "admin-vehicle-compatibility", { limit: 30, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;
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
    const raw = await readJsonObject(request);
    if (!raw) return NextResponse.json({ ok: false, message: "Solicitud inválida." }, { status: 400 });
    const payload = raw as CompatibilityFormPayload;

    const brandName = boundedString(payload.brandName, 100, { required: true }) || "";
    const modelName = boundedString(payload.modelName, 100, { required: true }) || "";
    const vehicleType = boundedString(payload.vehicleType || "Auto", 50, { required: true }) || "Auto";
    const yearFrom = Number(payload.yearFrom);
    const yearTo = payload.yearTo == null ? null : Number(payload.yearTo);
    const combinedHighLow = Boolean(payload.combinedHighLow);
    const connectorLow = boundedString(payload.connectorLow, 50) || null;

    if (!brandName || !modelName || !Number.isInteger(yearFrom) || yearFrom < 1886 || yearFrom > 2200 || (yearTo !== null && (!Number.isInteger(yearTo) || yearTo < yearFrom || yearTo > 2200)) || (combinedHighLow && !connectorLow)) {
      return NextResponse.json(
        { ok: false, message: "Marca, modelo y año desde son obligatorios; revisá el conector combinado." },
        { status: 400 }
      );
    }

    const supabase = createAdminServerClient();

    // 1. Obtener o crear la marca (por nombre, sin distinguir mayúsculas).
    const { data: existingBrandRaw } = await supabase
      .from("vehicle_brands")
      .select("*")
      .ilike("name", brandName)
      .maybeSingle();
    const existingBrand = existingBrandRaw as unknown as BrandRow | null;

    let brandId = existingBrand?.id;
    if (!brandId) {
      const brandRow: BrandInsert = { id: slugify(brandName) || `marca-${Date.now()}`, name: brandName };
      const { data: newBrandRaw, error: brandError } = await supabase
        .from("vehicle_brands")
        .upsert(brandRow as any, { onConflict: "id" })
        .select("*")
        .single();
      const newBrand = newBrandRaw as unknown as BrandRow | null;
      if (brandError || !newBrand) {
        return NextResponse.json({ ok: false, error: brandError?.message || "No se pudo crear la marca." }, { status: 500 });
      }
      brandId = newBrand.id;
    }

    // 2. Obtener o crear el modelo (por marca + nombre).
    const { data: existingModelRaw } = await supabase
      .from("vehicle_models")
      .select("*")
      .eq("brand_id", brandId)
      .ilike("name", modelName)
      .maybeSingle();
    const existingModel = existingModelRaw as unknown as ModelRow | null;

    let modelId = existingModel?.id;
    if (!modelId) {
      const modelRow: ModelInsert = {
        id: `${slugify(brandName)}-${slugify(modelName)}` || `modelo-${Date.now()}`,
        brand_id: brandId,
        name: modelName,
        vehicle_type: vehicleType,
      };
      const { data: newModelRaw, error: modelError } = await supabase
        .from("vehicle_models")
        .upsert(modelRow as any, { onConflict: "id" })
        .select("*")
        .single();
      const newModel = newModelRaw as unknown as ModelRow | null;
      if (modelError || !newModel) {
        return NextResponse.json({ ok: false, error: modelError?.message || "No se pudo crear el modelo." }, { status: 500 });
      }
      modelId = newModel.id;
    } else if (existingModel?.vehicle_type !== vehicleType) {
      // Mantiene el tipo de vehículo actualizado si el admin lo corrigió.
      await (supabase.from("vehicle_models") as any).update({ vehicle_type: vehicleType }).eq("id", modelId);
    }

    if (!brandId || !modelId) {
      return NextResponse.json({ ok: false, message: "No se pudo resolver la marca o el modelo." }, { status: 500 });
    }

    // 3. Crear o actualizar la fila de compatibilidad (año + conectores).
    const compatibilityRow: CompatibilityInsert = {
      id: payload.id || `compat-${Date.now()}`,
      model_id: modelId,
      year_from: yearFrom,
      year_to: yearTo,
      version: boundedString(payload.version, 100) || null,
      connector_low: connectorLow,
      connector_high: combinedHighLow ? null : boundedString(payload.connectorHigh, 50) || null,
      connector_fog: boundedString(payload.connectorFog, 50) || null,
      connector_aux: boundedString(payload.connectorAux, 50) || null,
      combined_high_low: combinedHighLow,
      notes: boundedString(payload.notes, 1000) || "",
      active: payload.active === undefined ? true : Boolean(payload.active),
    };

    const { data, error } = await supabase
      .from("vehicle_compatibilities")
      .upsert(compatibilityRow as any, { onConflict: "id" })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("Excepción en API de compatibilidades admin:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error interno del servidor." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ ok: false, message: "No autorizado." }, { status: 401 });
  }

  if (!isServiceRoleConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY en .env.local." },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, message: "Falta el id de la compatibilidad a eliminar." }, { status: 400 });
  }

  try {
    const supabase = createAdminServerClient();
    const { error } = await supabase.from("vehicle_compatibilities").delete().eq("id", id);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error interno del servidor." },
      { status: 500 }
    );
  }
}
