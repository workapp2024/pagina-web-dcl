import "server-only";
import { createAdminServerClient } from "@/lib/supabase/server";

export type VisibilityViewer = { p_customer: string | null; p_actor: string | null };
export async function readWholesaleVisibility(viewer: VisibilityViewer) {
  const {data,error} = await createAdminServerClient().rpc("list_wholesale_order_visibility" as never,viewer as never) as unknown as {data: unknown;error: {code?:string} | null};
  if (error && ["PGRST202","42883"].includes(error.code ?? "")) return {available:false,ids:[] as string[]};
  if (error || !Array.isArray(data) || data.some(id=>typeof id !== "string" || !/^[\da-f-]{36}$/i.test(id))) throw new Error("Visibility unavailable");
  return {available:true,ids:data as string[]};
}
