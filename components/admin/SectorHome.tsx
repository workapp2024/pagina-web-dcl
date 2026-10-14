"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAdminIdentity } from "@/components/admin/AdminIdentityProvider";
import { retailNeedsAttention, retailNextAction, wholesaleNeedsAttention, wholesaleNextAction, wholesaleAdminLabel } from "@/lib/admin-order-attention";
import type { OperationalOrder } from "@/lib/store/order-operations";

type Entry = { id: string; number: string; customer: string; createdAt: string; action: string; label: string; attention: boolean; href: string };
type Retail = OperationalOrder & { id: string; order_number: string; customer?: { full_name: string }; created_at: string };
type Wholesale = { id: string; orderNumber: string; customerName: string; createdAt: string; status: string; revisionStatus?: string };

async function read(url: string, signal: AbortSignal) {
  const response = await fetch(url, { cache: "no-store", signal });
  const body = await response.json();
  if (!response.ok || body.ok === false) throw new Error(body.message || body.error || "No se pudieron consultar los pendientes.");
  return body;
}

async function collect(base: string, signal: AbortSignal) {
  const rows = [];
  for (let page = 1; ; page++) {
    const body = await read(`${base}&page=${page}`, signal);
    rows.push(...body.data);
    if (rows.length >= body.pagination.total) return rows;
    if (!body.data.length) throw new Error("La consulta quedó incompleta. Actualizá los pendientes.");
  }
}

export function SectorHome({ sector }: { sector?: "minoristas" | "mayoristas" }) {
  const identity = useAdminIdentity();
  const owner = identity?.role === "ADMIN";
  const [data, setData] = useState<{ minoristas: Entry[]; mayoristas: Entry[] } | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setData(null); setError("");
      try {
        const [retail, wholesale] = await Promise.all([
          sector !== "mayoristas" ? collect("/api/admin/orders?status=all&period=all&view=active&limit=100", controller.signal) : Promise.resolve([]),
          owner && sector !== "minoristas" ? collect("/api/admin/wholesale-orders?status=all", controller.signal) : Promise.resolve([]),
        ]);
        const mayoristas: Entry[] = [];
        // Sequential reads avoid a burst of requests; incomplete reads never become a zero count.
        const orderedWholesale = (wholesale as Wholesale[]).sort((a, b) => Number(b.status === "in_review" && b.revisionStatus === "approved") - Number(a.status === "in_review" && a.revisionStatus === "approved"));
        for (const order of orderedWholesale) {
          let deliveryPending = true;
          if (order.status === "confirmed") {
            const detail = (await read(`/api/admin/wholesale-orders/${order.id}`, controller.signal)).data;
            deliveryPending = !detail.deliveryProgress.length || detail.deliveryProgress.some((item: { delivered: number; ordered: number }) => item.delivered < item.ordered);
          }
          mayoristas.push({ id: order.id, number: order.orderNumber, customer: order.customerName, createdAt: order.createdAt,
            label: wholesaleAdminLabel(order.status, order.revisionStatus), action: wholesaleNextAction(order.status, order.revisionStatus, deliveryPending),
            attention: wholesaleNeedsAttention(order.status, deliveryPending), href: `/admin/mayoristas/pedidos?order=${order.orderNumber}` });
        }
        const minoristas = (retail as Retail[]).map(order => ({ id: order.id, number: order.order_number, customer: order.customer?.full_name || "Cliente", createdAt: order.created_at,
          label: retailNextAction(order), action: retailNextAction(order), attention: retailNeedsAttention(order), href: `/admin/minoristas/pedidos?order=${order.order_number}` }));
        if (!controller.signal.aborted) setData({ minoristas, mayoristas });
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No se pudieron consultar los pendientes."); }
    }
    const timer = setTimeout(() => void load(), 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [owner, refresh, sector]);
  const current = data && sector ? data[sector] : [];
  const pending = current.filter(entry => entry.attention);
  const entries = pending.length ? pending : current.slice(0, 5);
  return <div className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-red-300">DCL Cree LED · Administración</p><h1 className="mt-2 text-3xl font-black">{sector === "minoristas" ? "Minoristas" : sector === "mayoristas" ? "Mayoristas" : "Inicio"}</h1></div><button onClick={() => setRefresh(value => value + 1)} className="min-h-11 rounded-xl border border-white/15 px-4 text-sm">Actualizar pendientes</button></header>
    {error && <p role="alert" className="rounded-xl border border-red-400/30 p-4 text-red-200">{error}</p>}
    {!data && !error && <p role="status">Consultando operaciones…</p>}
    {!sector ? <section aria-label="Sectores comerciales" className="overflow-hidden rounded-2xl border border-white/15 bg-zinc-950/70"><div className="border-b border-white/10 px-5 py-4 sm:px-6"><h2 className="font-semibold">Operaciones de DCL</h2><p className="mt-1 text-sm text-zinc-400">Elegí un sector para atender pedidos y consultar clientes.</p></div><div className="grid md:grid-cols-2">{(["minoristas", "mayoristas"] as const).filter(key => key !== "mayoristas" || owner).map(key => {
      const count = data?.[key].filter(entry => entry.attention).length;
      const next = data?.[key].find(entry => entry.attention);
      return <Link key={key} href={`/admin/${key}`} className="group min-w-0 p-5 transition hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-red-400 sm:p-6 md:[&+a]:border-l md:[&+a]:border-white/10"><div className="flex items-center justify-between gap-3"><h3 className="text-2xl font-black capitalize">{key}</h3><span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 text-red-300 group-hover:border-red-400">→</span></div><p className="mt-2 text-sm text-zinc-400">{key === "minoristas" ? "Pedidos de la tienda y atención al público" : "Solicitudes y entregas a clientes mayoristas"}</p><p className={`mt-5 text-sm font-semibold ${count ? "text-amber-200" : "text-zinc-300"}`}>{count === undefined ? "Pendientes por consultar" : count ? `${count} pedidos requieren atención` : "Sin acciones pendientes"}</p><p className="mt-2 min-h-10 break-words text-sm text-zinc-400">{next ? `${next.number} · ${next.action}` : "Pedidos, clientes y finanzas del sector"}</p><span className="mt-4 block text-sm font-semibold text-red-300">Abrir {key} →</span></Link>;
    })}</div></section> : data && <section><h2 className="text-xl font-bold">{pending.length ? `Requieren atención · ${pending.length}` : "Todo al día"}</h2>{!pending.length && <p className="mt-2 text-sm text-zinc-400">Sin acciones pendientes de DCL sobre pedidos. La espera de respuestas o pagos y los saldos se consultan en sus módulos.</p>}<h3 className="mt-5 font-semibold">{pending.length ? "Próximas acciones" : "Actividad reciente"}</h3><ul className="mt-3 divide-y divide-white/10">{entries.map(entry => <li key={entry.id}><Link href={entry.href} className="block py-4 hover:text-red-200"><div className="flex flex-wrap justify-between gap-2"><b>{entry.number} · {entry.customer}</b><time className="text-xs text-zinc-400">{new Date(entry.createdAt).toLocaleDateString("es-AR")}</time></div><p className="mt-2 text-sm text-amber-200">{entry.label}</p>{entry.label !== entry.action && <p className="mt-1 text-sm text-zinc-300">Próxima acción: {entry.action}</p>}</Link></li>)}</ul>{!entries.length && <p className="mt-3 text-sm text-zinc-400">Todavía no hay actividad.</p>}</section>}
  </div>;
}
