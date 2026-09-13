"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { operationalActions, operationalLabels, paymentLabels, paymentMethodLabels, technicalOrderLabels, type OperationalOrder, type OperationalStatus } from "@/lib/store/order-operations";

type HistoryEntry = {
  id: number; previous_status: OperationalStatus | null; new_status: OperationalStatus;
  created_at: string; actor: string; source: string; note: string;
};
type Order = OperationalOrder & {
  id: string; order_number: string; total: number; created_at: string; payment_method: string;
  fulfillment_method: "pickup" | "delivery"; shipping_address: string | null;
  notes: string; transfer_declared_at: string | null;
  customer: { full_name: string; phone: string | null; email: string | null } | null;
  items: { product_name: string; quantity: number; line_total: number }[];
  internalNotes: { id: string; note: string; created_at: string }[];
  operationalHistory: HistoryEntry[];
};
const money = (value: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number(value));
const date = (value: string) => new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(value));
const fulfillmentLabels = { pickup: "Retiro", delivery: "Entrega a domicilio" };
const filters = [
  { id: "all", label: "Todos" }, { id: "attention", label: "Requieren revisión" },
  { id: "pending", label: "Pago pendiente" }, { id: "transfer", label: "Transferencias a verificar" },
  { id: "paid", label: "Pago aprobado" }, { id: "delivery", label: "Entregas pendientes con pago" },
  { id: "completed", label: "Venta registrada" }, { id: "cancelled", label: "Cancelación / rechazo registrado" },
];
const buttonClass = "min-h-11 rounded-xl border border-white/15 px-4 py-2 text-sm font-bold disabled:opacity-40";

