import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createAdminServerClient } from "@/lib/supabase/server";
import { readHomePresentation } from "@/lib/home-presentation";

export async function GET() {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    const { data, error } = await createAdminServerClient().from("site_settings")
      .select("faq_enabled,faq_items,home_payment_enabled,home_payment_title,home_payment_image").eq("id", 1).maybeSingle();
    if (error || !data) return NextResponse.json({ ok: false, error: "Esta configuración necesita la actualización de base preparada. Todavía no podés guardar cambios." }, { status: 503 });
    return NextResponse.json({ ok: true, settings: readHomePresentation(data as unknown as Record<string, unknown>) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ ok: false, error: "No se pudo cargar la configuración. Volvé a intentar." }, { status: 503 }); }
}
