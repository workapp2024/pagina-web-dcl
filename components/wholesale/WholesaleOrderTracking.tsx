type TrackingEvent = { id: string; label: string; at?: string | null; terminal?: boolean };

export function WholesaleOrderTracking({ events, nextAction, outcome, delivered }: { events: TrackingEvent[]; nextAction?: string | null; outcome?:string; delivered?:boolean }) {
  return <div aria-label="Seguimiento del pedido" className="min-w-0">
    <ol className="ml-2 border-l border-white/15">{events.map(event => <li key={event.id} className="relative pb-6 pl-6 last:pb-2">
      <span aria-hidden="true" className={`absolute -left-1.5 top-1 h-3 w-3 rounded-full ring-4 ring-zinc-950 ${outcome === "cancelled" || outcome === "rejected" ? "bg-red-400" : delivered ? "bg-emerald-300" : outcome ? "bg-amber-300" : event.terminal ? "bg-amber-300" : "bg-[var(--red)]"}`} />
      <p className="break-words text-sm font-semibold">{event.terminal && "◆ "}{event.label}</p>
      {event.at && <time dateTime={event.at} className="mt-1 block text-xs text-zinc-400">{new Date(event.at).toLocaleString("es-AR")}</time>}
    </li>)}</ol>
    {nextAction && <p className="mt-4 rounded-xl border border-white/10 p-3 text-sm text-zinc-300">{nextAction}</p>}
  </div>;
}
