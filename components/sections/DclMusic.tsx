import Link from "next/link";
import { MusicStationGrid } from "@/components/music/MusicStationGrid";
import type { RadioStation } from "@/lib/radio-stations";

export function DclMusic({stations}:{stations:RadioStation[]}){return <section className="border-y border-white/10 bg-zinc-950/50 px-4 py-14 sm:px-6"><div className="mx-auto max-w-7xl"><div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><span className="text-xs font-bold uppercase tracking-[.24em] text-red-400">Gratis para la comunidad</span><h2 className="mt-2 text-3xl font-black uppercase tracking-[-.05em]">DCL Music</h2><p className="mt-2 text-sm text-zinc-400">Música para acompañarte en cada camino.</p></div><Link href="/music" className="rounded-full border border-white/15 px-4 py-2 text-xs font-bold uppercase text-white transition hover:border-red-500/60">Ver todas las radios</Link></div><MusicStationGrid stations={stations.slice(0,3)} compact/></div></section>}
