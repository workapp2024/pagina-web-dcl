/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { wholesaleAdminLabel, wholesaleNextAction } from "@/lib/admin-order-attention";
import { WholesaleConfirmation } from "@/components/admin/WholesaleConfirmation";
import { WholesaleOrderLedger } from "@/components/admin/WholesaleOrderLedger";
import {
  getWholesaleAdvancePercent,
  getWholesaleAdvancePreview,
  parseWholesalePaymentTerms,
  serializeWholesalePaymentTerms,
  type WholesalePaymentTermsDraft,
} from "@/lib/wholesale-commercial-conditions";

type WholesaleProduct = {
  id: string;
  name: string;
  category: string;
  connectorType: string | null;
  wholesalePrice: number;
};
type Order = {
  id: string;
  orderNumber: string;
  revisionStatus?: string;
  customerName: string;
  status: string;
  createdAt: string;
  total: number | null;
  currency: string | null;
};
type RevisionItem = {
  productId: string;
  name: string;
  category: string | null;
  connectorType: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  currency: string;
};
type Revision = {
  id: string;
  version_number: number;
  status: string;
  requires_customer_approval: boolean;
  commercial_conditions: string;
  totalAmount: number;
  currency: string;
  items: RevisionItem[];
};
type Detail = {
  id: string;
  orderNumber: string;
  customer: string;
  status: string;
  createdAt: string;
  confirmedAt: string | null;
  revision: Revision;
  originalRevision: Pick<Revision, "id" | "version_number" | "status" | "commercial_conditions" | "totalAmount" | "currency" | "items"> | null;
  events: { id: number; type: string; actor: string; channel: string; createdAt: string }[];
  deliveryProgress: { productId: string; ordered: number; delivered: number; reservedRemaining: number }[];
  deliveries: { id: string; revisionId: string; deliveredAt: string; items: { productId: string; quantity: number }[] }[];
};
type DraftItem = { productId: string; quantity: number };
type Filters = { status: string; customer: string; from: string; to: string };
type Action = "start_review" | "propose" | "confirm" | "reject" | "deliver";

const labels: Record<string, string> = {
  received: "Recibida", in_review: "En revisión", awaiting_customer: "Espera al cliente",
  confirmed: "Confirmada", rejected: "Rechazada", cancelled: "Cancelada",
  draft: "Borrador", ready_for_confirmation: "Lista para confirmar", approved: "Aprobada",
  awaiting_customer_status: "En espera del cliente", order_created: "Solicitud recibida",
  review_started: "Revisión iniciada", revision_created: "Revisión creada",
  revision_proposed: "Propuesta enviada", revision_approved: "Propuesta aprobada",
  revision_rejected: "Cliente rechazó la propuesta",
  order_confirmed: "Solicitud confirmada", order_rejected: "Solicitud rechazada",
  order_cancelled: "Solicitud cancelada",
};
const money = (value: number, currency = "ARS") =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: currency.trim() }).format(value);
const when = (value: string) => new Date(value).toLocaleString("es-AR");
const buttonClass = "min-h-11 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold transition hover:border-white/30 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50";
const inputClass = "mt-1 min-h-11 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/70";

