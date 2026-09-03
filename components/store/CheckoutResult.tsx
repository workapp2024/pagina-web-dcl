"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { analyticsEvents, capture } from "@/lib/analytics";
import { whatsappUrl } from "@/lib/whatsapp";

type PaymentResult = "approved" | "pending" | "rejected";
type OrderStatus = { result: PaymentResult; status: string; paymentMethod: string; total: number; currency: string; reference: string };
const paymentLabels: Record<string, string> = { card: "Tarjeta", mercadopago: "Mercado Pago", transfer: "Transferencia" };

function money(value: number, currency: string) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: currency || "ARS" }).format(value);
}

export function CheckoutResult({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<OrderStatus | null>(null);
  const [loadError, setLoadError] = useState(!orderId);
  const trackedResults = useRef(new Set<PaymentResult>());

  useEffect(() => {
    if (!orderId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    async function check() {
      try {
        const response = await fetch(`/api/store/orders/${encodeURIComponent(orderId)}/status`, { cache: "no-store" });
        const body = await response.json() as ({ ok: true } & OrderStatus) | { ok: false };
        if (!active) return;
        if (!response.ok || !body.ok) { setLoadError(true); return; }
        setOrder(body);
        setLoadError(false);
        if (!trackedResults.current.has(body.result)) {
          trackedResults.current.add(body.result);
          capture(analyticsEvents.paymentResultViewed, { result: body.result });
        }
        attempts += 1;
        if (body.result === "pending" && attempts < 24) timer = setTimeout(check, 5_000);
      } catch {
        if (!active) return;
        attempts += 1;
        setLoadError(true);
        if (attempts < 24) timer = setTimeout(check, 5_000);
      }
    }

    void check();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [orderId]);

  const approvedMessage = order?.reference
    ? `Hola, realicé la compra del pedido ${order.reference} en DCL y quiero coordinar la entrega o retiro.`
    : "Hola, realicé una compra en DCL y quiero coordinar la entrega o retiro de mi pedido.";
  const supportMessage = order?.reference
    ? `Hola, quiero consultar por el estado del pedido ${order.reference} en DCL.`
    : "Hola, quiero consultar por el estado de un pago en DCL.";

  if (!order && !loadError) return <ResultShell symbol="…" tone="pending" title="Estamos verificando tu pago" description="Consultamos el estado seguro del pedido. Esto puede tardar unos segundos." />;
  if (!order) return <ResultShell symbol="!" tone="rejected" title="No pudimos consultar el pedido" description="El enlace no contiene una referencia válida o el estado no está disponible. No asumimos que el pago fue aprobado."><div className="mt-7 grid gap-3"><Link href="/" className="result-secondary">Volver al inicio</Link><a href={whatsappUrl(supportMessage)} target="_blank" rel="noopener noreferrer" className="result-primary">Consultar por WhatsApp</a></div></ResultShell>;

  if (order.result === "approved") return <ResultShell symbol="✓" tone="approved" eyebrow="Compra confirmada" title="Pago realizado correctamente" description="Recibimos tu pago. Ahora coordinemos la entrega o el retiro de tu compra."><OrderSummary order={order} /><div className="mt-7 grid gap-3"><a href={whatsappUrl(approvedMessage)} target="_blank" rel="noopener noreferrer" onClick={() => capture(analyticsEvents.deliveryWhatsappClicked, { source: "payment_success" })} className="result-primary">Coordinar entrega por WhatsApp</a><Link href="/" className="result-secondary">Volver al inicio</Link></div></ResultShell>;

  if (order.result === "rejected") return <ResultShell symbol="×" tone="rejected" eyebrow="Operación no confirmada" title="No pudimos confirmar el pago" description="El pago fue rechazado o no pudo completarse. Podés volver al checkout sin que eso cree otro pedido automáticamente."><OrderSummary order={order} /><div className="mt-7 grid gap-3"><Link href="/checkout" className="result-primary">Intentar nuevamente</Link><a href={whatsappUrl(supportMessage)} target="_blank" rel="noopener noreferrer" className="result-secondary">Consultar por WhatsApp</a></div></ResultShell>;

  return <ResultShell symbol="…" tone="pending" eyebrow="Validación en curso" title="Pago pendiente" description="Mercado Pago todavía está procesando la operación. Vamos a actualizar el estado automáticamente."><OrderSummary order={order} /><p className="mt-5 text-xs leading-5 text-zinc-500">Esta pantalla sólo mostrará la aprobación cuando el servidor la haya validado. Podés dejarla abierta mientras actualizamos el estado.</p><div className="mt-7 grid gap-3"><Link href="/" className="result-primary">Volver al inicio</Link><a href={whatsappUrl(supportMessage)} target="_blank" rel="noopener noreferrer" className="result-secondary">Consultar por WhatsApp</a></div></ResultShell>;
}

function OrderSummary({ order }: { order: OrderStatus }) {
  return <dl className="mt-7 divide-y divide-white/10 rounded-2xl border border-white/10 bg-black/25 px-4 text-left"><SummaryRow label="Pedido" value={order.reference} /><SummaryRow label="Total" value={money(order.total, order.currency)} /><SummaryRow label="Medio de pago" value={paymentLabels[order.paymentMethod] || "Pago online"} /></dl>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="flex min-h-14 items-center justify-between gap-4 py-3"><dt className="text-sm text-zinc-400">{label}</dt><dd className="text-right text-sm font-bold text-white">{value}</dd></div>;
}

function ResultShell({ symbol, tone, eyebrow, title, description, children }: { symbol: string; tone: PaymentResult; eyebrow?: string; title: string; description: string; children?: React.ReactNode }) {
  const colors = tone === "approved" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : tone === "rejected" ? "border-red-400/30 bg-red-400/10 text-red-300" : "border-amber-400/30 bg-amber-400/10 text-amber-300";
  return <main className="relative isolate flex min-h-[calc(100svh-5rem)] items-center overflow-hidden px-4 py-10 text-white"><div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(220,38,38,.16),transparent_42%)]" /><section className="mx-auto w-full max-w-xl rounded-[2rem] border border-white/10 bg-zinc-950/95 p-5 shadow-2xl shadow-black/40 sm:p-8"><div className={`flex size-16 items-center justify-center rounded-full border text-3xl font-black ${colors}`} aria-hidden="true">{symbol}</div>{eyebrow && <p className="mt-6 text-xs font-bold uppercase tracking-[.2em] text-red-400">{eyebrow}</p>}<h1 className="mt-2 text-balance text-3xl font-black leading-tight sm:text-4xl">{title}</h1><p className="mt-4 text-pretty leading-7 text-zinc-300">{description}</p>{children}</section></main>;
}
