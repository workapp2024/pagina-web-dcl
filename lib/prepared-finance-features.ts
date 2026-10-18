// Sector SQL installed and verified under the administrator's authorization.
// Production wholesale payments require a separate explicit opt-in. Existing
// local preparation flags cannot activate the production circuit.
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
  if (process.env.NODE_ENV === "production") {
    return process.env.DCL_WHOLESALE_CHECKOUT_ENABLED === "1"
      && process.env.NEXT_PUBLIC_SUPABASE_URL === "https://ajbztbwflhjxrenryphu.supabase.co"
      && process.env.NEXT_PUBLIC_SITE_URL === "https://pagina-web-dcl.vercel.app"
      && Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN && process.env.MERCADOPAGO_WEBHOOK_SECRET);
  }
  return isolatedDatabaseConfigured() && process.env.DCL_PREPARED_WHOLESALE_CHECKOUT === "1";
}
