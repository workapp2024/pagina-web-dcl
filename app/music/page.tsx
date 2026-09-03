import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MusicStationGrid } from "@/components/music/MusicStationGrid";
import { SiteContentProvider } from "@/components/providers/SiteContentProvider";
import { WhatsAppButton } from "@/components/ui/WhatsAppButton";
import { DEFAULT_RADIO_STATION } from "@/lib/radio-stations";
import { getPublicRadioStations } from "@/lib/supabase/radio-stations";

export const revalidate=60;
export const metadata={title:"DCL Music | DCL Cree LED",description:"Música gratis para acompañarte en el camino, desde DCL."};
export default async function MusicPage(){const remote=await getPublicRadioStations(),stations=remote.length?remote:[DEFAULT_RADIO_STATION];return <SiteContentProvider><div className="min-h-screen bg-black text-white"><Header/><main className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8"><span className="text-xs font-bold uppercase tracking-[.24em] text-red-400">Un servicio gratuito de DCL</span><h1 className="mt-3 text-4xl font-black uppercase tracking-[-.06em] md:text-5xl">DCL Music</h1><p className="mb-10 mt-4 max-w-2xl text-base leading-7 text-zinc-400">Elegí una radio y seguí escuchando mientras recorrés productos, vehículos y el resto del sitio.</p><MusicStationGrid stations={stations}/></main><Footer/><WhatsAppButton floating/></div></SiteContentProvider>}
