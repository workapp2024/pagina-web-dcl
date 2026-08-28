import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import type { VehicleCategory } from "@/lib/site-data";
import type { Database } from "@/lib/supabase/database.types";

export type VehicleCategoryInsert = Database["public"]["Tables"]["vehicle_categories"]["Insert"];

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
    const vehicleCategory = body.vehicleCategory as VehicleCategory | undefined;

    if (!vehicleCategory || !vehicleCategory.id || !vehicleCategory.title) {
      return NextResponse.json({ ok: false, message: "Datos de categoría de vehículo no válidos." }, { status: 400 });
    }

    const categoryRow: VehicleCategoryInsert = {
      id: vehicleCategory.id,
      title: vehicleCategory.title,
      description: vehicleCategory.description || "",
      image_url: vehicleCategory.image || "",
      href: vehicleCategory.href || "/vehiculos",
      active: Boolean(vehicleCategory.active),
      sort_order: Number((vehicleCategory as any).order) || 0,
    };

    const supabase = createAdminServerClient();
    const { data, error } = await supabase
      .from("vehicle_categories")
      .upsert(categoryRow as any, { onConflict: "id" })
      .select("*")
      .single();

    if (error) {
      console.warn("Error al persistir categoría de vehículo en Supabase:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("Excepción en API de categorías de vehículos admin:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error interno del servidor." },
      { status: 500 }
    );
  }
}
