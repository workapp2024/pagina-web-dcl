import { connection } from "next/server";
import { CheckoutForm } from "@/components/store/CheckoutForm";
import { defaultSiteContent } from "@/lib/site-data";
import { getSupabaseSiteSettings } from "@/lib/supabase/site-settings";

export default async function CheckoutPage() {
  // Read current transfer settings per request instead of freezing them at build time.
  await connection();
  const remote = await getSupabaseSiteSettings();
  const settings = { ...defaultSiteContent.siteSettings, ...remote };
  return <CheckoutForm transfer={{ alias: settings.transferAlias, cbuCvu: settings.transferCbuCvu, holder: settings.transferHolder, institution: settings.transferInstitution, instructions: settings.transferInstructions }}/>;
}
