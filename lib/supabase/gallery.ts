/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerClient } from "./server";
import { isSupabaseConfigured } from "./test-connection";

export type GalleryItem = { id: string; imageUrl: string; title?: string; caption?: string; itemType: "delivery"|"installation"|"customer"|"other"; active: boolean; sortOrder: number };
const map=(row:any):GalleryItem=>({id:row.id,imageUrl:row.image_url,title:row.title||undefined,caption:row.caption||undefined,itemType:row.item_type,active:row.active,sortOrder:row.sort_order});
export async function getPublicGallery(limit=16):Promise<GalleryItem[]>{
  if(!isSupabaseConfigured())return[];
  const {data,error}=await createServerClient().from("work_gallery").select("id,image_url,title,caption,item_type,active,sort_order").eq("active",true).order("sort_order").limit(Math.min(24,Math.max(1,limit)));
  if(error){console.warn("Galería pública no disponible:",error.message);return[]}
  return (data||[]).map(map);
}
