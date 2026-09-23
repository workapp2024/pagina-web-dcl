import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { analyticsDates } from "@/lib/analytics-dates";
import { getCommercialFunnel } from "@/lib/posthog-funnel";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!(await isAdminAuthenticated())) return NextResponse.json({ status: "error", message: "No autorizado." }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  let range;
  try {
    range = analyticsDates(params.get("period") || "30d", params.get("from") || undefined, params.get("to") || undefined);
  } catch {
    return NextResponse.json({ status: "error", message: "Rango de fechas inválido." }, { status: 400, headers });
  }
  const result = await getCommercialFunnel(range.from, range.to);
  return NextResponse.json(result, { status: result.status === "error" ? 502 : 200, headers });
}
