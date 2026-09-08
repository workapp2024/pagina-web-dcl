import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { isServiceRoleConfigured } from "@/lib/supabase/server";
import { createPremiumServerClient } from "@/lib/supabase/premium-client";
import { readJsonObject } from "@/lib/api";
import { isPremiumTableUnavailable, validatePremiumSelection, type PremiumOption } from "@/lib/premium";
import { sanitizeStoredImageUrl } from "@/lib/supabase/storage";

async function access() {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ ok: false, message: "No autorizado." }, { status: 401 });
  if (!isServiceRoleConfigured()) return NextResponse.json({ ok: false, message: "El servicio administrativo no está configurado." }, { status: 503 });
  return null;
}

const unavailable = () => NextResponse.json({ ok: false, message: "Premium no está disponible. Verificá que la migración de Premium esté aplicada." }, { status: 503 });

function failure(error?: { code?: string; message?: string }) {
  if (error && isPremiumTableUnavailable(error)) return unavailable();
  console.error("premium_admin_failed", { code: error?.code ?? "unexpected" });
  return NextResponse.json({ ok: false, message: "No se pudo consultar o guardar Premium. Reintentá; si continúa, revisá el servicio." }, { status: 503 });
}

async function catalogOptions(db: ReturnType<typeof createPremiumServerClient>) {
  const products: PremiumOption[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from("products").select("id,name,image_url,price,active,show_in_catalog")
      .order("sort_order").order("id").range(offset, offset + pageSize - 1);
    if (error) return { products, error };
    products.push(...(data ?? []).map(product => ({ id: product.id, name: product.name, image: sanitizeStoredImageUrl(product.image_url), price: Number(product.price), active: product.active, showInCatalog: product.show_in_catalog })));
    if (!data || data.length < pageSize) return { products, error: null };
  }
}

export async function GET() {
  const denied = await access(); if (denied) return denied;
  try {
    const db = createPremiumServerClient("admin");
    const [selection, products] = await Promise.all([
      db.from("premium_settings").select("product_ids,revision").eq("id", 1).maybeSingle(),
      catalogOptions(db),
    ]);
    if (selection.error) return failure(selection.error);
    if (!selection.data || products.error) return failure(products.error ?? undefined);
    return NextResponse.json({ ok: true, selection: { productIds: selection.data.product_ids, revision: selection.data.revision },
      products: products.products }, { headers: { "Cache-Control": "no-store" } });
  } catch { return failure(); }
}

export async function PATCH(request: Request) {
  const denied = await access(); if (denied) return denied;
  let selection;
  try { selection = validatePremiumSelection(await readJsonObject(request)); }
  catch (error) { return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Selección no válida." }, { status: 400 }); }
  try {
    const db = createPremiumServerClient("admin");
    if (selection.productIds.length) {
      const { data, error } = await db.from("products").select("id").in("id", selection.productIds);
      if (error) return failure(error);
      if (data?.length !== selection.productIds.length) return NextResponse.json({ ok: false, message: "Un producto fue eliminado. Recargá y quitá el producto no disponible antes de guardar." }, { status: 400 });
    }
    const { data, error } = await db.from("premium_settings")
      .update({ product_ids: selection.productIds, revision: selection.revision + 1 })
      .eq("id", 1).eq("revision", selection.revision).select("product_ids,revision").maybeSingle();
    if (error) return failure(error);
    if (!data) return NextResponse.json({ ok: false, message: "La selección cambió o no existe. Recargá antes de guardar." }, { status: 409 });
    return NextResponse.json({ ok: true, selection: { productIds: data.product_ids, revision: data.revision } });
  } catch { return failure(); }
}
