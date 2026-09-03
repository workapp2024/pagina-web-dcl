import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
type BrowserSupabaseClient = SupabaseClient<Database>;
const browserGlobal = globalThis as typeof globalThis & {
  __dclSupabaseBrowserClient?: BrowserSupabaseClient;
};

export function createBrowserClient(): BrowserSupabaseClient {
  if (browserGlobal.__dclSupabaseBrowserClient) {
    return browserGlobal.__dclSupabaseBrowserClient;
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn("Variables de entorno de Supabase no configuradas.");
  }

  const client = createClient<Database>(
    supabaseUrl || "https://placeholder.supabase.co",
    supabaseAnonKey || "placeholder-key"
  );

  browserGlobal.__dclSupabaseBrowserClient = client;
  return client;
}
