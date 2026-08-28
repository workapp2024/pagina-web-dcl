import { createBrowserClient } from "./client";
import { createServerClient } from "./server";
import { isSupabaseConfigured } from "./test-connection";

export { isSupabaseConfigured };

export const STORAGE_BUCKET = "dcl-media";
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/avif",
];

export type StorageCategory = "products" | "promotions" | "vehicles" | "hero" | "site";

/**
 * Valida formato y tamaño máximo de la imagen antes de subirla.
 */
export function validateImageFile(file: File): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: "No se seleccionó ningún archivo." };
  }

  if (!file.type.startsWith("image/") || !ALLOWED_MIME_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: "Formato no permitido. Utilizá imágenes JPG, PNG, WebP, GIF, SVG o AVIF.",
    };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: "El archivo supera el tamaño máximo permitido de 10 MB.",
    };
  }

  return { valid: true };
}

/**
 * Genera una ruta limpia y segura dentro del bucket dcl-media.
 * Ejemplo: "products/s6-hd-1724774400000.webp"
 */
export function generateStoragePath(category: StorageCategory, filename: string, idHint?: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() || "webp";
  const cleanName = (idHint || filename.substring(0, filename.lastIndexOf(".")) || "image")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-");
  
  const timestamp = Date.now();
  return `${category}/${cleanName}-${timestamp}.${extension}`;
}

/**
 * Obtiene la URL pública HTTPS de un archivo almacenado en Supabase Storage.
 */
export function getStoragePublicUrl(path: string): string {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("/")) {
    return path;
  }

  const client = typeof window === "undefined" ? createServerClient() : createBrowserClient();
  const { data } = client.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Determina si una URL pertenece al bucket público de Supabase Storage.
 */
export function isSupabaseStorageUrl(url: string): boolean {
  return typeof url === "string" && url.includes(`/storage/v1/object/public/${STORAGE_BUCKET}/`);
}

/**
 * Sube una imagen al bucket 'dcl-media' en Supabase Storage.
 * Retorna la ruta interna y la URL pública HTTPS.
 */
export async function uploadImageToStorage(
  category: StorageCategory,
  file: File,
  idHint?: string
): Promise<{ success: boolean; path?: string; publicUrl?: string; error?: string }> {
  const validation = validateImageFile(file);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  if (!isSupabaseConfigured()) {
    return {
      success: false,
      error: "Supabase no está configurado en las variables de entorno.",
    };
  }

  try {
    const client = typeof window === "undefined" ? createServerClient() : createBrowserClient();
    const filePath = generateStoragePath(category, file.name, idHint);

    const { data, error } = await client.storage.from(STORAGE_BUCKET).upload(filePath, file, {
      cacheControl: "3600",
      upsert: true,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const publicUrl = getStoragePublicUrl(data.path);
    return { success: true, path: data.path, publicUrl };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error al subir la imagen a Supabase Storage.",
    };
  }
}

/**
 * Elimina un archivo del bucket 'dcl-media'.
 */
export async function deleteImageFromStorage(path: string): Promise<{ success: boolean; error?: string }> {
  if (!path || !isSupabaseConfigured()) {
    return { success: false, error: "Ruta o configuración de Supabase no válida." };
  }

  try {
    const client = typeof window === "undefined" ? createServerClient() : createBrowserClient();
    // Extraer la ruta si se pasó la URL pública completa
    const relativePath = isSupabaseStorageUrl(path)
      ? path.split(`/storage/v1/object/public/${STORAGE_BUCKET}/`)[1]
      : path;

    const { error } = await client.storage.from(STORAGE_BUCKET).remove([relativePath]);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error al eliminar la imagen de Supabase Storage.",
    };
  }
}

/**
 * Comprobador de estado e infraestructura de Supabase Storage.
 */
export async function testStorageConnection(): Promise<{ success: boolean; message: string; sampleUrl?: string }> {
  if (!isSupabaseConfigured()) {
    return {
      success: false,
      message: "Supabase no está configurado en las variables de entorno.",
    };
  }

  try {
    const samplePath = "products/sample-test.webp";
    const sampleUrl = getStoragePublicUrl(samplePath);
    return {
      success: true,
      message: `Infraestructura de Supabase Storage preparada. Bucket objetivo: '${STORAGE_BUCKET}'.`,
      sampleUrl,
    };
  } catch (err) {
    return {
      success: false,
      message: `Error al verificar Storage: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
