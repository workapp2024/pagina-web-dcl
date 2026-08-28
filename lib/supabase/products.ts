import { createBrowserClient } from "./client";
import { createServerClient } from "./server";
import { isSupabaseConfigured } from "./test-connection";
import type { Product } from "@/lib/site-data";
import type { Database } from "./database.types";

export type ProductRow = Database["public"]["Tables"]["products"]["Row"];

/**
 * Capa de acceso a datos para productos desde Supabase (Etapa 3C).
 * Realiza exclusivamente lecturas SELECT de la tabla 'products'.
 * Devuelve un arreglo de objetos Product tipados o null si ocurre un error,
 * si la base está vacía o si las variables de entorno no están configuradas.
 */
export async function getSupabaseProducts(): Promise<Product[] | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const client = typeof window === "undefined" ? createServerClient() : createBrowserClient();
    const { data, error } = await client
      .from("products")
      .select("*")
      .order("sort_order", { ascending: true });

    if (error) {
      console.warn("Lectura de productos en Supabase no completada:", error.message);
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    const rows = data as unknown as ProductRow[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      price: Number(row.price),
      previousPrice: row.previous_price !== null ? Number(row.previous_price) : undefined,
      image: row.image_url,
      category: row.category,
      featured: row.featured,
      active: row.active,
      href: `/productos/${row.slug}`,
      ctaText: row.cta_text || "VER PRODUCTO",
      order: row.sort_order,
    }));
  } catch (err) {
    console.warn("Excepción al consultar productos en Supabase:", err);
    return null;
  }
}

/**
 * Persiste o actualiza un producto en Supabase llamando a la API segura del servidor (Etapa 6).
 * Devuelve un objeto indicando si la operación fue exitosa en la nube.
 */
export async function upsertSupabaseProduct(product: Product): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "Supabase no está configurado en las variables de entorno." };
  }

  try {
    const response = await fetch("/api/admin/products", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ product }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { success: false, error: data.error || data.message || "Error al conectar con la API de administración." };
    }

    const data = await response.json();
    return { success: Boolean(data.ok), error: data.error };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error al enviar datos del producto a la nube.",
    };
  }
}
