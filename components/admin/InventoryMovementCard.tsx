import type { ReactNode } from "react";

export function InventoryMovementCard({ name, type, date, reason, children }: { name: string; type: string; date: string; reason: string; children: ReactNode }) {
  return <article className="min-w-0 border-b border-white/10 py-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><p className="break-words font-semibold [overflow-wrap:anywhere]">{name} · {type}</p><time className="text-xs text-zinc-500">{new Date(date).toLocaleString("es-AR")}</time></div>
    <p className="mt-2 break-words text-sm text-zinc-400 [overflow-wrap:anywhere]">{reason}</p>
    <div className="mt-2 break-words text-sm [overflow-wrap:anywhere]">{children}</div>
  </article>;
}
