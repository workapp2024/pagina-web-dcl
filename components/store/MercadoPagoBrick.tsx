"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type BrickController = { unmount: () => Promise<void> | void };
type MercadoPagoConstructor = new (key: string) => { bricks: () => { create: (type: string, id: string, settings: unknown) => Promise<BrickController> } };
declare global { interface Window { MercadoPago?: MercadoPagoConstructor; __dclMercadoPagoSdk?: Promise<void> } }

function loadSdk() {
  if (window.MercadoPago) return Promise.resolve();
  if (window.__dclMercadoPagoSdk) return window.__dclMercadoPagoSdk;
  window.__dclMercadoPagoSdk = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://sdk.mercadopago.com/js/v2"]');
    const script = existing || document.createElement("script");
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("No se pudo cargar Mercado Pago.")), { once: true });
    if (!existing) { script.src = "https://sdk.mercadopago.com/js/v2"; document.head.appendChild(script); }
  });
  return window.__dclMercadoPagoSdk;
}

export function MercadoPagoBrick({ orderId, amount, publicKey }: { orderId: string; amount: number; publicKey: string }) {
  const id = `mp-card-${useId().replace(/:/g, "")}`;
  const router = useRouter();
  const controller = useRef<BrickController | null>(null);
  const generation = useRef(0);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const current = ++generation.current;
    let disposed = false;
    void loadSdk().then(async () => {
      if (disposed || current !== generation.current || !window.MercadoPago) return;
      const created = await new window.MercadoPago(publicKey).bricks().create("cardPayment", id, {
        initialization: { amount },
        callbacks: {
          onReady: () => { if (!disposed) setReady(true); },
          onSubmit: (form: Record<string, unknown>, additional: { paymentTypeId?: string }) => new Promise<void>(async (resolve, reject) => {
            try {
              const payer = form.payer && typeof form.payer === "object" ? form.payer : {};
              const response = await fetch("/api/payments/mercadopago/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId, token: form.token, payment_method_id: form.payment_method_id, payment_type: additional.paymentTypeId, installments: form.installments, payer }) });
              const body = await response.json();
              if (!response.ok) throw new Error(body.error || "No se pudo procesar el pago.");
              resolve();
              router.push(`/checkout/resultado?result=pending&order=${encodeURIComponent(orderId)}`);
            } catch (cause) { const message = cause instanceof Error ? cause.message : "No se pudo procesar el pago."; setError(message); reject(cause); }
          }),
          onError: () => { if (!disposed) setError("No se pudo cargar el formulario de tarjeta."); },
        },
      });
      if (disposed || current !== generation.current) await created.unmount();
      else controller.current = created;
    }).catch(cause => { if (!disposed) setError(cause instanceof Error ? cause.message : "No se pudo cargar Mercado Pago."); });
    return () => { disposed = true; generation.current += 1; const mounted = controller.current; controller.current = null; if (mounted) void mounted.unmount(); };
  }, [amount, id, orderId, publicKey, router]);

  return <section className="rounded-2xl border border-white/10 bg-zinc-950 p-4 sm:p-6"><h2 className="text-xl font-black">Crédito o débito</h2>{!ready&&!error&&<p className="mt-3 text-sm text-zinc-400">Cargando formulario seguro…</p>}<div id={id} className="mt-4 min-h-20"/>{error&&<p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}</section>;
}
