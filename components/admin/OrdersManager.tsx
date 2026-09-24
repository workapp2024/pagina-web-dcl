"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { operationalActions, operationalLabels, paymentLabels, paymentMethodLabels, technicalOrderLabels, type OperationalOrder, type OperationalStatus } from "@/lib/store/order-operations";
import { archiveBlockMessages } from "@/lib/store/order-archive";
import { availableResolutions, refundResolutions, resolutionLabels, type ResolutionType } from "@/lib/store/order-resolutions";

type HistoryEntry = {
  id: number; previous_status: OperationalStatus | null; new_status: OperationalStatus;
  created_at: string; actor: string; source: string; note: string;
  action?: "status_change" | "archive" | "restore";
};
type Order = OperationalOrder & {
  receipt_available?: boolean;
  id: string; order_number: string; total: number; created_at: string; payment_method: string;
  fulfillment_method: "pickup" | "delivery"; shipping_address: string | null;
  notes: string; transfer_declared_at: string | null;
  customer: { full_name: string; phone: string | null; email: string | null } | null;
  items: { product_name: string; quantity: number; line_total: number }[];
  internalNotes: { id: string; note: string; created_at: string }[];
  operationalHistory: HistoryEntry[];
  archived_at: string | null;
  archive_block_reason: string | null;
  payment: { status: string; provider?: string | null; sale_id: string | null; sale_status?: string | null; external_order_id?: string | null; external_payment_id?: string | null } | null;
  resolutions: { id: string; resolution_type: ResolutionType; external_reference: string | null; note: string; actor: string; source: string; created_at: string }[];
};
const money = (value: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number(value));
const date = (value: string) => new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(value));
const fulfillmentLabels = { pickup: "Retiro", delivery: "Entrega a domicilio" };
const filters = [
  { id: "all", label: "Todos" }, { id: "attention", label: "Transferencia / stock pendiente" },
  { id: "pending", label: "Pago pendiente" }, { id: "transfer", label: "Transferencias a verificar" },
  { id: "paid", label: "Pagos aprobados e incidencias" }, { id: "delivery", label: "Entregas pendientes con pago" },
  { id: "completed", label: "Venta registrada" }, { id: "cancelled", label: "Cancelación / rechazo registrado" },
];
const buttonClass = "min-h-11 rounded-xl border border-white/15 px-4 py-2 text-sm font-bold disabled:opacity-40";

