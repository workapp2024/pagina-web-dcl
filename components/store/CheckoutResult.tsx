"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { analyticsEvents, capture, captureOnce } from "@/lib/analytics";
import { whatsappUrl } from "@/lib/whatsapp";
import { MercadoPagoBrick } from "@/components/store/MercadoPagoBrick";
import type { PublicOrder } from "@/lib/store/public-order";

const methods = { card: "Tarjeta", mercadopago: "Mercado Pago", transfer: "Transferencia" };
const paymentLabels: Record<string, string> = { approved: "Aprobado", pending: "Pendiente", rejected: "Rechazado", cancelled: "Cancelado", refunded: "Reembolsado", error: "Requiere revisión" };
export function orderMessage(order: PublicOrder) {
  if (order.result === "approved") return { title: "Pago aprobado", description: "Tu pedido está confirmado. Coordinemos la entrega o el retiro." };
  if (order.result === "refunded") return { title: "Pedido reembolsado", description: "El reembolso fue registrado por DCL." };
  if (order.result === "cancelled") return { title: "Pedido cancelado", description: "Este pedido está cancelado. Contactanos si necesitás ayuda." };
  if (order.result === "rejected") return { title: "El pago no pudo completarse", description: "Tu pedido quedó registrado. No generes otro pedido para repetir el pago; contactanos para ayudarte." };
  if (order.result === "review") return { title: "Pedido en revisión", description: order.paymentReceived ? "Recibimos el pago pero necesitamos revisar tu pedido. No vuelvas a pagar." : "Necesitamos revisar el estado de tu pedido. Contactanos antes de pagar." };
  return { title: "Pedido recibido", description: order.paymentMethod === "transfer" ? "Esperando confirmación de transferencia" : "Estamos esperando la confirmación del pago" };
}
export function CheckoutResult({ orderNumber, publicKey }: { orderNumber: string; publicKey: string }) {
  const [order, setOrder] = useState<PublicOrder | null>(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [card, setCard] = useState(false), [refresh, setRefresh] = useState(0), [pollingFinished, setPollingFinished] = useState(false);
  const [declarationFailed, setDeclarationFailed] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    let active = true, attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function check() {
      try {
        const response = await fetch(`/api/store/orders/${encodeURIComponent(orderNumber)}/status`, { cache: "no-store" });
        const body = await response.json();
        if (!active) return;
        if (!response.ok || !body.ok) {
          if (response.status === 404) setOrder(null);
          setError(response.status === 404 ? "Pedido no disponible en este navegador. Usá el navegador donde lo creaste o contactá a DCL." : "No pudimos actualizar el estado. No vuelvas a pagar; consultá nuevamente.");
          return;
        }
        setOrder(body); setError("");
        captureOnce(`result:${orderNumber}:${body.result}`, analyticsEvents.paymentResultViewed, { result: body.result });
        if (body.transfer) captureOnce(`transfer-instructions:${orderNumber}`, analyticsEvents.transferInstructionsViewed);
        attempts += 1;
        if (body.result === "pending" && attempts < 24) timer = setTimeout(check, 5_000);
        else if (body.result === "pending") setPollingFinished(true);
      } catch { if (active) setError("No pudimos actualizar el estado. Conservá este enlace y consultá nuevamente."); }
    }
    if (/^DCL-[0-9]{6,19}$/.test(orderNumber)) void check();
    else void Promise.resolve().then(() => { if (active) setError("Pedido no disponible en este navegador."); });
    const reload = () => { setPollingFinished(false); setRefresh(value => value + 1); };
    window.addEventListener("dcl-order-refresh", reload);
    return () => { active = false; if (timer) clearTimeout(timer); window.removeEventListener("dcl-order-refresh", reload); };
  }, [orderNumber, refresh]);
  const support = whatsappUrl(order ? `Hola, necesito ayuda con mi pedido ${order.orderNumber}.` : "Hola, necesito ayuda para recuperar mi pedido.");
  const transferChat = whatsappUrl(`Hola, realicé la transferencia correspondiente al pedido ${order?.orderNumber || ""}. Quiero enviar el comprobante.`);
  async function declareTransfer() {
    if (!order || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setDeclarationFailed(false);
    try {
      const response = await fetch(`/api/store/orders/${encodeURIComponent(order.orderNumber)}/status`, { method: "POST" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error("No pudimos registrar el aviso. Podés avisarnos por WhatsApp con el botón separado.");
      setOrder({ ...order, transferDeclared: true });
      captureOnce(`transfer-sent:${order.orderNumber}`, analyticsEvents.manualTransferMarkedSent);
      window.location.assign(transferChat);
    } catch (cause) { setDeclarationFailed(true); setError(cause instanceof Error ? cause.message : "No pudimos registrar el aviso."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function continuePayment() {
    if (!order || inFlight.current || !order.canPay) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/payments/mercadopago/preference", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderNumber: order.orderNumber }) });
      const body = await response.json();
      if (!response.ok || !body.checkoutUrl) throw new Error("No pudimos continuar el pago de este pedido. No crees otro; contactá a DCL.");
      capture(analyticsEvents.mercadopagoCheckoutOpened);
      window.location.assign(body.checkoutUrl);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos continuar."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const message = order ? orderMessage(order) : { title: error ? "No pudimos consultar el pedido" : "Estamos consultando tu pedido", description: "El estado se obtiene del servidor; el retorno de pago no confirma la operación por sí solo." };
  const money = (value: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: order?.currency || "ARS" }).format(value);
  return <main className="mx-auto min-h-[70svh] max-w-2xl px-4 py-10 text-white"><section className="rounded-3xl border border-white/10 bg-zinc-950 p-5 sm:p-8">
    {order && <p className="text-sm font-bold text-red-300">Pedido {order.orderNumber}</p>}
    <h1 className="mt-3 text-3xl font-black">{message.title}</h1><p className="mt-4 leading-7 text-zinc-300">{message.description}</p>
    {order && <>
      <dl className="mt-6 grid gap-3 rounded-2xl bg-white/5 p-4"><div><dt>Estado del pago</dt><dd className="font-bold">{paymentLabels[order.paymentStatus] || "Requiere revisión"}</dd></div><div><dt>Medio de pago</dt><dd className="font-bold">{methods[order.paymentMethod]}</dd></div><div><dt>Total · {order.currency}</dt><dd className="text-xl font-bold">{money(order.total)}</dd></div></dl>
      <details className="mt-5 rounded-xl border border-white/10 p-4"><summary className="cursor-pointer font-bold">Ver resumen del pedido</summary><ul className="mt-4 space-y-4">{order.items.map((item, index) => <li key={index}><b>{item.name}</b><p>{item.quantity} × {money(item.unitPrice)} · {money(item.lineTotal)}</p></li>)}</ul></details>
      {order.transfer && order.result === "pending" && <section className="mt-6"><h2 className="text-xl font-bold">Datos para transferir</h2><p className="mt-2">Transferí exactamente {money(order.total)}.</p><dl className="mt-4 space-y-3 break-words">{[["Alias", order.transfer.alias], ["CBU/CVU", order.transfer.cbuCvu], ["Titular", order.transfer.holder], ["Institución", order.transfer.institution]].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="text-sm text-zinc-400">{label}</dt><dd className="font-bold">{value}</dd></div>)}</dl><p className="mt-4 whitespace-pre-wrap text-sm text-zinc-300">{order.transfer.instructions}</p>
        {order.transferDeclared && <p role="status" className="mt-4 text-emerald-300">Aviso registrado. DCL todavía debe verificar la transferencia.</p>}
        <button type="button" disabled={busy} onClick={() => void declareTransfer()} className="result-primary mt-5 w-full disabled:opacity-50">{busy ? "Registrando aviso…" : "Ya transferí — Avisar por WhatsApp"}</button>
        <p className="mt-3 text-xs text-zinc-400">Luego podés adjuntar el comprobante en WhatsApp. Este aviso no aprueba el pago.</p>
        {declarationFailed && <a href={transferChat} className="result-secondary mt-4" target="_blank" rel="noopener noreferrer">Avisar por WhatsApp</a>}
      </section>}
      {order.result === "pending" && order.canPay && !error && order.paymentMethod === "mercadopago" && <button type="button" disabled={busy} onClick={() => void continuePayment()} className="result-primary mt-6 w-full">{busy ? "Abriendo Mercado Pago…" : "Continuar con el pago"}</button>}
      {order.result === "pending" && order.canPay && !error && order.paymentMethod === "card" && publicKey && (card ? <div className="mt-6"><MercadoPagoBrick orderNumber={order.orderNumber} amount={order.total} publicKey={publicKey}/></div> : <button type="button" onClick={() => setCard(true)} className="result-primary mt-6 w-full">Continuar con tarjeta</button>)}
      {order.result === "pending" && order.paymentMethod !== "transfer" && !order.canPay && <p className="mt-4 text-sm text-amber-200">No hay un nuevo pago habilitado para este pedido. Consultá el estado o pedinos ayuda.</p>}
      {order.result === "pending" && <p className="mt-5 text-xs text-zinc-400">{pollingFinished ? "Pausamos la actualización automática. Podés consultar el estado nuevamente." : "Consultamos el estado automáticamente durante unos minutos. Podés volver a este enlace en el mismo navegador."}</p>}
    </>}
    {error && <p role="alert" className="mt-5 text-red-300">{error}</p>}
    <div className="mt-7 grid gap-3"><button type="button" onClick={() => { setPollingFinished(false); setRefresh(value => value + 1); }} className="result-secondary">Actualizar estado</button><a href={support} target="_blank" rel="noopener noreferrer" className="result-primary">Necesito ayuda con mi pedido</a><Link href="/productos" className="result-secondary">Seguir viendo productos</Link></div>
  </section></main>;
}
