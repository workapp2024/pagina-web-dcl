import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
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
  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ ok: false, message: "No autorizado." }, { status: 401 });
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
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const publicUrl = getStoragePublicUrl(data.path);

    return NextResponse.json({ ok: true, path: data.path, publicUrl });
  } catch (err) {
    console.error("Excepción en API de subida de imágenes:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error interno del servidor." },
      { status: 500 }
    );
  }
}
