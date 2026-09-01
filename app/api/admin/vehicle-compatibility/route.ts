import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import type { CompatibilityFormPayload } from "@/lib/supabase/vehicle-compatibility";

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
    const payload = (await request.json()) as CompatibilityFormPayload;

    const brandName = (payload.brandName || "").trim();
    const modelName = (payload.modelName || "").trim();
    const vehicleType = (payload.vehicleType || "Auto").trim();
    const yearFrom = Number(payload.yearFrom);

    if (!brandName || !modelName || !Number.isFinite(yearFrom)) {
      return NextResponse.json(
        { ok: false, message: "Marca, modelo y año desde son obligatorios." },
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
      year_to: payload.yearTo ?? null,
      version: payload.version || null,
      connector_low: payload.connectorLow || null,
      connector_high: payload.connectorHigh || null,
      connector_fog: payload.connectorFog || null,
      connector_aux: payload.connectorAux || null,
      notes: payload.notes || "",
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
