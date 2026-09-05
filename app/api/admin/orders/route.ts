import { NextResponse } from "next/server";
import { apiError, apiInternalError, boundedString, isUuid, readJsonObject } from "@/lib/api";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";

async function guard(){if(!(await isAdminAuthenticated()))return NextResponse.json({ok:false,error:"No autorizado."},{status:401});if(!isServiceRoleConfigured())return NextResponse.json({ok:false,error:"Falta SUPABASE_SERVICE_ROLE_KEY."},{status:500});return null}
function periodStart(period: string) {
  if (period === "all") return null;
  const now = new Date();
  // Business day in Argentina, independent of the server's timezone.
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  if (period === "today") return new Date(day + "T00:00:00-03:00").toISOString();
  now.setUTCDate(now.getUTCDate() - (period === "week" ? 7 : 30));
  return now.toISOString();
}

export async function GET(request: Request) {
  const blocked = await guard(); if (blocked) return blocked;
  try {
    const params = new URL(request.url).searchParams;
    const page = Number(params.get("page") || 1), limit = Number(params.get("limit") || 50);
    const status = params.get("status") || "all", period = params.get("period") || "month";
    const q = boundedString(params.get("q"), 80);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isInteger(limit) || limit < 1 || limit > 100 ||
      !["all", "attention", "pending", "transfer", "paid", "delivery", "completed", "cancelled"].includes(status) ||
      !["all", "today", "week", "month"].includes(period) || q === null) return apiError("BAD_REQUEST", "Filtros invalidos.", 400);
    const db = createAdminServerClient();
    const result = await db.rpc("list_admin_orders" as never, { p_q: q, p_status: status, p_since: periodStart(period), p_page: page, p_limit: limit } as never) as unknown as { data: { data: unknown[]; pagination: { total: number; page: number; limit: number } } | null; error: { message: string } | null };
    if (result.error || !result.data) throw new Error(result.error?.message || "No se pudieron consultar los pedidos.");
    return NextResponse.json({ ok: true, ...result.data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiInternalError("admin_orders_list", error); }
}

export async function POST(request:Request){const blocked=await guard();if(blocked)return blocked;const body=await readJsonObject(request);if(!body)return apiError("BAD_REQUEST","Solicitud inválida.",400);if(!isUuid(body.orderId))return apiError("BAD_REQUEST","El pedido seleccionado no es válido.",400);try{const db=createAdminServerClient();if(body.action==="confirm_transfer"){const result=await db.rpc("complete_manual_transfer",{p_order:body.orderId}as never)as unknown as{data:string|null;error:{message:string}|null};if(result.error)throw new Error(result.error.message);if(!result.data)return apiError("BAD_REQUEST","La reserva venció o el stock ya no está disponible.",409);return NextResponse.json({ok:true,saleId:result.data})}if(body.action==="cancel_order"){const result=await db.rpc("cancel_public_order" as never,{p_order:body.orderId}as never)as unknown as{data:boolean|null;error:{message:string}|null};if(result.error)throw new Error(result.error.message);if(!result.data)return apiError("BAD_REQUEST","El pedido ya no puede cancelarse.",409);return NextResponse.json({ok:true})}if(body.action==="add_note"){const note=boundedString(body.note,1000,{required:true});if(!note)return apiError("BAD_REQUEST","Escribí una nota.",400);const{error}=await db.from("order_notes").insert({order_id:body.orderId,note}as never);if(error)throw new Error(error.message);return NextResponse.json({ok:true})}return apiError("BAD_REQUEST","La acción solicitada no existe.",400)}catch(error){return apiInternalError("admin_order_action",error)}}