function createIdempotencyKey() {
  const bytes = new Uint8Array(16);
  if (!globalThis.crypto?.getRandomValues) throw new Error("Este navegador no permite preparar una clave segura. Recargá la página e intentá nuevamente.");
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function itemLabel(item: RevisionItem) {
  return [item.category, item.connectorType].filter(Boolean).join(" · ");
}

function RevisionCard({ title, revision }: { title: string; revision: Detail["originalRevision"] }) {
  if (!revision) return <section className="min-w-0 rounded-2xl border border-sky-300/20 bg-sky-950/20 p-5"><h3 className="break-words text-lg font-bold text-sky-100 [overflow-wrap:anywhere]">{title}</h3><p className="mt-3 text-sm text-zinc-400">La revisión original no está disponible en este detalle.</p></section>;
  return <section aria-label={title} className="min-w-0 rounded-2xl border border-sky-300/20 bg-gradient-to-b from-sky-950/40 to-zinc-950 p-4 sm:p-5 shadow-lg shadow-black/10">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-300">Pedido original</p><h3 className="mt-1 text-xl font-bold text-white">{title}</h3></div>
      <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-3 py-1 text-xs font-semibold text-sky-200">v{revision.version_number}</span>
    </div>
    <ul className="mt-5 divide-y divide-white/10">
      {revision.items.map(item => <li key={item.productId} className="min-w-0 py-3 first:pt-0 last:pb-0">
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0"><p className="break-words font-semibold text-zinc-100 [overflow-wrap:anywhere]">{item.name}</p><p className="mt-1 break-words text-xs text-zinc-400 [overflow-wrap:anywhere]">Código: <span className="font-mono text-zinc-300">{item.productId}</span>{itemLabel(item) && ` · ${itemLabel(item)}`}</p></div><p className="break-words font-semibold sm:text-right [overflow-wrap:anywhere]">{money(item.lineTotal, item.currency)}</p></div>
        <p className="mt-1 text-sm text-zinc-400">{item.quantity} × {money(item.unitPrice, item.currency)}</p>
      </li>)}
    </ul>
    <div className="mt-5 min-w-0 border-t border-sky-300/15 pt-4"><p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Condiciones originales</p><p className="mt-1 break-words whitespace-pre-wrap text-sm text-zinc-200 [overflow-wrap:anywhere]">{revision.commercial_conditions || "Sin condiciones adicionales"}</p></div>
    <div className="mt-4 flex min-w-0 flex-col justify-between gap-2 rounded-xl bg-sky-300/10 px-4 py-3 sm:flex-row sm:items-center"><span className="text-sm font-semibold text-sky-100">Total original</span><strong className="break-words text-lg text-white [overflow-wrap:anywhere]">{money(revision.totalAmount, revision.currency)}</strong></div>
  </section>;
}

export function WholesaleOrdersManager({ products, catalogError = "" }: { products: WholesaleProduct[]; catalogError?: string }) {
  const [rows, setRows] = useState<Order[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [filters, setFilters] = useState<Filters>({ status: "attention", customer: "", from: "", to: "" });
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [processing, setProcessing] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [actionError, setActionError] = useState("");
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [paymentTermsDraft, setPaymentTermsDraft] = useState<WholesalePaymentTermsDraft>({
    method: "",
    advanceChoice: "30",
    customAdvancePercent: "",
    otherText: "",
  });
  const [internalNote, setInternalNote] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [needsReview, setNeedsReview] = useState(false);
  const [reviewedLatest, setReviewedLatest] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [addQuantity, setAddQuantity] = useState("1");
  const [deliveryQuantities, setDeliveryQuantities] = useState<Record<string, string>>({});
  const [deliveryIdempotencyKey, setDeliveryIdempotencyKey] = useState("");

  const initialOrder = useRef("");
  const listVersion = useRef(0);
  useEffect(() => {
    const number = new URLSearchParams(window.location?.search || "").get("order");
    if (number && /^MW-[0-9]+$/.test(number)) { initialOrder.current = number; setFilters({ status: "all", customer: number, from: "", to: "" }); }
  }, []);

  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const eligibleProducts = useMemo(() => {
    const normalized = productQuery.trim().toLocaleLowerCase("es-AR");
    return products.filter(product => !normalized || [product.name, product.id, product.category, product.connectorType ?? ""]
      .some(value => value.toLocaleLowerCase("es-AR").includes(normalized))).slice(0, 8);
  }, [productQuery, products]);

  const showDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setDetailError("");
    setActionError("");
    setNeedsReview(false);
    setReviewedLatest(false);
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/admin/wholesale-orders/${id}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.message || "No se pudo cargar el detalle.");
      const value = body.data as Detail;
      setDetail(value);
      setDraftItems(value.revision.items.map(item => ({ productId: item.productId, quantity: item.quantity })));
      setPaymentTermsDraft(parseWholesalePaymentTerms(value.revision.commercial_conditions || ""));
      setInternalNote("");
      setIdempotencyKey("");
      setProductQuery("");
      setSelectedProductId("");
      setAddQuantity("1");
      setDeliveryQuantities(Object.fromEntries(value.revision.items.map(item => [item.productId, "0"])));
      setDeliveryIdempotencyKey("");
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : "No se pudo cargar el detalle.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    const version = ++listVersion.current;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ page: String(page), ...filters });
      const response = await fetch(`/api/admin/wholesale-orders?${query}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.message || "No se pudieron cargar las solicitudes.");
      if (version !== listVersion.current) return;
      setRows(body.data);
      const requested = body.data.find((row: Order) => row.orderNumber === initialOrder.current);
      if (requested) { initialOrder.current = ""; await showDetail(requested.id); }
      setTotal(body.pagination.total);
      setPages(body.pagination.totalPages);
      setDetail(current => current && body.data.some((row: Order) => row.id === current.id) ? current : null);
    } catch (cause) {
      if (version === listVersion.current) setError(cause instanceof Error ? cause.message : "No se pudieron cargar las solicitudes.");
    } finally {
      if (version === listVersion.current) setLoading(false);
    }
  }, [page, filters, showDetail]);

  useEffect(() => { const version = listVersion; void load(); return () => { version.current++; }; }, [load]);

  const setFilter = (key: keyof Filters, value: string) => {
    setPage(1);
    setFilters(current => ({ ...current, [key]: value }));
  };

  function updateDraft(index: number, patch: Partial<DraftItem>) {
    setDraftItems(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
    setIdempotencyKey("");
  }

  function addSelectedProduct() {
    const product = productById.get(selectedProductId);
    const quantity = Number(addQuantity);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) return;
    const existing = draftItems.find(item => item.productId === product.id);
    if ((existing && existing.quantity + quantity > 100) || (!existing && draftItems.length >= 50)) return;
    setDraftItems(current => {
      const currentItem = current.find(item => item.productId === product.id);
      if (currentItem) return current.map(item => item.productId === product.id ? { ...item, quantity: item.quantity + quantity } : item);
      return [...current, { productId: product.id, quantity }];
    });
    setIdempotencyKey("");
    setProductQuery("");
    setSelectedProductId("");
    setAddQuantity("1");
  }

  async function performAction(action: Action, extra: Record<string, unknown> = {}) {
    if (!selectedId || processing) return;
    setProcessing(action);
    setActionError("");
    try {
      const response = await fetch(`/api/admin/wholesale-orders/${selectedId}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...extra }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        if (body.error === "WHOLESALE_REVISION_STALE") {
          await showDetail(selectedId);
          setNeedsReview(true);
          setReviewedLatest(false);
          setActionError("La solicitud cambió. Cargamos la revisión vigente; revisá sus artículos y condiciones antes de volver a proponer.");
          return;
        }
        if (body.error === "WHOLESALE_IDEMPOTENCY_CONFLICT") {
          await showDetail(selectedId);
          setNeedsReview(true);
          setReviewedLatest(false);
          setActionError("La clave de operación ya se usó con otros datos. Actualizamos el detalle; revisá la revisión vigente antes de preparar otra propuesta.");
          return;
        }
        if (action === "propose" && response.status >= 500) {
          setActionError("No pudimos confirmar si la propuesta se registró. El borrador se conserva. Volvé a intentar sin editarlo para reutilizar la misma clave; si actualizás el detalle, verificá primero la revisión vigente.");
          return;
        }
        throw new Error(body.message || "No se pudo completar la acción.");
      }
      setIdempotencyKey("");
      setInternalNote("");
      await showDetail(selectedId);
      await load();
    } catch (cause) {
      setActionError(action === "propose"
        ? "No pudimos confirmar si la propuesta se registró. El borrador se conserva. Volvé a intentar sin editarlo para reutilizar la misma clave; si actualizás el detalle, verificá primero la revisión vigente."
        : cause instanceof Error ? cause.message : "No se pudo completar la acción. Intentá nuevamente.");
    } finally {
      setProcessing(null);
    }
  }

  const canPropose = detail && ["in_review", "awaiting_customer"].includes(detail.status) && detail.revision.status !== "approved";
  const canReject = detail && ["received", "in_review", "awaiting_customer"].includes(detail.status);
  const canConfirm = detail && detail.status === "in_review" &&
    (detail.revision.requires_customer_approval
      ? detail.revision.status === "approved"
      : detail.revision.status === "ready_for_confirmation");
  const estimatedLines = detail ? draftItems.map(item => {
    const catalogProduct = productById.get(item.productId);
    const snapshot = detail.revision.items.find(candidate => candidate.productId === item.productId);
    const unitPrice = catalogProduct?.wholesalePrice ?? snapshot?.unitPrice ?? null;
    return { ...item, product: catalogProduct, snapshot, unitPrice, lineTotal: unitPrice === null ? null : Math.round(unitPrice * item.quantity * 100) / 100 };
  }) : [];
  const estimatedTotalAvailable = estimatedLines.every(item => item.product && item.unitPrice !== null && Number.isFinite(item.lineTotal));
  const estimatedTotal = estimatedTotalAvailable ? estimatedLines.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0) : null;
  const commercialConditions = serializeWholesalePaymentTerms(paymentTermsDraft);
  const advancePercent = getWholesaleAdvancePercent(paymentTermsDraft);
  const advancePreview = estimatedTotal !== null && advancePercent !== null
    ? getWholesaleAdvancePreview(estimatedTotal, advancePercent)
    : null;
  const draftQuantities = new Map<string, number>();
  for (const item of draftItems) draftQuantities.set(item.productId, (draftQuantities.get(item.productId) ?? 0) + item.quantity);
  const validDraft = draftItems.length > 0 && draftItems.length <= 50 && estimatedLines.every(item =>
    item.product && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 100) &&
    [...draftQuantities.values()].every(quantity => quantity <= 100);
  const validAddQuantity = Number.isInteger(Number(addQuantity)) && Number(addQuantity) >= 1 && Number(addQuantity) <= 100;
  const deliveryItems = (detail?.deliveryProgress ?? []).map(progress => ({ productId: progress.productId, quantity: Number(deliveryQuantities[progress.productId] ?? "0"), progress }))
    .filter(item => item.quantity > 0);
  const validDelivery = deliveryItems.length > 0 && deliveryItems.every(item => Number.isInteger(item.quantity) && item.quantity <= item.progress.reservedRemaining && item.quantity + item.progress.delivered <= item.progress.ordered);

  return <main className="mx-auto min-w-0 w-full max-w-[1680px] space-y-7 px-1 pb-10">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-bold uppercase tracking-[0.24em] text-red-300">Administración · Ventas B2B</p><h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Pedidos mayoristas</h1></div>
      <p className="max-w-xl text-sm leading-6 text-zinc-400">Revisá cada solicitud, compará la versión original con la propuesta y confirmá cuando corresponda. Confirmar no registra pagos ni entregas.</p>
    </header>

    <section aria-label="Filtros" className="grid gap-3 rounded-2xl border border-white/10 bg-zinc-900/50 p-4 sm:grid-cols-2 xl:grid-cols-4">
      <label className="text-xs font-semibold text-zinc-400">Estado<select className={inputClass} value={filters.status} onChange={event => setFilter("status", event.target.value)}><option value="attention">Revisión y confirmación de DCL</option><option value="all">Todos</option>{Object.entries(labels).filter(([key]) => ["received", "in_review", "awaiting_customer", "confirmed", "rejected", "cancelled"].includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="text-xs font-semibold text-zinc-400">Cliente o n?mero<input className={inputClass} placeholder="Cliente o MW-000001" value={filters.customer} onChange={event => setFilter("customer", event.target.value)} /></label>
      <label className="text-xs font-semibold text-zinc-400">Desde<input type="date" className={inputClass} value={filters.from} onChange={event => setFilter("from", event.target.value)} /></label>
      <label className="text-xs font-semibold text-zinc-400">Hasta<input type="date" className={inputClass} value={filters.to} onChange={event => setFilter("to", event.target.value)} /></label>
    </section>

    {error && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-950/60 p-4 text-red-200">{error}</p>}
    {loading ? <p role="status" className="rounded-2xl border border-white/10 p-8 text-center text-zinc-400">Cargando solicitudes…</p> : rows.length === 0 ? <p className="rounded-2xl border border-white/10 p-8 text-center text-zinc-400">No hay solicitudes para estos filtros.</p> : <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(230px,0.26fr)_minmax(0,1fr)]">
      <aside aria-label="Solicitudes" className={`min-w-0 ${detail ? "hidden space-y-2 xl:block" : "space-y-2"}`}>
        <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">Solicitudes</h2><span className="text-xs text-zinc-500">{total} total</span></div>
        {rows.map(row => <button key={row.id} type="button" disabled={Boolean(processing)} onClick={() => void showDetail(row.id)} aria-pressed={detail?.id === row.id} className={`w-full border-b px-2 py-4 text-left transition disabled:opacity-50 ${detail?.id === row.id ? "border-red-400/60 bg-red-950/30" : "border-white/10 hover:bg-white/5"}`}>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2"><b className="break-words [overflow-wrap:anywhere] text-sm">{row.orderNumber}</b><span className={`max-w-full break-words rounded-lg px-2.5 py-1 text-xs ${row.status === "in_review" && row.revisionStatus === "approved" ? "bg-amber-300/15 font-bold text-amber-100 ring-1 ring-amber-300/30" : "bg-white/5 text-zinc-300"}`}>{wholesaleAdminLabel(row.status, row.revisionStatus)}</span></div>
          <p className="mt-2 break-words text-sm text-zinc-300 [overflow-wrap:anywhere]">{row.customerName}</p>
          <div className="mt-3 flex min-w-0 flex-wrap items-end justify-between gap-2"><b className="max-w-full break-words text-base [overflow-wrap:anywhere]">{row.total == null ? "Total no disponible" : money(row.total, row.currency || "ARS")}</b><time className="break-words text-right text-[11px] text-zinc-500">{when(row.createdAt)}</time></div>
        </button>)}
        <div className="flex items-center justify-between gap-2 pt-2 text-xs text-zinc-400"><span>Página {page} de {pages}</span><div className="flex gap-2"><button className={buttonClass} disabled={page <= 1 || loading || Boolean(processing)} onClick={() => setPage(value => value - 1)}>Anterior</button><button className={buttonClass} disabled={page >= pages || loading || Boolean(processing)} onClick={() => setPage(value => value + 1)}>Siguiente</button></div></div>
      </aside>

      <section aria-label="Detalle de solicitud y cronología" className="min-w-0 max-w-full rounded-3xl border border-white/10 bg-zinc-900/35 p-4 sm:p-6 xl:p-7">
        {detailLoading ? <p role="status" className="p-8 text-center text-zinc-400">Cargando detalle…</p> : detailError ? <p role="alert" className="text-red-200">{detailError}</p> : !detail ? <p className="py-14 text-center text-zinc-400">Seleccioná una solicitud para comparar sus revisiones y ver la cronología.</p> : <>
          <button type="button" onClick={() => { setDetail(null); setSelectedId(""); setDetailError(""); }} className={`${buttonClass} mb-4 xl:hidden`}>← Volver a solicitudes</button>
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
            <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">Solicitud · {detail.customer}</p><h2 className="mt-1 text-2xl font-black sm:text-3xl">{detail.orderNumber}</h2><p className="mt-2 text-sm text-zinc-400">Recibida {when(detail.createdAt)} · {detail.confirmedAt ? `Confirmada ${when(detail.confirmedAt)}` : "Aún no confirmada"}</p></div>
            <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold">{wholesaleAdminLabel(detail.status, detail.revision.status)}</span>
          </header>

          <p className="mt-4 rounded-xl border border-amber-300/20 p-4 text-sm text-amber-100">Próxima acción: {wholesaleNextAction(detail.status, detail.revision.status, !detail.deliveryProgress.length || detail.deliveryProgress.some(item => item.delivered < item.ordered))}</p>
          <section aria-label="Resumen vigente" className="my-5 rounded-2xl border border-emerald-300/20 bg-emerald-950/20 p-4 sm:p-5">
            <div className="flex min-w-0 flex-col justify-between gap-4 sm:flex-row sm:items-start"><div className="min-w-0 flex-1"><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300">Revisión vigente · v{detail.revision.version_number}</p><p className="mt-1 text-sm text-zinc-300">{labels[detail.revision.status] || detail.revision.status}</p><p className="mt-2 break-words text-xs text-zinc-400 [overflow-wrap:anywhere]">Condiciones vigentes: {detail.revision.commercial_conditions || "Sin condiciones adicionales"}</p></div><div className="max-w-full rounded-xl bg-emerald-300/10 px-4 py-3 sm:shrink-0 sm:text-right"><p className="text-xs text-emerald-100/70">Total vigente · servidor</p><strong className="break-words text-2xl font-black text-white [overflow-wrap:anywhere]">{money(detail.revision.totalAmount, detail.revision.currency)}</strong></div></div>
            <div className="mt-4 border-t border-emerald-300/10 pt-3"><p className="text-xs font-semibold uppercase tracking-wide text-emerald-100/70">Artículos vigentes</p><ul className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2">{detail.revision.items.map(item => <li key={item.productId} className="grid min-w-0 grid-cols-1 gap-2 rounded-lg bg-black/15 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto]"><span className="min-w-0"><b className="block break-words text-zinc-100 [overflow-wrap:anywhere]">{item.name}</b><span className="break-words text-xs text-zinc-400 [overflow-wrap:anywhere]">Código {item.productId} · {item.quantity} × {money(item.unitPrice, item.currency)}</span></span><span className="break-words font-semibold sm:text-right [overflow-wrap:anywhere]">{money(item.lineTotal, item.currency)}</span></li>)}</ul></div>
          </section>

          <div className="grid min-w-0 items-start gap-5 min-[1600px]:grid-cols-2">
            <RevisionCard title="Condiciones y artículos recibidos" revision={detail.originalRevision} />

            {canPropose ? <details className="min-w-0"><summary className="min-h-11 cursor-pointer py-3 font-semibold text-amber-200">Preparar una propuesta</summary><section aria-label="Propuesta en edición" className="min-w-0 rounded-2xl border border-amber-300/30 bg-gradient-to-b from-amber-950/25 to-zinc-950 p-4 sm:p-5 shadow-lg shadow-black/10">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">Borrador administrativo</p><h3 className="mt-1 text-xl font-bold">Propuesta en edición</h3></div><span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs text-amber-100">No enviada</span></div>
              <p className="mt-2 text-sm leading-6 text-zinc-400">El total mostrado es una estimación con el catálogo cargado. Al enviar, el servidor vuelve a validar productos y precios.</p>

              <div className="mt-5 space-y-2">
                {draftItems.length === 0 ? <p className="rounded-xl border border-dashed border-white/15 p-4 text-sm text-zinc-500">Todavía no hay artículos en la propuesta.</p> : draftItems.map((item, index) => {
                  const line = estimatedLines[index];
                  const name = line.product?.name ?? line.snapshot?.name ?? "Producto sin disponibilidad en catálogo";
                  const description = line.product ? [line.product.category, line.product.connectorType].filter(Boolean).join(" · ") : [line.snapshot?.category, line.snapshot?.connectorType].filter(Boolean).join(" · ");
                  return <div key={item.productId} className="grid min-w-0 gap-3 rounded-xl border border-white/10 bg-black/20 p-3 min-[1600px]:grid-cols-[minmax(0,1fr)_6rem_auto] min-[1600px]:items-center">
                    <div className="min-w-0"><p className="break-words font-semibold text-white [overflow-wrap:anywhere]">{name}</p><p className="mt-1 break-words text-xs text-zinc-400 [overflow-wrap:anywhere]">Código: <span className="font-mono text-zinc-300">{item.productId}</span>{description && ` · ${description}`}</p>{!line.product && <p className="mt-1 text-xs text-amber-200">No disponible para una nueva propuesta; quitá el artículo o elegí otro del catálogo.</p>}</div>
                    <label className="text-xs text-zinc-400">Cantidad<input aria-label={`Cantidad de ${name}`} type="number" inputMode="numeric" min={1} max={100} step={1} disabled={Boolean(processing)} className={inputClass} value={item.quantity} onChange={event => updateDraft(index, { quantity: event.target.value === "" ? 0 : Number(event.target.value) })} /></label>
                    <button type="button" className={`${buttonClass} w-full text-red-200 min-[1600px]:w-auto`} aria-label={`Quitar ${name}`} disabled={Boolean(processing)} onClick={() => { setDraftItems(current => current.filter((_, itemIndex) => itemIndex !== index)); setIdempotencyKey(""); }}>Quitar</button>
                    <div className="flex min-w-0 flex-wrap justify-between gap-2 text-xs text-zinc-400 min-[1600px]:col-span-3"><span>{line.unitPrice === null ? "Precio no disponible" : `${item.quantity} × ${money(line.unitPrice, detail.revision.currency)}`}</span><b className="break-words text-sm text-zinc-200 [overflow-wrap:anywhere]">{line.lineTotal === null ? "Subtotal no disponible" : money(line.lineTotal, detail.revision.currency)}</b></div>
                  </div>;
                })}
              </div>

              <div className="mt-5 rounded-2xl border border-white/10 bg-zinc-900/60 p-4">
                <h4 className="font-semibold">Agregar producto del catálogo</h4>
                {catalogError ? <p role="alert" className="mt-2 text-sm text-red-200">{catalogError}</p> : <>
                  <label className="mt-3 block text-xs font-semibold text-zinc-400">Buscar por nombre, código, categoría o conector<input className={inputClass} autoComplete="off" value={productQuery} onChange={event => { setProductQuery(event.target.value); setSelectedProductId(""); }} placeholder="Ej.: S6 HD, s6-hd o H7" /></label>
                  <div role="listbox" aria-label="Productos disponibles" className="mt-2 max-h-64 space-y-2 overflow-y-auto">
                    {eligibleProducts.length ? eligibleProducts.map(product => <button key={product.id} type="button" role="option" aria-selected={selectedProductId === product.id} disabled={Boolean(processing)} onClick={() => { setSelectedProductId(product.id); setProductQuery(product.name); }} className={`w-full rounded-xl border p-3 text-left transition ${selectedProductId === product.id ? "border-amber-300/60 bg-amber-300/10" : "border-white/10 bg-black/20 hover:border-white/25"}`}>
                      <span className="flex min-w-0 flex-col justify-between gap-2 sm:flex-row sm:items-start"><span className="min-w-0 break-words font-semibold text-white [overflow-wrap:anywhere]">{product.name}</span><span className="max-w-full break-words text-sm font-semibold text-amber-100 sm:text-right [overflow-wrap:anywhere]">{money(product.wholesalePrice, detail.revision.currency)}</span></span>
                      <span className="mt-1 block break-words text-xs text-zinc-400 [overflow-wrap:anywhere]">Código: <span className="font-mono text-zinc-300">{product.id}</span> · {product.category}{product.connectorType ? ` · ${product.connectorType}` : ""}</span>
                    </button>) : <p className="rounded-xl border border-dashed border-white/10 p-3 text-sm text-zinc-500">{products.length ? "No hay coincidencias en el catálogo." : "No hay productos habilitados con precio mayorista."}</p>}
                  </div>
                  <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,7rem)_minmax(0,1fr)] sm:items-end">
                    <label className="text-xs font-semibold text-zinc-400">Cantidad<input aria-label="Cantidad para agregar" type="number" inputMode="numeric" min={1} max={100} step={1} className={inputClass} value={addQuantity} onChange={event => setAddQuantity(event.target.value)} /></label>
                    <button type="button" className={`${buttonClass} w-full border-amber-300/40 bg-amber-300/10 text-amber-50`} disabled={Boolean(processing) || !selectedProductId || !validAddQuantity || (draftItems.length >= 50 && !draftItems.some(item => item.productId === selectedProductId)) || (draftItems.find(item => item.productId === selectedProductId)?.quantity ?? 0) + Number(addQuantity) > 100} onClick={addSelectedProduct}>Agregar a la propuesta</button>
                  </div>
                </>}
              </div>

              <div className="mt-5 flex min-w-0 flex-col justify-between gap-2 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-4 sm:flex-row sm:items-center"><span className="text-sm font-semibold text-amber-100">Subtotal estimado de propuesta</span><strong className="break-words text-xl text-white [overflow-wrap:anywhere]">{estimatedTotal === null ? "No disponible" : money(estimatedTotal, detail.revision.currency)}</strong></div>
              <p className="mt-2 text-xs leading-5 text-zinc-500">Importe orientativo; el servidor determina el precio final y el total al procesar la revisión.</p>
              <div className="mt-5 min-w-0 rounded-2xl border border-white/10 bg-zinc-900/60 p-4">
                <label className="block text-xs font-semibold text-zinc-300">Condiciones comerciales propuestas<select aria-label="Condiciones comerciales propuestas" disabled={Boolean(processing)} className={inputClass} value={paymentTermsDraft.method} onChange={event => { setPaymentTermsDraft(current => ({ ...current, method: event.target.value as WholesalePaymentTermsDraft["method"] })); setIdempotencyKey(""); }}>
                  <option value="">Seleccionar modalidad de pago</option>
                  <option value="full_before_delivery">Pago total antes de la entrega</option>
                  <option value="deposit_balance">Entrega a cuenta y saldo pendiente</option>
                  <option value="pay_on_delivery">Pago al momento de la entrega</option>
                  <option value="other">Otra condición acordada</option>
                </select></label>
                {paymentTermsDraft.method === "deposit_balance" && <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-end">
                  <label className="text-xs font-semibold text-zinc-400">Porcentaje de anticipo<select aria-label="Porcentaje de anticipo" disabled={Boolean(processing)} className={inputClass} value={paymentTermsDraft.advanceChoice} onChange={event => { setPaymentTermsDraft(current => ({ ...current, advanceChoice: event.target.value as WholesalePaymentTermsDraft["advanceChoice"] })); setIdempotencyKey(""); }}>
                    <option value="20">20%</option><option value="30">30%</option><option value="50">50%</option><option value="other">Otro porcentaje</option>
                  </select></label>
                  {paymentTermsDraft.advanceChoice === "other" && <label className="text-xs font-semibold text-zinc-400">Porcentaje acordado<input aria-label="Otro porcentaje de anticipo" type="number" inputMode="decimal" min="0.01" max="99.99" step="0.01" disabled={Boolean(processing)} className={inputClass} value={paymentTermsDraft.customAdvancePercent} onChange={event => { setPaymentTermsDraft(current => ({ ...current, customAdvancePercent: event.target.value })); setIdempotencyKey(""); }} placeholder="Entre 0 y 100" /></label>}
                </div>}
                {paymentTermsDraft.method === "deposit_balance" && <div className="mt-3 rounded-xl border border-sky-300/15 bg-sky-950/20 p-3 text-sm" aria-live="polite">
                  <p className="font-semibold text-sky-100">Vista previa estimada; no registra un pago.</p>
                  {advancePreview ? <div className="mt-2 grid gap-2 sm:grid-cols-2"><p className="break-words text-zinc-300 [overflow-wrap:anywhere]">Anticipo ({advancePercent}%): <strong className="text-white">{money(advancePreview.advance, detail.revision.currency)}</strong></p><p className="break-words text-zinc-300 [overflow-wrap:anywhere]">Saldo estimado: <strong className="text-white">{money(advancePreview.balance, detail.revision.currency)}</strong></p></div> : <p className="mt-1 text-xs text-amber-200">{estimatedTotal === null ? "El total estimado no está disponible hasta que todos los artículos tengan precio." : "Ingresá un porcentaje mayor que 0 y menor que 100."}</p>}
                </div>}
                {paymentTermsDraft.method === "other" && <label className="mt-3 block text-xs font-semibold text-zinc-400">Detalle breve<textarea aria-label="Otra condición acordada" maxLength={300} rows={2} disabled={Boolean(processing)} className={`${inputClass} resize-y`} value={paymentTermsDraft.otherText} onChange={event => { setPaymentTermsDraft(current => ({ ...current, otherText: event.target.value })); setIdempotencyKey(""); }} placeholder="Describí brevemente la condición acordada" /></label>}
                {commercialConditions === null && paymentTermsDraft.method !== "" && <p className="mt-2 text-xs text-amber-200" role="status">Completá una condición válida para enviar la propuesta.</p>}
              </div>
              <button type="button" className={`${buttonClass} mt-4 w-full border-amber-300/50 bg-amber-300/15 text-amber-50 hover:bg-amber-300/20`} disabled={Boolean(processing) || (needsReview && !reviewedLatest) || !validDraft || commercialConditions === null} onClick={() => {
                if (!commercialConditions) {
                  setActionError("Completá una condición comercial válida para la propuesta.");
                  return;
                }
                let key = idempotencyKey;
                try { if (!key) { key = createIdempotencyKey(); setIdempotencyKey(key); } }
                catch (cause) { setActionError(cause instanceof Error ? cause.message : "No se pudo preparar la propuesta."); return; }
                void performAction("propose", { expectedRevisionId: detail.revision.id, items: draftItems, idempotencyKey: key, commercialConditions, internalNote });
              }}>{processing === "propose" ? "Enviando propuesta…" : "Enviar propuesta"}</button>
            </section></details> : <section aria-label="Propuesta" className="rounded-2xl border border-dashed border-white/15 bg-zinc-950/50 p-5"><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">Propuesta</p><h3 className="mt-1 text-xl font-bold">Aún no está en edición</h3><p className="mt-3 text-sm leading-6 text-zinc-400">Iniciá la revisión para preparar una propuesta. La revisión vigente y su total siguen visibles arriba.</p></section>}
          </div>

          {canPropose && <section aria-label="Nota interna" className="mt-5 rounded-2xl border border-violet-300/20 bg-violet-950/15 p-5"><label className="block text-sm font-semibold text-violet-100">Nota interna <span className="font-normal text-violet-300/70">· solo para administración</span><textarea maxLength={1000} rows={3} disabled={Boolean(processing)} className={`${inputClass} resize-y`} value={internalNote} onChange={event => setInternalNote(event.target.value)} placeholder="No se comparte con el cliente" /></label><p className="mt-2 text-xs text-zinc-500">Hasta 1.000 caracteres. Se guarda únicamente en la cronología interna.</p></section>}

          {needsReview && <div className="mt-5 rounded-2xl border border-amber-300/30 bg-amber-950/30 p-4" role="alert"><p className="text-sm text-amber-100">La revisión vigente cambió. Compará los artículos y las condiciones antes de volver a proponer.</p><button type="button" className={`${buttonClass} mt-3 border-amber-300/30`} disabled={Boolean(processing)} onClick={() => setReviewedLatest(true)}>Ya revisé la versión vigente</button>{reviewedLatest && <p className="mt-2 text-sm text-emerald-300">Versión revisada. Ya podés preparar otra propuesta.</p>}</div>}
          {actionError && <p role="alert" className="mt-5 rounded-xl border border-red-400/20 bg-red-950/60 p-4 text-sm text-red-200">{actionError}</p>}

          <section aria-label="Acciones administrativas" className="mt-6 flex min-w-0 flex-col items-stretch gap-3 border-y border-white/10 py-5 sm:flex-row sm:flex-wrap sm:items-center">
            {detail.status === "received" && <button type="button" className={`${buttonClass} w-full border-sky-300/30 bg-sky-300/10 text-sky-100 sm:w-auto`} disabled={Boolean(processing)} onClick={() => void performAction("start_review")}>{processing === "start_review" ? "Iniciando revisión…" : "Iniciar revisión"}</button>}
            {canConfirm && <WholesaleConfirmation key={detail.revision.id} items={detail.revision.items} conditions={detail.revision.commercial_conditions} approved={detail.revision.status === "approved"} busy={Boolean(processing)} confirm={() => { if (window.confirm("¿Confirmar esta solicitud con la revisión vigente? Esto reserva stock y no registra cobros ni entregas.")) void performAction("confirm", { revisionId: detail.revision.id }); }} />}
            {canReject && <button type="button" className={`${buttonClass} w-full border-red-400/30 text-red-200 sm:w-auto`} disabled={Boolean(processing)} onClick={() => { if (window.confirm("¿Rechazar esta solicitud? La acción quedará registrada en su cronología.")) void performAction("reject", { internalNote }); }}>{processing === "reject" ? "Rechazando…" : "Rechazar solicitud"}</button>}
            {detail.status === "confirmed" && <p className="text-sm text-emerald-300">Pedido confirmado. Desde los paneles siguientes podés registrar entregas, cobros, reembolsos y conciliaciones; el cobro no cambia el estado del pedido.</p>}
            {detail.status === "confirmed" && <section aria-label="Entregas mayoristas" className="w-full basis-full rounded-2xl border border-emerald-300/15 bg-emerald-950/10 p-4">
              <h3 className="font-bold text-emerald-100">Entregas</h3>
              <div className="mt-3 space-y-2">{detail.deliveryProgress.map(progress => <div key={progress.productId} className="grid min-w-0 grid-cols-[minmax(0,1fr)_6rem] items-center gap-3"><p className="min-w-0 break-words text-sm text-zinc-300">{detail.revision.items.find(item => item.productId === progress.productId)?.name ?? progress.productId}<span className="block text-xs text-zinc-500">Entregadas {progress.delivered}/{progress.ordered} · reservadas {progress.reservedRemaining}</span></p><input aria-label={`Cantidad a entregar ${progress.productId}`} type="number" min="0" max={Math.min(progress.reservedRemaining, progress.ordered-progress.delivered)} step="1" disabled={Boolean(processing)} className={inputClass} value={deliveryQuantities[progress.productId] ?? "0"} onChange={event => {setDeliveryQuantities(current => ({...current,[progress.productId]:event.target.value}));setDeliveryIdempotencyKey("");}} /></div>)}</div>
              {detail.deliveries.length > 0 && <ol className="mt-4 space-y-2 border-t border-white/10 pt-3 text-sm text-zinc-400">{detail.deliveries.map(delivery => <li key={delivery.id}>Entrega del {when(delivery.deliveredAt)} · {delivery.items.map(item => `${item.quantity} × ${detail.revision.items.find(product => product.productId === item.productId)?.name ?? item.productId}`).join(", ")}</li>)}</ol>}
              {detail.deliveryProgress.every(item => item.delivered >= item.ordered) ? <p className="mt-4 text-sm font-semibold text-emerald-200">Entrega completa. El pedido conserva su estado comercial confirmado.</p> : <button type="button" className={`${buttonClass} mt-4 w-full border-emerald-300/30 bg-emerald-300/10 text-emerald-100 sm:w-auto`} disabled={Boolean(processing)||!validDelivery} onClick={()=>{let key=deliveryIdempotencyKey;try{if(!key){key=createIdempotencyKey();setDeliveryIdempotencyKey(key);}}catch(cause){setActionError(cause instanceof Error?cause.message:"No se pudo preparar la entrega.");return;}void performAction("deliver",{revisionId:detail.revision.id,idempotencyKey:key,items:deliveryItems.map(({productId,quantity})=>({productId,quantity}))});}}>{processing==="deliver"?"Registrando entrega…":"Registrar entrega parcial"}</button>}
            </section>}
            {processing && <span role="status" className="text-sm text-zinc-400">Procesando solicitud…</span>}
          </section>

          {(detail.status === "confirmed" || detail.deliveries.length > 0) && <WholesaleOrderLedger orderId={detail.id} revisionId={detail.revision.id} status={detail.status} total={detail.revision.totalAmount} currency={detail.revision.currency} deliveries={detail.deliveries} />}
          <section aria-label="Cronología" className="pt-6">
            <div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Actividad del pedido</p><h3 className="mt-1 text-xl font-bold">Cronología</h3></div><span className="rounded-full bg-white/5 px-3 py-1 text-xs text-zinc-400">{detail.events.length} eventos</span></div>
            {detail.events.length ? <ol className="mt-5 space-y-4">{[...detail.events].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id).map(event => <li key={event.id} className="relative border-l border-red-400/40 pb-1 pl-5 before:absolute before:-left-[5px] before:top-1 before:h-2.5 before:w-2.5 before:rounded-full before:bg-red-400"><p className="font-semibold text-zinc-100">{labels[event.type] || event.type}</p><p className="mt-1 text-xs text-zinc-400">{when(event.createdAt)} · {event.channel} · {event.actor}</p></li>)}</ol> : <p className="mt-4 text-sm text-zinc-500">Esta solicitud todavía no tiene eventos registrados.</p>}
          </section>
        </>}
      </section>
    </div>}
  </main>;
}
