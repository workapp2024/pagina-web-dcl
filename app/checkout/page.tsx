import { CheckoutForm } from "@/components/store/CheckoutForm";
import { defaultSiteContent } from "@/lib/site-data";
import { getSupabaseSiteSettings } from "@/lib/supabase/site-settings";

export default async function CheckoutPage(){const remote=await getSupabaseSiteSettings();const settings={...defaultSiteContent.siteSettings,...remote};return <CheckoutForm transfer={{alias:settings.transferAlias,cbuCvu:settings.transferCbuCvu,holder:settings.transferHolder,institution:settings.transferInstitution,instructions:settings.transferInstructions}}/>}
