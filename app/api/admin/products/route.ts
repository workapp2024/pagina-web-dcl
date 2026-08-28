import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import type { Product } from "@/lib/site-data";
import type { Database } from "@/lib/supabase/database.types";

export type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];

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
      sort_order: Number(product.order) || 0,
    };

    const supabase = createAdminServerClient();
    const { data, error } = await supabase
      .from("products")
      .upsert(productRow as any, { onConflict: "id" })
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
