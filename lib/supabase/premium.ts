import { createPremiumServerClient } from "./premium-client";
import { isSupabaseConfigured } from "./test-connection";
import { isPremiumTableUnavailable } from "@/lib/premium";

export async function getPremiumProductIds(): Promise<string[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await createPremiumServerClient("public").from("premium_settings").select("product_ids").eq("id", 1).maybeSingle();
    // Before the local migration is applied, Home remains functional without Premium.
    if (error) {
      if (!isPremiumTableUnavailable(error)) console.error("premium_read_failed", { code: error.code });
      return [];
    }
    if (!data) {
      console.error("premium_selection_missing");
      return [];
    }
    return data.product_ids;
  } catch { console.error("premium_read_unexpected_error"); return []; }
}
