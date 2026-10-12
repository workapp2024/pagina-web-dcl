import { connection } from "next/server";
import { CheckoutForm } from "@/components/store/CheckoutForm";
import { defaultSiteContent } from "@/lib/site-data";
import { getSupabaseSiteSettings } from "@/lib/supabase/site-settings";
import { isMaintenanceMode, MAINTENANCE_MESSAGE } from "@/lib/maintenance-mode";
import { PaymentMethods } from "@/components/sections/PaymentMethods";

export default async function CheckoutPage() {
  // Read current transfer settings per request instead of freezing them at build time.
  await connection();
  if (isMaintenanceMode()) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="text-3xl font-bold">Compras en pausa</h1>
        <p className="mt-5 text-lg text-zinc-300">{MAINTENANCE_MESSAGE}</p>
      </main>
    );
  }
  const remote = await getSupabaseSiteSettings();
  const settings = { ...defaultSiteContent.siteSettings, ...remote };
  return <><PaymentMethods settings={settings} surface="checkout"/><CheckoutForm transfer={{ alias: settings.transferAlias, cbuCvu: settings.transferCbuCvu, holder: settings.transferHolder, institution: settings.transferInstitution, instructions: settings.transferInstructions }}/></>;
}
