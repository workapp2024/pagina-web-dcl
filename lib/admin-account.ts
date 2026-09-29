import "server-only";
import { createAdminServerClient } from "@/lib/supabase/server";

export function validNewPassword(password: unknown, confirmation: unknown): password is string {
  return typeof password === "string" && password.length >= 12 && password.length <= 128 && password === confirmation;
}

export async function isBootstrapAvailable() {
  const db = createAdminServerClient();
  const [marker, admins] = await Promise.all([
    db.from("admin_bootstrap").select("id").eq("id", 1).maybeSingle(),
    db.from("admin_profiles").select("id").eq("role", "ADMIN").eq("active", true).limit(1),
  ]);
  if (marker.error || admins.error) throw new Error("BOOTSTRAP_UNAVAILABLE");
  return !marker.data && !admins.data?.length;
}