export function OrdersManager() {
  const [rows, setRows] = useState<Order[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [operational, setOperational] = useState("all");
  const [period, setPeriod] = useState("all");
  const [view, setView] = useState<"active" | "archived">("active");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Order | null>(null);
  const [note, setNote] = useState("");
  const [operationNote, setOperationNote] = useState("");
  const [resolution, setResolution] = useState<ResolutionType | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [externalReference, setExternalReference] = useState("");
  const [resolutionKey, setResolutionKey] = useState("");
  const [resolutionAttempted, setResolutionAttempted] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    const version = ++latest.current;
    setLoading(true);
    try {
      const response = await fetch("/api/admin/orders?" + new URLSearchParams({ q, status, operational, period, view, page: String(page), limit: "50" }));
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
  }, [q, status, operational, period, view, page]);
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
    if (name === "archive" && !window.confirm("Este pedido dejará de aparecer entre los pedidos activos. No se eliminará y podrás restaurarlo.")) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const endpoint = ["archive", "restore"].includes(name) ? "/api/admin/orders/archive" : name === "operational" ? "/api/admin/orders/operational-status" : "/api/admin/orders";
      const response = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: name, orderId: selected.id, ...payload }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo completar la acción.");
      setNote(""); setOperationNote(""); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo completar la acción."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function openResolution(type: ResolutionType) {
    if (!selected || !availableResolutions(selected).includes(type)) return;
    setResolution(type); setResolutionNote(""); setExternalReference("");
    setResolutionKey(crypto.randomUUID()); setResolutionAttempted(false); setError("");
  }
  async function submitResolution() {
    if (!selected || !resolution || inFlight.current || !resolutionNote.trim()
      || (refundResolutions.includes(resolution) && !externalReference.trim())) return;
    inFlight.current = true; setBusy(true); setResolutionAttempted(true); setError("");
    try {
      const response = await fetch("/api/admin/orders/resolve", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: selected.id, resolutionType: resolution,
          externalReference: externalReference.trim(), note: resolutionNote.trim(), idempotencyKey: resolutionKey }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo resolver el pedido.");
      setResolution(null); setResolutionKey(""); setResolutionAttempted(false); setResolutionNote(""); setExternalReference("");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo resolver el pedido."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const actions = selected ? operationalActions(selected) : null;
  const changeOperation = (target: OperationalStatus) => selected && action("operational", {
    expectedStatus: selected.operational_status, status: target, note: operationNote,
  });
  function switchView(next: "active" | "archived") {
    if (inFlight.current || next === view) return;
    latest.current++;
    setView(next); setSelected(null); setRows([]); setTotal(0); setPage(1);
    setStatus("all"); setOperational("all"); setPeriod("all"); setError("");
    setNote(""); setOperationNote("");
    setResolution(null); setResolutionKey(""); setResolutionAttempted(false); setResolutionNote(""); setExternalReference("");
  }

  return <div className="space-y-5">
    <header><h1 className="text-3xl font-black">Pedidos</h1><p className="mt-2 text-sm text-zinc-400">Gestioná preparación y entrega. El pago se muestra por separado.</p></header>
    <nav aria-label="Organización de pedidos" className="flex gap-2"><button disabled={busy} aria-pressed={view === "active"} onClick={() => switchView("active")} className={`${buttonClass} ${view === "active" ? "bg-red-600" : ""}`}>Pedidos activos</button><button disabled={busy} aria-pressed={view === "archived"} onClick={() => switchView("archived")} className={`${buttonClass} ${view === "archived" ? "bg-red-600" : ""}`}>Ver archivados</button></nav>
    {view === "archived" && <p className="text-sm text-zinc-400">Pedidos archivados. Conservan sus datos y pueden restaurarse.</p>}
    <div className={`grid gap-3 sm:grid-cols-2 ${view === "active" ? "lg:grid-cols-4" : ""}`}>
      <label className="text-sm">Buscar pedido<input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="DCL-000001, cliente, teléfono, producto o UUID" className="mt-1 w-full rounded-xl bg-zinc-900 p-3" /></label>
      {view === "active" && <><label className="text-sm">Estado del pedido<select value={operational} onChange={e => { setOperational(e.target.value); setPage(1); }} className="mt-1 w-full rounded-xl bg-zinc-900 p-3"><option value="all">Todos los estados operativos</option>{Object.entries(operationalLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm">Pago / revisión<select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className="mt-1 w-full rounded-xl bg-zinc-900 p-3">{filters.map(filter => <option key={filter.id} value={filter.id}>{filter.label}</option>)}</select></label></>}
      <label className="text-sm">Fecha<select value={period} onChange={e => { setPeriod(e.target.value); setPage(1); }} className="mt-1 w-full rounded-xl bg-zinc-900 p-3"><option value="today">Hoy</option><option value="week">Últimos 7 días</option><option value="month">Últimos 30 días</option><option value="all">Todas las fechas</option></select></label>
    </div>
    <button disabled={busy || loading} onClick={() => void load()} className={buttonClass}>{loading ? "Actualizando…" : "Actualizar pedidos"}</button>
    {status === "completed" && <p className="text-sm text-amber-200">Venta registrada indica confirmación comercial del flujo actual; no acredita entrega.</p>}
    {error && !selected && <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
    <div className="space-y-3">{rows.map(row => <button key={row.id} onClick={() => { setSelected(row); setResolution(null); setResolutionKey(""); setNote(""); setOperationNote(""); }} className="w-full rounded-2xl border border-white/10 p-4 text-left hover:border-red-500/40">
      <div className="flex flex-wrap justify-between gap-3"><div><b>{row.order_number} · {row.customer?.full_name || "Cliente"}</b><small className="mt-1 block text-zinc-400">{row.customer?.phone || "Sin teléfono"} · {date(row.created_at)}</small></div><b>{money(row.total)}</b></div>
      <p className="mt-3 text-sm text-zinc-300">{row.items.map(item => `${item.product_name} × ${item.quantity}`).join(" · ")}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-sm"><span className="rounded-lg bg-white/10 px-3 py-2">Operativo: <b>{operationalLabels[row.operational_status]}</b></span><span className="rounded-lg bg-white/5 px-3 py-2">Pedido: <b>{technicalOrderLabels[row.status] || row.status}</b></span><span className="rounded-lg bg-white/5 px-3 py-2">Pago: <b>{paymentLabels[row.payment?.status || ""] || "Sin transacción"}</b></span></div>
      <p className="mt-2 text-xs text-zinc-400">{paymentMethodLabels[row.payment_method]} · {fulfillmentLabels[row.fulfillment_method]}</p>
      {row.status === "stock_unavailable" && <p className="mt-2 text-sm text-amber-200">Pago aprobado sin venta: requiere stock disponible o reembolso externo.</p>}
      {row.status === "refund_required" && <p className="mt-2 text-sm font-semibold text-amber-200">Incidencia financiera: pago aprobado tras cancelar. Requiere reembolso externo.</p>}
      {row.status === "refunded" && <p className="mt-2 text-sm text-emerald-200">Pedido reembolsado y conciliado.</p>}
      {["cancelled", "rejected"].includes(row.status) && row.operational_status !== "cancelled" && <p className="mt-2 text-sm text-amber-200">Cancelación o rechazo registrado en el flujo de pago; pendiente de revisión operativa.</p>}
    </button>)}{!rows.length && !loading && <p className="py-8 text-center text-sm text-zinc-500">No hay pedidos para estos filtros.</p>}</div>
    <nav aria-label="Paginación" className="flex flex-wrap items-center justify-between gap-3"><button disabled={loading || page === 1} onClick={() => setPage(p => p - 1)} className={buttonClass}>Anterior</button><span className="text-sm">Página {page} de {Math.max(1, Math.ceil(total / 50))} · {total} pedidos</span><button disabled={loading || page * 50 >= total} onClick={() => setPage(p => p + 1)} className={buttonClass}>Siguiente</button></nav>
    {selected && actions && <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 p-3 sm:p-5"><section role="dialog" aria-modal="true" aria-labelledby="order-title" className="mx-auto max-w-2xl rounded-3xl bg-zinc-950 p-5 sm:p-6">
      <button disabled={busy} onClick={() => { setSelected(null); setResolution(null); }} className="float-right min-h-11 px-2 text-zinc-400">Cerrar</button>
      <p className="text-xs font-bold uppercase tracking-widest text-red-300">Pedido</p><h2 id="order-title" className="text-2xl font-black">{selected.order_number}</h2><p className="mt-1 text-sm text-zinc-400">{date(selected.created_at)}</p>
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
      <div className="mt-5 rounded-2xl bg-white/5 p-4"><b>{selected.customer?.full_name}</b><p className="text-sm text-zinc-300">{selected.customer?.phone || "Sin teléfono"}</p><p className="text-sm text-zinc-400">{selected.customer?.email || "Sin email"}</p></div>
      <div className="mt-5 space-y-2">{selected.items.map((item, index) => <p key={index} className="flex justify-between gap-3"><span>{item.product_name} × {item.quantity}</span><b>{money(item.line_total)}</b></p>)}</div>
      <p className="mt-5 text-xl font-black">Total {money(selected.total)}</p>
      <dl className="mt-5 grid gap-3 rounded-2xl border border-white/10 p-4 text-sm">
        <div><dt className="text-zinc-400">Estado operativo</dt><dd className="font-bold">{operationalLabels[selected.operational_status]}</dd></div>
        <div><dt className="text-zinc-400">Estado técnico del pedido</dt><dd className="font-bold">{technicalOrderLabels[selected.status] || selected.status}</dd></div>
        <div><dt className="text-zinc-400">Estado del pago</dt><dd className="font-bold">{paymentLabels[selected.payment?.status || ""] || "Sin transacción"} · {paymentMethodLabels[selected.payment_method]}</dd></div>
        <div><dt className="text-zinc-400">Venta vinculada</dt><dd className="break-all">{selected.payment?.sale_id ? `${selected.payment.sale_id} · ${selected.payment.sale_status || "Estado no disponible"}` : "Sin venta"}</dd>
          {selected.receipt_available === true && /^DCL-[0-9]{6,19}$/.test(selected.order_number) && <a href={`/admin/pedidos/${selected.order_number}/comprobante`} target="_blank" rel="noopener noreferrer" className={`mt-3 inline-flex items-center ${buttonClass}`}>Ver comprobante</a>}
        </div>
        <div><dt className="text-zinc-400">Pago y proveedor</dt><dd className="break-all">{selected.payment?.provider || "Sin proveedor"}{selected.payment?.external_payment_id && ` · Pago: ${selected.payment.external_payment_id}`}{selected.payment?.external_order_id && ` · Orden externa: ${selected.payment.external_order_id}`}</dd></div>
        <div><dt className="text-zinc-400">Modalidad</dt><dd>{fulfillmentLabels[selected.fulfillment_method]}{selected.shipping_address && ` · ${selected.shipping_address}`}</dd></div>
        {selected.notes && <div><dt className="text-zinc-400">Observaciones del pedido</dt><dd>{selected.notes}</dd></div>}
      </dl>
      {selected.status === "refund_required" && <p className="mt-4 border-l-2 border-amber-400 pl-3 text-sm text-amber-100">Pago aprobado después de cancelar el pedido. Requiere reembolso externo y conciliación.</p>}
      {selected.status === "stock_unavailable" && <p className="mt-4 border-l-2 border-amber-400 pl-3 text-sm text-amber-100">Pago aprobado sin venta por falta de stock reservado.</p>}
      {selected.status === "refunded" && <p className="mt-4 text-sm text-emerald-200">Reembolso conciliado. No hay nuevas acciones de resolución.</p>}
      {selected.operational_status === "delivered" && <p className="mt-4 text-sm text-zinc-300">Las devoluciones de pedidos ya entregados se gestionarán mediante el flujo de postventa.</p>}
      {!selected.archived_at && availableResolutions(selected).length > 0 && <section className="mt-5 border-t border-white/10 pt-4"><h3 className="font-bold">Resolución del pedido</h3><div className="mt-3 flex flex-wrap gap-2">{availableResolutions(selected).map(type => <button key={type} disabled={busy} onClick={() => openResolution(type)} className={`${buttonClass} ${type === "REFUND_STOCK_UNAVAILABLE" && selected.status === "refund_required" ? "border-amber-400 text-amber-100" : ""}`}>{resolutionLabels[type]}</button>)}</div></section>}
      <section className="mt-5 rounded-2xl border border-white/10 p-4"><h3 className="font-bold">Organización del pedido</h3>
        {selected.archived_at ? <><p className="mt-2 text-sm text-zinc-400">Archivado el {date(selected.archived_at)}.</p><button disabled={busy} onClick={() => void action("restore", { archive: false })} className={`mt-3 ${buttonClass}`}>Restaurar pedido</button></>
          : selected.archive_block_reason === null ? <button disabled={busy} onClick={() => void action("archive", { archive: true })} className={`mt-3 ${buttonClass}`}>Archivar pedido</button>
            : <p className="mt-2 text-sm text-zinc-400">{archiveBlockMessages[selected.archive_block_reason || ""] || "Este pedido requiere revisión antes de archivarse."}</p>}
      </section>
      <section className="mt-5 rounded-2xl border border-white/10 p-4"><h3 className="font-bold">Gestión operativa</h3>
        <p className="mt-2 text-sm text-zinc-400">Estos cambios registran preparación y entrega; no modifican pagos ni stock.</p>
        {actions.financialReview && selected.operational_status !== "cancelled" && <p className="mt-3 text-sm text-amber-200">Una cancelación requiere revisión financiera o devolución. No puede resolverse cambiando el estado operativo.</p>}
        {!actions.terminal && !actions.next && !actions.canCancel && <p className="mt-3 text-sm text-zinc-300">Para avanzar se requiere pago aprobado y venta vigente. Para marcar cancelado, primero debe estar resuelto el pago por el flujo actual.</p>}
        {(actions.next || actions.canCancel) && <><label className="mt-4 block text-sm">Motivo o nota del cambio (opcional)<textarea disabled={busy} value={operationNote} onChange={e => setOperationNote(e.target.value)} maxLength={1000} className="mt-2 min-h-20 w-full rounded-xl bg-zinc-900 p-3" /></label><div className="mt-3 flex flex-wrap gap-2">
          {actions.next && <button disabled={busy} onClick={() => void changeOperation(actions.next!)} className={`${buttonClass} bg-red-600`}>Marcar: {operationalLabels[actions.next]}</button>}
          {actions.canCancel && <button disabled={busy} onClick={() => void changeOperation("cancelled")} className={buttonClass}>Registrar cancelación operativa</button>}
        </div></>}
      </section>
      {selected.payment_method === "transfer" && selected.status === "pending_manual_verification" && <section className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4"><h3 className="font-bold">Verificación de transferencia</h3><p className="mt-1 text-sm text-zinc-300">{selected.transfer_declared_at ? `El cliente informó la transferencia el ${date(selected.transfer_declared_at)}.` : "El cliente todavía no informó la transferencia."}</p><button disabled={busy || !selected.transfer_declared_at} onClick={() => void action("confirm_transfer")} className={`mt-4 ${buttonClass} bg-red-600`}>Confirmar transferencia recibida</button></section>}
      {selected.resolutions?.length > 0 && <section className="mt-5"><h3 className="font-bold">Resoluciones</h3><ol className="mt-3 space-y-2">{selected.resolutions.map(entry => <li key={entry.id} className="rounded-lg bg-white/5 p-3 text-sm"><b>{resolutionLabels[entry.resolution_type] || entry.resolution_type}</b><p className="mt-1 text-xs text-zinc-400">{date(entry.created_at)} · {entry.actor} · {entry.source}</p>{entry.external_reference && <p className="mt-2 break-all">Referencia: {entry.external_reference}</p>}<p className="mt-2 whitespace-pre-wrap">{entry.note}</p></li>)}</ol></section>}
      <section className="mt-5"><h3 className="font-bold">Historial operativo</h3><ol className="mt-3 space-y-2">{selected.operationalHistory.map(entry => <li key={entry.id} className="rounded-xl bg-white/5 p-3 text-sm"><p className="font-bold">{entry.action === "archive" ? "Pedido archivado" : entry.action === "restore" ? "Pedido restaurado" : <>{entry.previous_status ? `${operationalLabels[entry.previous_status]} → ` : "Inicio → "}{operationalLabels[entry.new_status]}</>}</p><p className="mt-1 text-xs text-zinc-400">{date(entry.created_at)} · {entry.actor} · {entry.source}</p>{entry.note && <p className="mt-2 whitespace-pre-wrap">{entry.note}</p>}</li>)}</ol></section>
      <section className="mt-5"><h3 className="font-bold">Notas internas</h3><div className="mt-2 space-y-2">{selected.internalNotes.map(item => <div key={item.id} className="rounded-xl bg-white/5 p-3 text-sm"><p>{item.note}</p><small className="text-zinc-500">{date(item.created_at)}</small></div>)}</div><label className="mt-3 block text-sm">Nueva nota<textarea disabled={busy} value={note} onChange={e => setNote(e.target.value)} maxLength={1000} className="mt-2 min-h-20 w-full rounded-xl bg-zinc-900 p-3" /></label><button disabled={busy || !note.trim()} onClick={() => void action("add_note", { note })} className={`mt-2 ${buttonClass}`}>Agregar nota</button></section>
      <details className="mt-5 text-xs text-zinc-400"><summary className="cursor-pointer py-2">Identificador técnico</summary><p className="mt-2 break-all">UUID: {selected.id}</p></details>
    </section></div>}
    {selected && resolution && <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/90 p-4"><section role="dialog" aria-modal="true" aria-labelledby="resolution-title" className="w-full max-w-lg rounded-lg border border-white/15 bg-zinc-950 p-5">
      <h2 id="resolution-title" className="text-lg font-bold">{resolutionLabels[resolution]}</h2>
      <p className="mt-2 text-sm text-zinc-300">{refundResolutions.includes(resolution) ? "Esta acción no devuelve dinero automáticamente. Usala únicamente después de realizar y verificar el reembolso total por el medio de pago correspondiente." : resolution === "TRANSFER_APPROVAL_ERROR" ? "Sólo cuando la transferencia fue aprobada por error y no hubo un pago que devolver." : resolution === "COMPLETE_STOCK_UNAVAILABLE" ? "El cliente ya pagó. Se volverá a verificar el stock actual y, si alcanza, se completará la venta sin volver a cobrar." : "Se cancelará el pedido no cobrado y se liberará su reserva."}</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-200">{error}</p>}
      {refundResolutions.includes(resolution) && <label className="mt-4 block text-sm">Referencia externa del reembolso<input disabled={busy || resolutionAttempted} value={externalReference} onChange={e => setExternalReference(e.target.value)} maxLength={160} className="mt-1 w-full rounded-lg bg-zinc-900 p-3" /></label>}
      <label className="mt-4 block text-sm">Motivo o nota administrativa<textarea disabled={busy || resolutionAttempted} value={resolutionNote} onChange={e => setResolutionNote(e.target.value)} maxLength={1000} className="mt-1 min-h-24 w-full rounded-lg bg-zinc-900 p-3" /></label>
      <div className="mt-5 flex justify-end gap-2"><button disabled={busy} onClick={() => { setResolution(null); setResolutionKey(""); setResolutionAttempted(false); setError(""); }} className={buttonClass}>Volver</button><button disabled={busy || !resolutionNote.trim() || (refundResolutions.includes(resolution) && !externalReference.trim())} onClick={() => void submitResolution()} className={`${buttonClass} bg-red-600`}>{busy ? "Registrando…" : resolutionAttempted ? "Reintentar el mismo intento" : "Confirmar acción"}</button></div>
    </section></div>}
  </div>;
}
