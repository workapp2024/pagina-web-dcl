import { NextResponse } from "next/server";
import { getAdminIdentity } from "@/lib/admin-auth";
import { apiError, isUuid } from "@/lib/api";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
type RevisionRow={id:string;version_number:number;status:string;commercial_conditions:string;total_amount:number|string;currency:string;created_at:string};
type ItemRow={product_id:string;product_name_snapshot:string;category_snapshot:string|null;connector_type_snapshot:string|null;quantity:number;unit_price:number|string;line_total:number|string;currency:string};

export async function GET(_request:Request,context:{params:Promise<{id:string}>}) {
  if ((await getAdminIdentity())?.role !== "ADMIN") return apiError("FORBIDDEN","No autorizado.",403);
  const {id}=await context.params;
  if (!isUuid(id)) return apiError("BAD_REQUEST","Pedido inválido.",400);
  if (!isServiceRoleConfigured()) return apiError("INTERNAL_ERROR","Historial no disponible.",503);
  try {
    const db=createAdminServerClient();
    const revisions=[];
    for(let offset=0;;offset+=100) {
      const result=await db.from("wholesale_order_revisions").select("id,version_number,status,commercial_conditions,total_amount,currency,created_at").eq("order_id",id).order("version_number").range(offset,offset+99) as unknown as {data:RevisionRow[]|null;error:unknown};
      if(result.error) throw result.error;
      for(const revision of result.data ?? []) {
        const items=await db.from("wholesale_order_revision_items").select("product_id,product_name_snapshot,category_snapshot,connector_type_snapshot,quantity,unit_price,line_total,currency").eq("revision_id",revision.id).order("product_name_snapshot") as unknown as {data:ItemRow[]|null;error:unknown};
        if(items.error) throw items.error;
        revisions.push({...revision,totalAmount:Number(revision.total_amount),items:(items.data ?? []).map(item=>({productId:item.product_id,name:item.product_name_snapshot,category:item.category_snapshot,connectorType:item.connector_type_snapshot,quantity:item.quantity,unitPrice:Number(item.unit_price),lineTotal:Number(item.line_total),currency:item.currency}))});
      }
      if((result.data?.length ?? 0)<100) break;
    }
    return NextResponse.json({ok:true,data:revisions},{headers:{"Cache-Control":"no-store"}});
  }catch{return apiError("INTERNAL_ERROR","No se pudo cargar el historial de revisiones.",503);}
}
