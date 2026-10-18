// Sector SQL installed and verified under the administrator's authorization.
// Automatic checkout remains restricted to an isolated rehearsal until the
// production provider configuration and notification delivery are verified.
function isolatedDatabaseConfigured() {
  try { return ["localhost","127.0.0.1","[::1]"].includes(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname); }
  catch { return false; }
}
export function sectorFinancePreparedEnabled() {
  if (process.env.NODE_ENV === "production") {
    return process.env.NEXT_PUBLIC_SUPABASE_URL === "https://ajbztbwflhjxrenryphu.supabase.co"
      && process.env.DCL_PREPARED_SECTOR_FINANCE !== "0";
  }
  return isolatedDatabaseConfigured() && process.env.DCL_PREPARED_SECTOR_FINANCE === "1";
}
export function wholesaleCheckoutPreparedEnabled() {
  return process.env.NODE_ENV !== "production" && isolatedDatabaseConfigured() && process.env.DCL_PREPARED_WHOLESALE_CHECKOUT === "1";
}
