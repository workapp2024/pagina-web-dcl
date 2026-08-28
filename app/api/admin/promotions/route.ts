import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import type { Promotion } from "@/lib/site-data";
import type { Database } from "@/lib/supabase/database.types";

export type PromotionInsert = Database["public"]["Tables"]["promotions"]["Insert"];

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
    const promotion = body.promotion as Promotion | undefined;

    if (!promotion || !promotion.id || !promotion.title) {
      return NextResponse.json({ ok: false, message: "Datos de promoción no válidos." }, { status: 400 });
    }

    const promotionRow: PromotionInsert = {
      id: promotion.id,
      title: promotion.title,
      description: promotion.description || "",
      image_url: promotion.image || "",
      price: promotion.price || null,
      cta_text: promotion.ctaText || "APROVECHAR PROMO",
      cta_href: promotion.ctaHref || "#contacto",
      start_date: promotion.startDate || null,
      end_date: promotion.endDate || null,
      active: Boolean(promotion.active),
      sort_order: Number(promotion.order) || 0,
    };

    const supabase = createAdminServerClient();
    const { data, error } = await supabase
      .from("promotions")
      .upsert(promotionRow as any, { onConflict: "id" })
      .select("*")
      .single();

    if (error) {
      console.warn("Error al persistir promoción en Supabase:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("Excepción en API de promociones admin:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error interno del servidor." },
      { status: 500 }
    );
  }
}
