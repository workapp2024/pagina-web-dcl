import type { ReactNode } from "react";

export function InventoryStockCard({ name, code, stock, children }: { name: string; code: string; stock: number; children?: ReactNode }) {
  return <article className="min-w-0 border-b border-white/10 py-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-semibold [overflow-wrap:anywhere]">{name}</p><p className="mt-1 break-all text-xs text-zinc-500">Código: {code}</p></div><p className="text-sm">Existencia: <b>{stock}</b></p></div>
    {children && <div className="mt-3 flex flex-wrap gap-3 text-sm">{children}</div>}
  </article>;
}
