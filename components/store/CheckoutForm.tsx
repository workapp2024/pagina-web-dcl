/* eslint-disable @next/next/no-location-assign-relative-destination */
"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import posthog from "posthog-js";
import { readBrowserAnalyticsContext } from "@/lib/store/analytics-context";
import { useCart } from "@/components/store/CartProvider";
import { analyticsEvents, capture } from "@/lib/analytics";
import { checkoutLock, finishCheckoutAttempt, lastOrderNumber, prepareCheckoutAttempt, readCheckoutAttempt, type CheckoutAttempt } from "@/lib/store/checkout-attempt";
import { normalizeOrderItems } from "@/lib/store/order-input";

type Method = "mercadopago" | "card" | "transfer";
type Transfer = { alias: string; cbuCvu: string; holder: string; institution: string; instructions: string };
const methods: { id: Method; title: string; description: string }[] = [
  { id: "mercadopago", title: "Mercado Pago", description: "Pagá con los medios disponibles en Mercado Pago." },
  { id: "card", title: "Tarjeta", description: "Completá el pago en el formulario seguro." },
  { id: "transfer", title: "Transferencia", description: "Transferencia bancaria directa." },
];
async function recover(attempt: CheckoutAttempt) {
  const response = await fetch("/api/store/orders/recover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey: attempt.key }) });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error("No pudimos recuperar el intento en este navegador. No repitas la compra; contactá a DCL.");
  return typeof body.orderNumber === "string" ? body.orderNumber : null;
}
export function CheckoutForm({ transfer, paymentImage }: { transfer: Transfer; paymentImage?: React.ReactNode }) {
  const { lines, total, ready, consumePurchasedItems } = useCart();
  const inFlight = useRef(false);
  const [checking, setChecking] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [previousOrder, setPreviousOrder] = useState<string | null>(null);
  const [method, setMethod] = useState<Method | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", fulfillment: "pickup", address: "", notes: "" });
  const transferConfigured = Boolean((transfer.alias.trim() || transfer.cbuCvu.trim()) && transfer.holder.trim() && transfer.institution.trim());
  useEffect(() => {
    let active = true;
    void checkoutLock(async () => {
      if (!active) return;
      const attempt = readCheckoutAttempt(localStorage);
      if (attempt) {
        const number = await recover(attempt);
        if (!active) return;
        if (number) {
          await consumePurchasedItems(number, attempt.items);
          if (!active) return;
          finishCheckoutAttempt(localStorage, attempt.key, number);
          if (active) location.replace(`/checkout/resultado?pedido=${encodeURIComponent(number)}`);
          return;
        }
      }
      if (active) { setPreviousOrder(lastOrderNumber(localStorage)); setChecking(false); }
    }).catch(() => { if (active) { setError("No pudimos verificar tu intento anterior. Conservamos el carrito. Recargá para recuperar o contactá a DCL antes de comprar otra vez."); } });
    return () => { active = false; };
  }, [consumePurchasedItems]);
  async function complete(attempt: CheckoutAttempt, number: string) {
    await consumePurchasedItems(number, attempt.items);
    finishCheckoutAttempt(localStorage, attempt.key, number);
    location.assign(`/checkout/resultado?pedido=${encodeURIComponent(number)}`);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || checking || !ready || !method) return;
    inFlight.current = true; setSaving(true); setError("");
    try {
      await checkoutLock(async () => {
        const prior = readCheckoutAttempt(localStorage);
        if (prior) {
          const number = await recover(prior);
          if (number) { await complete(prior, number); return; }
        }
        const session = await fetch("/api/store/buyer-session", { method: "POST" });
        if (!session.ok) throw new Error("No pudimos preparar la sesión segura. No se envió un pedido nuevo.");
        const items = normalizeOrderItems(lines.map(item => ({ productId: item.id, quantity: item.quantity })));
        const attempt = await prepareCheckoutAttempt(localStorage, items, method, form);
        const response = await fetch("/api/store/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, paymentMethod: method, idempotencyKey: attempt.key, items: attempt.items, analytics_context: readBrowserAnalyticsContext(posthog) }) });
        const body = await response.json();
        if (!response.ok || !body.ok || !/^DCL-[0-9]{6,19}$/.test(body.orderNumber)) throw new Error(body.error || "No pudimos confirmar la respuesta. Conservamos el intento para recuperarlo sin duplicar el pedido.");
        await complete(attempt, body.orderNumber);
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos continuar. Conservamos tu intento."); }
    finally { inFlight.current = false; setSaving(false); }
  }
  const money = (value: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(value);
  const field = "mt-1.5 min-h-12 w-full rounded-xl border border-white/15 bg-black/40 px-3 py-3 text-base text-white outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-400/20";
  const availableMethods = methods.filter(item => item.id !== "transfer" || transferConfigured);
  return <main className="mx-auto max-w-6xl px-4 py-6 text-white sm:px-6 sm:py-10">
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div><Link href="/carrito" className="text-xs font-semibold text-zinc-400 hover:text-white">← Volver al carrito</Link><h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Finalizar compra</h1></div>
      <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-300"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="m8 12 3 3 5-6"/></svg>Compra segura</span>
    </header>
    {previousOrder && <p className="mb-5 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm">Ya tenés un pedido registrado: <Link className="font-bold text-amber-200 underline" href={`/checkout/resultado?pedido=${previousOrder}`}>Ver pedido {previousOrder}</Link></p>}
    {error && <p role="alert" className="mb-5 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm leading-6 text-red-200">{error}</p>}
    {checking ? <p role="status" className="rounded-2xl border border-white/10 bg-zinc-950 p-6 text-sm text-zinc-300">Comprobando si hay un pedido para recuperar…</p> : !lines.length ? <section className="rounded-2xl border border-white/10 bg-zinc-950 p-8 text-center"><h2 className="text-lg font-bold">Tu carrito está vacío</h2><Link href="/productos" className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-red-600 px-6 font-bold">Ver productos</Link></section> : <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <aside className="min-w-0 rounded-2xl border border-white/10 bg-gradient-to-br from-zinc-900 to-zinc-950 p-5 lg:col-start-2 lg:row-start-1 lg:sticky lg:top-6" aria-label="Resumen de compra">
        <div className="flex items-center justify-between gap-3"><h2 className="font-bold">Tu compra</h2><Link href="/carrito" className="text-xs font-semibold text-zinc-400 underline">Editar</Link></div>
        <ul className="mt-4 max-h-64 space-y-4 overflow-y-auto pr-1">{lines.map(line => <li key={line.id} className="flex min-w-0 gap-3"><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{line.name}</p><p className="mt-1 text-xs text-zinc-400">{line.quantity} × {money(line.price)}</p></div><span className="shrink-0 text-sm font-bold">{money(line.price * line.quantity)}</span></li>)}</ul>
        <div className="mt-5 flex items-baseline justify-between gap-3 border-t border-white/10 pt-4"><span className="text-sm text-zinc-300">Total · ARS</span><strong className="text-2xl font-black tracking-tight">{money(total)}</strong></div>
        <p className="mt-2 text-xs leading-5 text-zinc-500">Revisá los productos y cantidades antes de continuar.</p>
      </aside>
      <form onSubmit={submit} aria-busy={saving} className="min-w-0 space-y-5 lg:col-start-1 lg:row-start-1"><fieldset disabled={saving} className="min-w-0 space-y-5">
        <section className="rounded-2xl border border-white/10 bg-zinc-950 p-5 sm:p-6"><h2 className="text-base font-bold">1. Tus datos</h2><p className="mt-1 text-xs text-zinc-400">Para identificar el pedido y coordinar la entrega.</p><div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-zinc-300">Nombre completo<input className={field} required maxLength={120} autoComplete="name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></label>
          <label className="text-sm text-zinc-300">WhatsApp<input className={field} required maxLength={40} autoComplete="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}/></label>
          <label className="text-sm text-zinc-300 sm:col-span-2">Email <span className="text-zinc-500">(opcional)</span><input className={field} type="email" maxLength={254} autoComplete="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}/></label>
        </div></section>
        <section className="rounded-2xl border border-white/10 bg-zinc-950 p-5 sm:p-6"><h2 className="text-base font-bold">2. Entrega</h2><div className="mt-4 grid gap-4"><label className="text-sm text-zinc-300">Modalidad<select className={field} value={form.fulfillment} onChange={e => setForm({ ...form, fulfillment: e.target.value })}><option value="pickup">Retiro</option><option value="delivery">Entrega</option></select></label>
          {form.fulfillment === "delivery" && <label className="text-sm text-zinc-300">Dirección<input className={field} required maxLength={300} autoComplete="street-address" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}/></label>}
          <label className="text-sm text-zinc-300">Observaciones <span className="text-zinc-500">(opcional)</span><textarea className={field} rows={2} maxLength={1000} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}/></label>
        </div></section>
        <section className="rounded-2xl border border-white/10 bg-zinc-950 p-5 sm:p-6"><h2 className="text-base font-bold">3. Cómo querés pagar</h2><div className="mt-4 space-y-2" role="group" aria-label="Medios de pago disponibles">{availableMethods.map(item => <button key={item.id} type="button" disabled={saving} aria-pressed={method === item.id} onClick={() => { setMethod(item.id); capture(analyticsEvents.paymentMethodSelected, { method: item.id }); }} className={`flex min-h-16 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400 ${method === item.id ? "border-red-500 bg-red-500/10" : "border-white/10 bg-white/[0.02] hover:border-white/30"}`}><span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${method === item.id ? "border-red-500 bg-red-500" : "border-zinc-600"}`}>{method === item.id && <span className="h-2 w-2 rounded-full bg-white"/>}</span><span><b className="block text-sm">{item.id === "card" ? "Tarjeta en la tienda" : item.title}</b><span className="mt-0.5 block text-xs leading-5 text-zinc-400">{item.id === "mercadopago" ? "Continuá en el sitio de Mercado Pago." : item.id === "card" ? "Formulario integrado, procesado por Mercado Pago." : item.description}</span></span></button>)}</div>
          {paymentImage && <div className="mt-4 [&_section]:px-0 [&_section]:py-0 [&_h2]:sr-only [&_img]:max-h-16 [&_div]:rounded-xl [&_div]:px-3 [&_div]:py-2">{paymentImage}</div>}
        </section>
        <div><button disabled={saving || !ready || !method} className="flex min-h-14 w-full items-center justify-center gap-3 rounded-xl bg-red-600 px-4 py-4 text-base font-bold shadow-lg shadow-red-950/30 transition hover:bg-red-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400 disabled:cursor-not-allowed disabled:opacity-40">{saving ? "Registrando pedido…" : "Crear pedido y continuar"}<span aria-hidden="true">→</span></button><p className="mt-3 text-center text-xs leading-5 text-zinc-500">{saving ? "Esperá la confirmación. No vuelvas a enviar el pedido." : "El pedido se registra antes de continuar al pago."}</p></div>
      </fieldset></form>
    </div>}
  </main>;
}
