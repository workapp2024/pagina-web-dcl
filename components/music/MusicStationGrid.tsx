/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRadio } from "@/components/layout/RadioPlayer";
import { analyticsEvents, capture } from "@/lib/analytics";
import { selectRadioStation, type RadioStation } from "@/lib/radio-stations";

export function MusicStationGrid({ stations, compact = false }: { stations: RadioStation[]; compact?: boolean }) {
  const radio = useRadio();
  useEffect(() => { if (!compact) capture(analyticsEvents.dclMusicOpen); }, [compact]);
  const isPlaying = radio.status === "playing" || radio.status === "loading" || radio.status === "stalled";

  return <div className={`grid gap-4 ${compact ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2 xl:grid-cols-3"}`}>
    {stations.map(station => {
      const selected = radio.station?.id === station.id;
      const live = selected && isPlaying;
      const paused = selected && radio.status === "paused";
      return <article key={station.id} className={`group overflow-hidden rounded-2xl border bg-zinc-950/80 p-3 transition ${live ? "border-red-500/70" : "border-white/10 hover:border-red-500/40"}`}>
        <div className="flex items-center gap-3">
          {station.coverUrl ? <img src={station.coverUrl} alt={`Portada de ${station.name}`} className="h-16 w-16 shrink-0 rounded-xl object-cover"/> : <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-red-600/30 to-zinc-900 text-2xl text-red-300">♫</div>}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><h3 className="truncate font-black text-white">{station.name}</h3>{(live||paused)&&<span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[9px] font-bold uppercase text-red-300">{live?"En vivo":"Pausada"}</span>}</div>
            <p className="mt-1 truncate text-xs text-zinc-400">{station.genre || "Música"} · DCL Music</p>
            {compact ? <Link href="/music" className="mt-2 inline-flex min-h-9 items-center rounded-full border border-white/15 px-3 text-[11px] font-bold uppercase text-white">Ir a DCL Music</Link> : <button type="button" onClick={() => live ? radio.pause() : selectRadioStation(station)} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-full bg-red-600 px-4 text-[11px] font-bold uppercase tracking-wider text-white transition hover:bg-red-500"><span aria-hidden="true">{live ? "Ⅱ" : "▶"}</span>{live ? "Pausar" : "Escuchar"}</button>}
          </div>
        </div>
        {!compact&&station.description&&<p className="mt-3 text-sm leading-6 text-zinc-400">{station.description}</p>}
      </article>;
    })}
  </div>;
}
