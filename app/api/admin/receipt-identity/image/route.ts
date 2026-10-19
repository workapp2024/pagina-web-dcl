import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import path from "node:path";
import sharp from "sharp";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { RECEIPT_ASSET } from "@/lib/receipt-identity";
import { createAdminServerClient } from "@/lib/supabase/server";
import { STORAGE_BUCKET } from "@/lib/supabase/storage";
export const runtime = "nodejs";
export async function GET(request: Request) {
  if (!(await isAdminAuthenticated("commercial"))) return new Response(null, { status: 401 });
  const params = new URL(request.url).searchParams, asset = params.get("asset"), tone = params.get("tone");
  if (!asset || (asset !== "default" && !RECEIPT_ASSET.test(asset)) || (tone && tone !== "monochrome")) return new Response(null, { status: 400 });
  try {
    let bytes: Buffer;
    if (asset === "default") bytes = await readFile(path.join(process.cwd(), "public/brand/logo-dcl.png.png"));
    else {
      const { data, error } = await createAdminServerClient().storage.from(STORAGE_BUCKET).download(asset);
      if (error || !data || data.size > 2 * 1024 * 1024) return new Response(null, { status: 404 });
      bytes = Buffer.from(await data.arrayBuffer());
    }
    const image = sharp(bytes, { limitInputPixels: 8_000_000 });
    const output = await (tone === "monochrome" ? image.greyscale() : image).png().toBuffer();
    return new Response(new Uint8Array(output), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } });
  } catch { return new Response(null, { status: 503 }); }
}
