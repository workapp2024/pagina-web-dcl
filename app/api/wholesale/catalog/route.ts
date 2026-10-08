import { NextResponse } from "next/server";
import { isWholesaleSessionValid, loadWholesaleCatalog } from "@/lib/wholesale-server";

export async function GET() {
  if (!(await isWholesaleSessionValid())) {
    return NextResponse.json({ ok: false, error: "Acceso mayorista requerido." }, { status: 401, headers: { "Cache-Control": "no-store, private" } });
  }
  try {
    const data = await loadWholesaleCatalog();
    return NextResponse.json({ ok: true, data }, { headers: { "Cache-Control": "no-store, private" } });
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo cargar el catálogo. Intentá nuevamente." }, { status: 503, headers: { "Cache-Control": "no-store, private" } });
  }
}