export function OrdersManager() {
  const [rows, setRows] = useState<Order[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [operational, setOperational] = useState("all");
  const [period, setPeriod] = useState("month");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Order | null>(null);
  const [note, setNote] = useState("");
  const [operationNote, setOperationNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    const version = ++latest.current;
    setLoading(true);
    try {
      const response = await fetch("/api/admin/orders?" + new URLSearchParams({ q, status, operational, period, page: String(page), limit: "50" }));
      const body = await response.json();
      if (version !== latest.current) return;
      if (!response.ok) throw new Error(body.error || "No se pudieron cargar los pedidos.");
      const data: Order[] = body.data || [];
      setError(""); setRows(data); setTotal(body.pagination.total);
      setSelected(current => current ? data.find(row => row.id === current.id) || null : null);
      if (page > Math.max(1, Math.ceil(body.pagination.total / 50))) setPage(Math.max(1, Math.ceil(body.pagination.total / 50)));
    } catch (cause) {
      if (version === latest.current) setError(cause instanceof Error ? cause.message : "No se pudieron cargar los pedidos.");
    } finally { if (version === latest.current) setLoading(false); }
  }, [q, status, operational, period, page]);
  useEffect(() => {
    const requestVersion = latest;
    const timer = setTimeout(() => void load(), 180);
    return () => { clearTimeout(timer); requestVersion.current++; };
  }, [load]);

  async function action(name: string, payload: object = {}) {
    if (!selected || inFlight.current) return;
    if (name === "confirm_transfer" && !window.confirm("Confirmá que verificaste el ingreso de la transferencia.")) return;
    if (name === "cancel_order" && !window.confirm("¿Cancelar el pedido pendiente y liberar su reserva mediante el flujo actual?")) return;
    if (name === "operational" && !window.confirm("¿Registrar este cambio operativo? No modifica el pago ni el stock.")) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(name === "operational" ? "/api/admin/orders/operational-status" : "/api/admin/orders", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: name, orderId: selected.id, ...payload }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo completar la acción.");
      setNote(""); setOperationNote(""); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo completar la acción."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const actions = selected ? operationalActions(selected) : null;
  const changeOperation = (target: OperationalStatus) => selected && action("operational", {
    expectedStatus: selected.operational_status, status: target, note: operationNote,
  });

  return <div className="space-y-5">
    <header><h1 className="text-3xl font-black">Pedidos</h1><p className="mt-2 text-sm text-zinc-400">Gestioná preparación y entrega. El pago se muestra por separado.</p></header>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm">Buscar pedido<input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="DCL-000001, cliente, teléfono, producto o UUID" className="mt-1 w-full rounded-xl bg-zinc-900 p-3" /></label>
      <label className="text-sm">Estado del pedido<select value={operational} onChange={e => { setOperational(e.target.value); setPage(1); }} className="mt-1 w-full rounded-xl bg-zinc-900 p-3"><option value="all">Todos los estados operativos</option>{Object.entries(operationalLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm">Pago / revisión<select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className="mt-1 w-full rounded-xl bg-zinc-900 p-3">{filters.map(filter => <option key={filter.id} value={filter.id}>{filter.label}</option>)}</select></label>
      <label className="text-sm">Fecha<select value={period} onChange={e => { setPeriod(e.target.value); setPage(1); }} className="mt-1 w-full rounded-xl bg-zinc-900 p-3"><option value="today">Hoy</option><option value="week">Últimos 7 días</option><option value="month">Últimos 30 días</option><option value="all">Todas las fechas</option></select></label>
    </div>
    <button disabled={busy || loading} onClick={() => void load()} className={buttonClass}>{loading ? "Actualizando…" : "Actualizar pedidos"}</button>
    {status === "completed" && <p className="text-sm text-amber-200">Venta registrada indica confirmación comercial del flujo actual; no acredita entrega.</p>}
    {error && !selected && <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
    <div className="space-y-3">{rows.map(row => <button key={row.id} onClick={() => { setSelected(row); setNote(""); setOperationNote(""); }} className="w-full rounded-2xl border border-white/10 p-4 text-left hover:border-red-500/40">
      <div className="flex flex-wrap justify-between gap-3"><div><b>{row.order_number} · {row.customer?.full_name || "Cliente"}</b><small className="mt-1 block text-zinc-400">{row.customer?.phone || "Sin teléfono"} · {date(row.created_at)}</small></div><b>{money(row.total)}</b></div>
      <p className="mt-3 text-sm text-zinc-300">{row.items.map(item => `${item.product_name} × ${item.quantity}`).join(" · ")}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-sm"><span className="rounded-lg bg-white/10 px-3 py-2">Pedido: <b>{operationalLabels[row.operational_status]}</b></span><span className="rounded-lg bg-white/5 px-3 py-2">Pago: <b>{paymentLabels[row.payment?.status || ""] || "Sin transacción"}</b></span></div>
      <p className="mt-2 text-xs text-zinc-400">{paymentMethodLabels[row.payment_method]} · {fulfillmentLabels[row.fulfillment_method]}</p>
      {row.status === "stock_unavailable" && <p className="mt-2 text-sm text-amber-200">Requiere revisión de stock o reserva.</p>}
      {["cancelled", "rejected"].includes(row.status) && row.operational_status !== "cancelled" && <p className="mt-2 text-sm text-amber-200">Cancelación o rechazo registrado en el flujo de pago; pendiente de revisión operativa.</p>}
    </button>)}{!rows.length && !loading && <p className="py-8 text-center text-sm text-zinc-500">No hay pedidos para estos filtros.</p>}</div>
    <nav aria-label="Paginación" className="flex flex-wrap items-center justify-between gap-3"><button disabled={loading || page === 1} onClick={() => setPage(p => p - 1)} className={buttonClass}>Anterior</button><span className="text-sm">Página {page} de {Math.max(1, Math.ceil(total / 50))} · {total} pedidos</span><button disabled={loading || page * 50 >= total} onClick={() => setPage(p => p + 1)} className={buttonClass}>Siguiente</button></nav>
    {selected && actions && <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 p-3 sm:p-5"><section role="dialog" aria-modal="true" aria-labelledby="order-title" className="mx-auto max-w-2xl rounded-3xl bg-zinc-950 p-5 sm:p-6">
      <button disabled={busy} onClick={() => setSelected(null)} className="float-right min-h-11 px-2 text-zinc-400">Cerrar</button>
      <p className="text-xs font-bold uppercase tracking-widest text-red-300">Pedido</p><h2 id="order-title" className="text-2xl font-black">{selected.order_number}</h2><p className="mt-1 text-sm text-zinc-400">{date(selected.created_at)}</p>
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
      <div className="mt-5 rounded-2xl bg-white/5 p-4"><b>{selected.customer?.full_name}</b><p className="text-sm text-zinc-300">{selected.customer?.phone || "Sin teléfono"}</p><p className="text-sm text-zinc-400">{selected.customer?.email || "Sin email"}</p></div>
      <div className="mt-5 space-y-2">{selected.items.map((item, index) => <p key={index} className="flex justify-between gap-3"><span>{item.product_name} × {item.quantity}</span><b>{money(item.line_total)}</b></p>)}</div>
      <p className="mt-5 text-xl font-black">Total {money(selected.total)}</p>
      <dl className="mt-5 grid gap-3 rounded-2xl border border-white/10 p-4 text-sm">
        <div><dt className="text-zinc-400">Estado del pedido</dt><dd className="font-bold">{operationalLabels[selected.operational_status]}</dd></div>
        <div><dt className="text-zinc-400">Estado del pago</dt><dd className="font-bold">{paymentLabels[selected.payment?.status || ""] || "Sin transacción"} · {paymentMethodLabels[selected.payment_method]}</dd></div>
        <div><dt className="text-zinc-400">Modalidad</dt><dd>{fulfillmentLabels[selected.fulfillment_method]}{selected.shipping_address && ` · ${selected.shipping_address}`}</dd></div>
        {selected.notes && <div><dt className="text-zinc-400">Observaciones del pedido</dt><dd>{selected.notes}</dd></div>}
      </dl>
      <section className="mt-5 rounded-2xl border border-white/10 p-4"><h3 className="font-bold">Gestión operativa</h3>
        <p className="mt-2 text-sm text-zinc-400">Estos cambios registran preparación y entrega; no modifican pagos ni stock.</p>
        {actions.financialReview && selected.operational_status !== "cancelled" && <p className="mt-3 text-sm text-amber-200">Una cancelación requiere revisión financiera o devolución. No puede resolverse cambiando el estado operativo.</p>}
        {!actions.terminal && !actions.next && !actions.canCancel && <p className="mt-3 text-sm text-zinc-300">Para avanzar se requiere pago aprobado y venta vigente. Para marcar cancelado, primero debe estar resuelto el pago por el flujo actual.</p>}
        {(actions.next || actions.canCancel) && <><label className="mt-4 block text-sm">Motivo o nota del cambio (opcional)<textarea disabled={busy} value={operationNote} onChange={e => setOperationNote(e.target.value)} maxLength={1000} className="mt-2 min-h-20 w-full rounded-xl bg-zinc-900 p-3" /></label><div className="mt-3 flex flex-wrap gap-2">
          {actions.next && <button disabled={busy} onClick={() => void changeOperation(actions.next!)} className={`${buttonClass} bg-red-600`}>Marcar: {operationalLabels[actions.next]}</button>}
          {actions.canCancel && <button disabled={busy} onClick={() => void changeOperation("cancelled")} className={buttonClass}>Registrar cancelación operativa</button>}
        </div></>}
      </section>
      {selected.payment_method === "transfer" && selected.status === "pending_manual_verification" && <section className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4"><h3 className="font-bold">Verificación de transferencia</h3><p className="mt-1 text-sm text-zinc-300">{selected.transfer_declared_at ? `El cliente informó la transferencia el ${date(selected.transfer_declared_at)}.` : "El cliente todavía no informó la transferencia."}</p><div className="mt-4 grid gap-2"><button disabled={busy || !selected.transfer_declared_at} onClick={() => void action("confirm_transfer")} className={`${buttonClass} bg-red-600`}>Confirmar transferencia recibida</button><button disabled={busy} onClick={() => void action("cancel_order")} className={`${buttonClass} text-red-200`}>Cancelar pedido pendiente y liberar reserva</button></div><p className="mt-2 text-xs text-zinc-400">Acciones del flujo de pago existente, separadas de la gestión operativa.</p></section>}
      <section className="mt-5"><h3 className="font-bold">Historial operativo</h3><ol className="mt-3 space-y-2">{selected.operationalHistory.map(entry => <li key={entry.id} className="rounded-xl bg-white/5 p-3 text-sm"><p className="font-bold">{entry.previous_status ? `${operationalLabels[entry.previous_status]} → ` : "Inicio → "}{operationalLabels[entry.new_status]}</p><p className="mt-1 text-xs text-zinc-400">{date(entry.created_at)} · {entry.actor} · {entry.source}</p>{entry.note && <p className="mt-2 whitespace-pre-wrap">{entry.note}</p>}</li>)}</ol></section>
      <section className="mt-5"><h3 className="font-bold">Notas internas</h3><div className="mt-2 space-y-2">{selected.internalNotes.map(item => <div key={item.id} className="rounded-xl bg-white/5 p-3 text-sm"><p>{item.note}</p><small className="text-zinc-500">{date(item.created_at)}</small></div>)}</div><label className="mt-3 block text-sm">Nueva nota<textarea disabled={busy} value={note} onChange={e => setNote(e.target.value)} maxLength={1000} className="mt-2 min-h-20 w-full rounded-xl bg-zinc-900 p-3" /></label><button disabled={busy || !note.trim()} onClick={() => void action("add_note", { note })} className={`mt-2 ${buttonClass}`}>Agregar nota</button></section>
      <details className="mt-5 text-xs text-zinc-400"><summary className="cursor-pointer py-2">Detalle técnico del flujo actual</summary><p className="mt-2">{technicalOrderLabels[selected.status] || selected.status}</p><p className="mt-1 break-all">UUID: {selected.id}</p><p className="mt-1 break-all">Venta: {selected.payment?.sale_id || "Aún no creada"}{selected.payment?.sale_status === "cancelled" ? " · Anulada, requiere revisión" : ""}</p></details>
    </section></div>}
  </div>;
}
