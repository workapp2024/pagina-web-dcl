import { NextResponse } from "next/server";
import { scheduleAnalyticsFlush } from "@/lib/store/analytics-outbox";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { analyticsDates } from "@/lib/analytics-dates";
import { detailKinds, getAnalyticsDetail, type DetailKind } from "@/lib/posthog-admin";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ status: "error", message: "No autorizado." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  if (!kind || !detailKinds.includes(kind as DetailKind)) return NextResponse.json({ status: "error", message: "Detalle inválido." }, { status: 400 });
  let range;
  try {
    range = analyticsDates(params.get("period") || "30d", params.get("from") || undefined, params.get("to") || undefined);
  } catch {
    return NextResponse.json({ status: "error", message: "Rango de fechas inválido." }, { status: 400 });
  }
  scheduleAnalyticsFlush();
  const result = await getAnalyticsDetail(kind as DetailKind, range.from, range.to);
  if (result.status !== "ok" || !["products", "cart", "checkout", "whatsapp"].includes(kind)) return NextResponse.json(result);
  const detailRows = [...result.data.rows, ...(result.data.secondary?.rows ?? [])];
  const ids = [...new Set(detailRows.map(row => row.productId).filter((id): id is string => Boolean(id)))];
  if (!ids.length) return NextResponse.json(result);
  if (!isServiceRoleConfigured()) return NextResponse.json({ status: "error", message: "Catálogo no configurado." }, { status: 503 });
  try {
    const { data, error } = await createAdminServerClient().from("products").select("id,name").in("id", ids);
    if (error) throw new Error("Catálogo no disponible.");
    const names = new Map(((data ?? []) as { id: string; name: string }[]).map(product => [product.id, product.name]));
    const resolve = (row: typeof detailRows[number]) => !row.productId ? row : { ...row, label: `${kind === "whatsapp" ? "product · " : ""}${names.get(row.productId) || "Producto no disponible"}` };
    return NextResponse.json({ status: "ok", data: { ...result.data, rows: result.data.rows.map(resolve), ...(result.data.secondary ? { secondary: { ...result.data.secondary, rows: result.data.secondary.rows.map(resolve) } } : {}) } });
  } catch {
    return NextResponse.json({ status: "error", message: "No se pudo consultar el catálogo." }, { status: 500 });
  }
}
