import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import type { Product } from "@/lib/site-data";
import type { Database } from "@/lib/supabase/database.types";
import { mapAdminProductRow } from "@/lib/supabase/products";

export type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];
type ProductRow = Database["public"]["Tables"]["products"]["Row"];

function optionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
  const numberValue = optionalNumber(value);
  if (numberValue === null) return fallback;
  return Math.max(0, Math.trunc(numberValue));
}

async function requireAdminWriteAccess() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ ok: false, message: "No autorizado." }, { status: 401 });
  }

  if (!isServiceRoleConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Falta configurar la variable de entorno privada SUPABASE_SERVICE_ROLE_KEY en .env.local para administrar productos en Supabase.",
      },
      { status: 500 }
    );
  }

  return null;
}

export async function GET() {
  const accessError = await requireAdminWriteAccess();
  if (accessError) return accessError;

  try {
    const supabase = createAdminServerClient();
    const { data, error } = await supabase.from("products").select("*").order("sort_order", { ascending: true });

    if (error) {
      console.warn("Error al leer productos administrativos en Supabase:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data: (data as ProductRow[]).map(mapAdminProductRow) });
  } catch (err) {
    console.error("Excepción al leer productos administrativos:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error interno del servidor." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const accessError = await requireAdminWriteAccess();
  if (accessError) return accessError;

  try {
    const body = await request.json();
    const product = body.product as Product | undefined;

    if (!product || !product.id || !product.name) {
      return NextResponse.json({ ok: false, message: "Datos de producto no válidos." }, { status: 400 });
    }

    const slug = product.href
      ? product.href.replace(/^\/productos\//, "")
      : product.id.toLowerCase().replace(/[^a-z0-9_-]/g, "-");

    const productRow: ProductInsert = {
      id: product.id,
      name: product.name,
      slug: slug || product.id,
      description: product.description || "",
      price: Number(product.price) || 0,
      previous_price:
        product.previousPrice !== undefined && product.previousPrice !== null
          ? Number(product.previousPrice)
          : null,
      category: product.category || "General",
      image_url: product.image || "",
      cta_text: product.ctaText || "VER PRODUCTO",
      featured: Boolean(product.featured),
      active: Boolean(product.active),
      show_in_catalog: Boolean(product.showInCatalog),
      sort_order: Number(product.order) || 0,
      watts: product.watts !== undefined && product.watts !== null ? Number(product.watts) : null,
      lumens: product.lumens !== undefined && product.lumens !== null ? Number(product.lumens) : null,
      voltage: product.voltage || null,
      color_temperature: product.colorTemperature || null,
      connector_type: product.connectorType || null,
      canbus: product.canbus === undefined ? true : Boolean(product.canbus),
      chip_type: product.chipType || null,
      warranty: product.warranty || null,
      warranty_days: product.warrantyDays ?? null,
      cost_price: optionalNumber(product.costPrice),
      margin_percentage: optionalNumber(product.marginPercentage),
      stock_min: nonNegativeInteger(product.stockMin),
    };

    const supabase = createAdminServerClient();
    const { data, error } = await supabase
      .from("products")
      // El tipo manual de Supabase aún no declara Relationships; la librería
      // infiere `never` para escrituras aunque el payload sí coincide con Insert.
      .upsert(productRow as never, { onConflict: "id" })
      .select("*")
      .single();

    if (error) {
      console.warn("Error al persistir producto en Supabase:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("Excepción en API de productos admin:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error interno del servidor." },
      { status: 500 }
    );
  }
}
