"use client";

import { useEffect, useRef, useState } from "react";
import { OrderReceipt } from "@/components/admin/OrderReceipt";
import { DEFAULT_RECEIPT_IDENTITY, parseReceiptIdentity, type ReceiptIdentity } from "@/lib/receipt-identity";
import type { OrderReceipt as ReceiptData } from "@/lib/store/order-receipt";

// Preview data never creates an order, payment or financial movement.
const example: ReceiptData = {
  kind: "order", orderNumber: "MW-000007", soldAt: "2026-10-18T15:00:00Z", customerName: "Cliente de ejemplo",
  currency: "ARS", total: 20000, confirmedPaid: 5000, refundedAmount: 0, pendingAmount: 15000,
  paymentMethod: "Transferencia", paymentStatus: "Pago parcial", status: "valid",
  items: [{ name: "Producto de ejemplo", quantity: 2, unitPrice: 10000, lineTotal: 20000 }],
};
const field = "min-h-11 w-full rounded-xl border border-white/15 bg-zinc-900 p-3 text-white";
const button = "min-h-11 rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold disabled:opacity-40";

export function ReceiptIdentitySettings() {
  const [draft, setDraft] = useState<ReceiptIdentity>({ ...DEFAULT_RECEIPT_IDENTITY });
  const [revision, setRevision] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false), [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const lock = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/admin/receipt-identity", { cache: "no-store", signal: abort.signal }).then(async res => {
      const body = await res.json(); if (!res.ok) throw Error(body.error);
      setDraft(parseReceiptIdentity(body.settings)); setRevision(body.revision); setAvailable(body.available); setLoaded(true);
    }).catch(err => { if (!abort.signal.aborted) setMessage(err instanceof Error ? err.message : "No se pudo cargar el diseño."); });
    return () => abort.abort();
  }, []);
  function change<K extends keyof ReceiptIdentity>(key: K, value: ReceiptIdentity[K]) {
    setDraft(old => ({ ...old, [key]: value })); setMessage("Cambios sin guardar.");
  }
  async function upload(key: "mainLogo" | "watermarkLogo", file?: File) {
    if (!file || lock.current) return;
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 2 * 1024 * 1024) { setMessage("Elegí PNG o JPG de hasta 2 MB."); return; }
    lock.current = true; setBusy(true); setMessage("Preparando logo…");
    try {
      const data = new FormData(); data.set("file", file);
      const res = await fetch("/api/admin/receipt-identity/logo", { method: "POST", body: data });
      const body = await res.json(); if (!res.ok) throw Error(body.error);
      change(key, body.path);
    } catch (err) { setMessage(err instanceof Error ? err.message : "No se pudo subir el logo."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function save() {
    if (!loaded || !available || lock.current) return;
    let settings;
    try { settings = parseReceiptIdentity(draft); } catch (err) { setMessage((err as Error).message); return; }
    lock.current = true; setBusy(true); setMessage("Guardando…");
    try {
      const res = await fetch("/api/admin/receipt-identity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings, revision }) });
      const body = await res.json(); if (!res.ok) throw Error(body.error);
      setDraft(parseReceiptIdentity(body.settings)); setRevision(body.revision); setMessage("Diseño guardado para Minoristas y Mayoristas.");
    } catch (err) { setMessage(err instanceof Error ? err.message : "No se pudo guardar."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="min-w-0 space-y-5 p-4 text-zinc-100 sm:p-6" aria-label="Identidad visual de comprobantes">
    <p className="text-sm text-zinc-400">Un mismo diseño para Minoristas y Mayoristas, PDF, compartir e imprimir. Los cambios se publican al guardar.</p>
    {!loaded && <p role="status">{message || "Cargando diseño…"}</p>}
    {loaded && !available && <p role="status" className="rounded-xl border border-amber-400/30 p-3 text-sm text-amber-200">Podés revisar la vista previa. Guardar requiere habilitar primero la configuración en la base de datos.</p>}
    <fieldset disabled={!loaded || busy} className="min-w-0 space-y-5 disabled:opacity-60">
      <div className="grid min-w-0 gap-5 md:grid-cols-2">{([ ["mainLogo", "Logo principal"], ["watermarkLogo", "Marca de agua independiente"] ] as const).map(([key, label]) => <div key={key} className="min-w-0 space-y-3 rounded-2xl border border-white/10 p-4">
        <label className="block space-y-2 font-semibold"><span>{label}</span><input type="file" accept="image/png,image/jpeg" className={`${field} text-sm file:mr-2 file:rounded-lg file:border-0 file:p-2`} onChange={event => { void upload(key, event.target.files?.[0]); event.target.value = ""; }} /></label>
        <p className="text-xs text-zinc-400">PNG transparente o JPG · hasta 2 MB. Se conserva la proporción.</p>
        <div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={() => change(key, null)}>Quitar</button><button type="button" className={button} onClick={() => change(key, "default")}>Usar logo DCL</button></div>
        <p className="text-xs text-zinc-400">{draft[key] === null ? "Sin logo" : draft[key] === "default" ? "Logo DCL original" : "Logo personalizado"}</p>
      </div>)}</div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2"><span className="block font-semibold">Fondo</span><input type="color" className={`${field} h-12`} value={draft.background} onChange={e => change("background", e.target.value)} /></label>
        <label className="space-y-2"><span className="block font-semibold">Líneas y acentos</span><input type="color" className={`${field} h-12`} value={draft.accent} onChange={e => change("accent", e.target.value)} /></label>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Fondos predeterminados">{[["Gris suave", "#f0f1f3"], ["Blanco", "#ffffff"], ["Gris azulado", "#eef2f6"]].map(([label, color]) => <button key={color} type="button" className={button} onClick={() => change("background", color)}>{label}</button>)}</div>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="space-y-2"><span className="block">Tamaño de marca de agua: {draft.watermarkSize}%</span><input aria-label="Tamaño de marca de agua" type="range" min="40" max="100" value={draft.watermarkSize} className="min-h-11 w-full accent-red-500" onChange={e => change("watermarkSize", Number(e.target.value))} /></label>
        <label className="space-y-2"><span className="block">Intensidad: {Math.round(draft.watermarkOpacity * 100)}%</span><input aria-label="Intensidad" type="range" min="0" max="30" value={Math.round(draft.watermarkOpacity * 100)} className="min-h-11 w-full accent-red-500" onChange={e => change("watermarkOpacity", Number(e.target.value) / 100)} /></label>
        <label className="space-y-2"><span className="block">Tonalidad de la marca de agua</span><select className={field} value={draft.watermarkTone} onChange={e => change("watermarkTone", e.target.value as ReceiptIdentity["watermarkTone"])}><option value="original">Colores originales</option><option value="monochrome">Monocromática</option></select></label>
        <p className="self-center text-sm text-zinc-400">La marca de agua se mantiene centrada detrás del contenido.</p>
      </div>
      <div className="flex flex-wrap gap-3"><button type="button" disabled={!available} className={`${button} bg-red-700`} onClick={() => void save()}>Guardar cambios</button><button type="button" className={button} onClick={() => { setDraft({ ...DEFAULT_RECEIPT_IDENTITY }); setMessage("Diseño predeterminado en la vista previa. Guardá para confirmarlo."); }}>Restaurar diseño predeterminado</button></div>
    </fieldset>
    <p role="status" aria-live="polite" className="text-sm">{loaded ? message : ""}</p>
    {loaded && <details open className="min-w-0"><summary className="min-h-11 cursor-pointer py-3 font-semibold">Vista previa · datos de ejemplo</summary><div className="min-w-0 overflow-hidden rounded-xl"><OrderReceipt receipt={{ ...example, visual: draft }} /></div></details>}
  </section>;
}
