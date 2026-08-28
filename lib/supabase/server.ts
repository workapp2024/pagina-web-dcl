import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export function isServiceRoleConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function createServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn("Variables de entorno del servidor de Supabase no configuradas.");
  }

  return createClient<Database>(
    supabaseUrl || "https://placeholder.supabase.co",
    supabaseAnonKey || "placeholder-key",
    {
      auth: {
        persistSession: false,
      },
    }
  );
}

export function createAdminServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl) {
    console.warn("NEXT_PUBLIC_SUPABASE_URL no configurada en el servidor.");
  }

  if (!serviceKey) {
    console.warn(
      "SUPABASE_SERVICE_ROLE_KEY no está configurada en .env.local. Las escrituras administrativas en Supabase requieren esta variable privada de servidor."
    );
  }

  return createClient<Database>(
    supabaseUrl || "https://placeholder.supabase.co",
    serviceKey || "placeholder-key",
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}
