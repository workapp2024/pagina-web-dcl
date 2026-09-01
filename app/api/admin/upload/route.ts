import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { apiError, apiInternalError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminServerClient, isServiceRoleConfigured } from "@/lib/supabase/server";
import {
  STORAGE_BUCKET,
  validateImageFile,
  generateStoragePath,
  getStoragePublicUrl,
  type StorageCategory,
} from "@/lib/supabase/storage";

const VALID_CATEGORIES: StorageCategory[] = ["products", "promotions", "vehicles", "hero", "site"];

/**
 * Recibe un archivo desde el panel admin y lo sube a Supabase Storage usando la service role key.
 * Nunca se expone la service role key al navegador: la subida ocurre exclusivamente en el servidor.
 */
export async function POST(request: Request) {
  const limited = rateLimit(request, "admin-upload", { limit: 20, windowMs: 10 * 60 * 1000 });
  if (limited) return limited;
  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    return apiError("UNAUTHORIZED", "No autorizado.", 401);
  }

  if (!isServiceRoleConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Falta configurar la variable de entorno privada SUPABASE_SERVICE_ROLE_KEY en .env.local para subir imágenes a Supabase Storage.",
      },
      { status: 500 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const categoryInput = String(formData.get("category") || "products");
    const idHint = formData.get("idHint") ? String(formData.get("idHint")) : undefined;

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, message: "No se recibió ningún archivo." }, { status: 400 });
    }

    const validation = validateImageFile(file);
    if (!validation.valid) {
      return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
    }

    const category: StorageCategory = VALID_CATEGORIES.includes(categoryInput as StorageCategory)
      ? (categoryInput as StorageCategory)
      : "products";

    const filePath = generateStoragePath(category, file.name, idHint);

    const supabase = createAdminServerClient();
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).upload(filePath, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: file.type,
    });

    if (error) {
      console.warn("Error al subir imagen a Supabase Storage:", error.message);
      return apiError("INTERNAL_ERROR", "No se pudo subir la imagen.", 500);
    }

    const publicUrl = getStoragePublicUrl(data.path);

    return NextResponse.json({ ok: true, path: data.path, publicUrl });
  } catch (err) {
    console.error("Excepción en API de subida de imágenes:", err);
    return apiInternalError("admin_upload", err);
  }
}
