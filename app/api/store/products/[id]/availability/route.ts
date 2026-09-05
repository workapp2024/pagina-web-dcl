import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminServerClient } from "@/lib/supabase/server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(request, "product-availability", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const { id } = await params;
  const quantity = Number(new URL(request.url).searchParams.get("quantity"));
  if (!id || id.length > 64 || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) return NextResponse.json({ ok: false, reason: "invalid_quantity" }, { status: 400 });
  try {
  const db = createAdminServerClient();
  const { data, error } = await db.from("products").select("active,stock").eq("id", id).maybeSingle() as unknown as { data: { active: boolean; stock: number } | null; error: { message: string } | null };
  if (error) return NextResponse.json({ ok: false, available: false, reason: "unavailable" }, { status: 503 });
  if (!data) return NextResponse.json({ ok: true, available: false, reason: "not_found" });
  if (!data.active) return NextResponse.json({ ok: true, available: false, reason: "inactive" });
  const availableResult = await db.rpc("get_available_product_stock" as never, { p_product_id: id } as never) as unknown as { data: number | null; error: { message: string } | null };
  if (availableResult.error || !Number.isInteger(availableResult.data) || Number(availableResult.data) < 0) {
    return NextResponse.json({ ok: false, available: false, reason: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const availableStock = Number(availableResult.data);
  return NextResponse.json({ ok: true, available: availableStock >= quantity, stockLevel: availableStock < 1 ? "out" : availableStock <= 3 ? "low" : "available", reason: availableStock >= quantity ? null : "out_of_stock" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, available: false, reason: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
