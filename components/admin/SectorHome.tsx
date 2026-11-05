"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAdminIdentity } from "@/components/admin/AdminIdentityProvider";
import { retailNeedsAttention, retailNextAction, wholesaleNeedsAttention, wholesaleNextAction, wholesaleAdminLabel } from "@/lib/admin-order-attention";
import { technicalOrderLabels, operationalLabels, type OperationalOrder } from "@/lib/store/order-operations";

type Sector = "minoristas" | "mayoristas";
type Result = { entries: Entry[] } | { error: string };
type Entry = { id: string; number: string; customer: string; action: string; label: string; href: string };
type Retail = OperationalOrder & { id: string; order_number: string; customer?: { full_name: string } };
type Wholesale = { id: string; orderNumber: string; customerName: string; status: string; transferNoticePending?: boolean; deliveryPending?: boolean; revisionStatus?: string };

async function read(url: string, signal: AbortSignal) {
  const response = await fetch(url, { cache: "no-store", signal });
  const body = await response.json();
  if (!response.ok || body.ok === false) throw new Error(body.message || body.error || "No se pudieron consultar los pendientes.");
  return body;
}

async function collect<T>(base: string, signal: AbortSignal) {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const body = await read(`${base}&page=${page}`, signal);
    rows.push(...body.data);
    if (rows.length >= body.pagination.total) return rows;
    if (!body.data.length) throw new Error("La consulta quedó incompleta. Actualizá los pendientes.");
  }
}

async function loadRetail(signal: AbortSignal, owner: boolean): Promise<Entry[]> {
  const orders = await collect<Retail>("/api/admin/orders?status=all&period=all&view=active&limit=100", signal);
  return orders.filter(retailNeedsAttention).map(order => ({
    id: order.id,
    number: order.order_number,
    customer: order.customer?.full_name || "Cliente",
    label: `${technicalOrderLabels[order.status] || "Pedido registrado"} · ${operationalLabels[order.operational_status] || "Estado por revisar"}`,
    action: !owner && ["refund_required", "stock_unavailable", "pending_manual_verification"].includes(order.status)
      ? "Consultar la incidencia; requiere revisión de Administración"
      : retailNextAction(order),
    href: `/admin/minoristas/pedidos?order=${encodeURIComponent(order.order_number)}`,
  }));
}

async function loadWholesale(signal: AbortSignal): Promise<Entry[]> {
  const orders = await collect<Wholesale>("/api/admin/wholesale-orders?status=all&archived=false&includeDeliveryPending=true", signal);
  const pending: Entry[] = [];
  for (const order of orders) {
    if (order.status === "confirmed" && !order.transferNoticePending && typeof order.deliveryPending !== "boolean") {
      throw new Error("No se pudo consultar el estado de las entregas.");
    }
    const deliveryPending = order.deliveryPending;
    if (!order.transferNoticePending && !wholesaleNeedsAttention(order.status, deliveryPending)) continue;
    pending.push({
      id: order.id,
      number: order.orderNumber,
      customer: order.customerName,
      label: wholesaleAdminLabel(order.status, order.revisionStatus),
      action: order.transferNoticePending ? "Revisar el aviso de transferencia" : wholesaleNextAction(order.status, order.revisionStatus, deliveryPending),
      href: `/admin/mayoristas/pedidos?order=${encodeURIComponent(order.orderNumber)}`,
    });
  }
  return pending;
}

const linkClass = "inline-flex min-h-11 items-center rounded-xl border border-white/15 px-4 text-sm font-semibold hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-red-400";
const channels = { minoristas: "Minoristas", mayoristas: "Mayoristas" } satisfies Record<Sector, string>;

export function SectorHome({ sector }: { sector?: Sector }) {
  const identity = useAdminIdentity();
  const owner = identity?.role === "ADMIN";
  const authenticated = Boolean(identity);
  const [results, setResults] = useState<Partial<Record<Sector, Result>>>({});
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    async function load(key: Sector, request: () => Promise<Entry[]>) {
      let result: Result;
      try {
        result = { entries: await request() };
      } catch (cause) {
        result = { error: cause instanceof Error ? cause.message : "No se pudieron consultar los pendientes." };
      }
      if (!controller.signal.aborted) setResults(current => ({ ...current, [key]: result }));
    }
    if (sector !== "mayoristas") void load("minoristas", () => loadRetail(controller.signal, owner));
    if (owner && sector !== "minoristas") void load("mayoristas", () => loadWholesale(controller.signal));
    return () => controller.abort();
  }, [authenticated, owner, refresh, sector]);

  const visible: Sector[] = sector ? [sector] : owner ? ["minoristas", "mayoristas"] : ["minoristas"];
  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-red-300">Operaciones · DCL Cree LED</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{sector ? channels[sector] : "Pendientes de trabajo"}</h1>
        <p className="mt-2 text-sm text-zinc-300">Revisá la próxima acción y abrí el pedido correspondiente.</p>
      </div>
      <button type="button" onClick={() => { setResults({}); setRefresh(value => value + 1); }} className={linkClass}>Actualizar pendientes</button>
    </header>
    {visible.map(key => {
      const result = results[key];
      const entries = result && "entries" in result ? result.entries : undefined;
      return <section key={key} aria-labelledby={`pendientes-${key}`} className="min-w-0 rounded-2xl border border-white/10 bg-zinc-900/60 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {!sector && <p className="text-sm font-semibold text-red-300">{channels[key]}</p>}
            <h2 id={`pendientes-${key}`} className="text-xl font-bold">{entries?.length ? `Requieren atención · ${entries.length}` : "Pedidos pendientes"}</h2>
          </div>
          <Link href={`/admin/${key}/pedidos`} className={linkClass}>Ver todos los pedidos</Link>
        </div>
        {!result && <p role="status" className="mt-4 text-sm text-zinc-300">Consultando operaciones…</p>}
        {result && "error" in result && <p role="alert" className="mt-4 rounded-xl border border-red-400/30 p-3 text-sm text-red-200">No pudimos consultar {channels[key]}. {result.error}</p>}
        {entries?.length === 0 && <p role="status" className="mt-4 text-sm text-zinc-300">Todo al día. No tenés pedidos pendientes en {channels[key]}.</p>}
        {entries && entries.length > 0 && <ul className="mt-3 divide-y divide-white/10">
          {entries.map(entry => <li key={entry.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0 break-words">
              <p className="font-semibold">{entry.number} · {entry.customer}</p>
              <p className="mt-1 text-sm text-zinc-300">{entry.label}</p>
              <p className="mt-1 text-sm font-medium text-amber-200">Próxima acción: {entry.action}</p>
            </div>
            <Link href={entry.href} prefetch={false} aria-label={`Abrir pedido ${entry.number}`} className={linkClass}>Abrir pedido <span aria-hidden="true">→</span></Link>
          </li>)}
        </ul>}
      </section>;
    })}
    {!sector && authenticated && <section className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 sm:p-5">
      <h2 className="text-xl font-bold">Acciones rápidas</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href="/admin/productos" className={linkClass}>Gestionar productos</Link>
        {owner && <Link href="/admin/home" className={linkClass}>Editar página de inicio</Link>}
      </div>
    </section>}
  </div>;
}
