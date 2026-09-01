import { createBrowserClient } from "./client";
import { createServerClient } from "./server";
import { isSupabaseConfigured } from "./test-connection";
import { sanitizeStoredImageUrl } from "./storage";
import type { Product } from "@/lib/site-data";
import type { Database } from "./database.types";

export type ProductRow = Database["public"]["Tables"]["products"]["Row"];

const PUBLIC_PRODUCT_COLUMNS = [
  "id",
  "name",
  "slug",
  "description",
  "price",
  "previous_price",
  "category",
  "image_url",
  "cta_text",
  "featured",
  "active",
  "sort_order",
  "watts",
  "lumens",
  "voltage",
  "color_temperature",
  "connector_type",
  "canbus",
  "chip_type",
  "warranty",
] as const;

const PUBLIC_PRODUCT_SELECT = PUBLIC_PRODUCT_COLUMNS.join(",");

type PublicProductRow = Pick<ProductRow, (typeof PUBLIC_PRODUCT_COLUMNS)[number]>;

function mapProductRow(row: PublicProductRow, includePrivateFields = false): Product {
  const product: Product = {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    previousPrice: row.previous_price !== null ? Number(row.previous_price) : undefined,
    image: sanitizeStoredImageUrl(row.image_url),
    category: row.category,
    featured: row.featured,
    active: row.active,
    href: `/productos/${row.slug}`,
    ctaText: row.cta_text || "VER PRODUCTO",
    order: row.sort_order,
    watts: row.watts ?? undefined,
    lumens: row.lumens ?? undefined,
    voltage: row.voltage ?? undefined,
    colorTemperature: row.color_temperature ?? undefined,
    connectorType: row.connector_type ?? undefined,
    canbus: row.canbus,
    chipType: row.chip_type ?? undefined,
    warranty: row.warranty ?? undefined,
  };

  if (includePrivateFields) {
    const adminRow = row as ProductRow;
    product.costPrice = adminRow.cost_price ?? undefined;
    product.marginPercentage = adminRow.margin_percentage ?? undefined;
    product.stock = adminRow.stock;
    product.stockMin = adminRow.stock_min;
  }

  return product;
}

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
      .select(PUBLIC_PRODUCT_SELECT)
      .order("sort_order", { ascending: true });

    if (error) {
      console.warn("Lectura de productos en Supabase no completada:", error.message);
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    return (data as unknown as PublicProductRow[]).map((row) => mapProductRow(row));
  } catch (err) {
    console.warn("Excepción al consultar productos en Supabase:", err);
    return null;
  }
}

/**
 * Lee productos completos, incluidos los campos privados, exclusivamente por
 * la API protegida del panel administrativo. Nunca consulta Supabase desde el navegador.
 */
export async function getAdminSupabaseProducts(): Promise<{ success: boolean; products?: Product[]; error?: string }> {
  try {
    const response = await fetch("/api/admin/products", { method: "GET" });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok) {
      return { success: false, error: data.error || data.message || "No se pudieron cargar los productos administrativos." };
    }

    return { success: true, products: data.data as Product[] };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error al cargar los productos administrativos.",
    };
  }
}

export function mapAdminProductRow(row: ProductRow): Product {
  return mapProductRow(row, true);
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
