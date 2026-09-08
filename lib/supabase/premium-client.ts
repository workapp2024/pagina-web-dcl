import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { PremiumDatabase } from "./database.types";

// A scoped SDK contract keeps Premium fully inferred without changing clients
// used by payments, inventory or orders. Creating a client performs no query.
export function createPremiumServerClient(access: "public" | "admin") {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = access === "admin"
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase no está configurado para Premium.");

  return createClient<PremiumDatabase>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
