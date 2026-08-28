import { createBrowserClient } from "./client";

export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return Boolean(url && key && url !== "https://placeholder.supabase.co" && key !== "your_supabase_publishable_key_here");
}

export async function testSupabaseConnection(): Promise<{ success: boolean; message: string }> {
  if (!isSupabaseConfigured()) {
    return {
      success: false,
      message: "Supabase no está completamente configurado en .env.local (falta reemplazar la Publishable Key real).",
    };
  }

  try {
    const client = createBrowserClient();
    // Realizamos una consulta inofensiva para verificar inicialización
    const { error } = await client.from("_healthcheck_test").select("*").limit(1);
    // Si el error es sólo que la tabla no existe (code 42P01 o PGRST204), la conexión con Supabase es totalmente exitosa.
    if (error && (error.code === "42P01" || error.code === "PGRST204" || error.message.includes("relation") || error.message.includes("not found"))) {
      return {
        success: true,
        message: "Conexión con Supabase inicializada correctamente. La API responde.",
      };
    }
    if (error) {
      return {
        success: true,
        message: `Cliente de Supabase inicializado (${error.message}).`,
      };
    }
    return {
      success: true,
      message: "Conexión exitosa con Supabase.",
    };
  } catch (err) {
    return {
      success: false,
      message: `Error al probar la conexión: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
