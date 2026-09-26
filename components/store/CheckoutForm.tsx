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
export function CheckoutForm({ transfer }: { transfer: Transfer }) {
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
  return <main className="mx-auto max-w-3xl px-4 py-10 text-white">
    <h1 className="text-3xl font-black">Checkout</h1>
    {previousOrder && <p className="mt-4 rounded-xl border border-white/15 p-4">Ya tenés un pedido registrado: <Link className="font-bold text-red-300 underline" href={`/checkout/resultado?pedido=${previousOrder}`}>Ver pedido {previousOrder}</Link></p>}
    {checking ? <p className="mt-6">Comprobando si hay un pedido para recuperar…</p> : !lines.length ? <p className="mt-6">Tu carrito está vacío. <Link href="/productos" className="text-red-300 underline">Ver productos</Link></p> : <>
      <p className="mt-2 text-zinc-400">Total del carrito: <b className="text-white">${total.toLocaleString("es-AR")}</b></p>
      <section className="mt-8"><h2 className="text-xl font-black">¿Cómo querés pagar?</h2><div className="mt-4 grid gap-3 sm:grid-cols-3">{methods.filter(item => item.id !== "transfer" || transferConfigured).map(item => <button key={item.id} type="button" disabled={saving} onClick={() => { setMethod(item.id); capture(analyticsEvents.paymentMethodSelected, { method: item.id }); }} className={`min-h-28 rounded-2xl border p-4 text-left ${method === item.id ? "border-red-500 bg-red-600/15" : "border-white/10 bg-zinc-950"}`}><b className="block">{item.title}</b><span className="mt-2 block text-sm text-zinc-400">{item.description}</span></button>)}</div></section>
      <form onSubmit={submit} className="mt-7 grid gap-3 rounded-2xl border border-white/10 bg-zinc-950 p-4 sm:p-6"><fieldset disabled={saving} className="contents">
        <label>Nombre completo<input required maxLength={120} autoComplete="name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></label>
        <label>WhatsApp<input required maxLength={40} autoComplete="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}/></label>
        <label>Email opcional<input type="email" maxLength={254} autoComplete="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}/></label>
        <label>Modalidad<select value={form.fulfillment} onChange={e => setForm({ ...form, fulfillment: e.target.value })}><option value="pickup">Retiro</option><option value="delivery">Entrega</option></select></label>
        {form.fulfillment === "delivery" && <label>Dirección<input required maxLength={300} autoComplete="street-address" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}/></label>}
        <label>Observaciones<textarea maxLength={1000} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}/></label>
        <button disabled={saving || !ready || !method} className="min-h-12 rounded-full bg-red-600 font-bold disabled:opacity-40">{saving ? "Registrando pedido…" : "Crear pedido y continuar"}</button>
      </fieldset></form>
    </>}
    {error && <p role="alert" className="mt-4 text-red-300">{error}</p>}
  </main>;
}
