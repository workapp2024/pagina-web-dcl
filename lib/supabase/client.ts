import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export function createBrowserClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn("Variables de entorno de Supabase no configuradas.");
  }
  return createClient<Database>(
    supabaseUrl || "https://placeholder.supabase.co",
    supabaseAnonKey || "placeholder-key"
  );
}

export const supabaseClient = createBrowserClient();
