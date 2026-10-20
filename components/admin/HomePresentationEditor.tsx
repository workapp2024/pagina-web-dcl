/* eslint-disable @next/next/no-img-element */
"use client";
import { useEffect, useRef, useState } from "react";
import { defaultHomePresentation, validateHomePresentation, type HomePresentation } from "@/lib/home-presentation";
import { upsertSupabaseSiteSettings } from "@/lib/supabase/site-settings";
import { MAX_FILE_SIZE_BYTES } from "@/lib/supabase/storage";
import { HomeFaq, HomePaymentImage } from "@/components/sections/HomePresentation";

const control = "mt-2 min-h-12 w-full min-w-0 rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-base text-white";
const button = "min-h-12 rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold disabled:opacity-40";
export function HomePresentationEditor() {
  const [draft, setDraft] = useState<HomePresentation>(defaultHomePresentation);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [preview, setPreview] = useState(false), [image, setImage] = useState<{ file: File; url: string } | null>(null);
  const imageRef = useRef<{ file: File; url: string } | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/admin/home-presentation", { cache: "no-store", signal: abort.signal }).then(async response => {
      const body = await response.json(); if (!response.ok) throw Error(body.error || "No se pudo cargar la configuración.");
      setDraft(validateHomePresentation(body.settings)); setReady(true);
    }).catch(error => { if (!abort.signal.aborted) setMessage(error.message); });
    return () => { abort.abort(); if (imageRef.current) URL.revokeObjectURL(imageRef.current.url); };
  }, []);
  function change(patch: Partial<HomePresentation>) { setDraft(old => ({ ...old, ...patch })); setMessage("Cambios sin guardar."); }
  function clearImage() { if (imageRef.current) URL.revokeObjectURL(imageRef.current.url); imageRef.current = null; setImage(null); }
  function move(index: number, delta: number) { const items = [...draft.faqItems]; [items[index], items[index + delta]] = [items[index + delta], items[index]]; change({ faqItems: items }); }
  async function save() {
    if (inFlight.current || !ready) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      let value = validateHomePresentation(draft);
      if (imageRef.current) {
        const form = new FormData(); form.append("file", imageRef.current.file); form.append("category", "site"); form.append("idHint", "home-payment-image");
        const response = await fetch("/api/admin/upload", { method: "POST", body: form });
        const body = await response.json(); if (!response.ok || !body.publicUrl) throw Error(body.error || "No se pudo subir la imagen.");
        value = validateHomePresentation({ ...value, homePaymentImage: body.publicUrl });
        // Keep the uploaded URL on a failed settings save; retry does not upload again.
        setDraft(value); clearImage();
      }
      const result = await upsertSupabaseSiteSettings(value, "homePresentation");
      if (!result.success) throw Error(result.error || "No se pudieron guardar los cambios.");
      setDraft(value); setMessage("Cambios guardados. La Home mostrará la configuración publicada.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const shown = { ...draft, homePaymentImage: image?.url || draft.homePaymentImage };
  return <section className="min-w-0 space-y-4 rounded-3xl border border-white/10 bg-zinc-950/80 p-4 sm:p-6">
    <h2 className="text-xl font-black">Preguntas frecuentes y medios de pago de la Home</h2>
    <p className="text-sm text-zinc-400">Prepará los cambios, revisá la vista previa y guardá para publicarlos.</p>
    <fieldset disabled={!ready || busy} className="min-w-0 space-y-5 disabled:opacity-60">
      <details className="rounded-2xl border border-white/10 p-4">
        <summary className="min-h-12 cursor-pointer py-3 text-lg font-bold">Preguntas frecuentes</summary>
        <label className="flex min-h-12 items-center gap-3"><input type="checkbox" checked={draft.faqEnabled} onChange={e => change({ faqEnabled: e.target.checked })} />Mostrar sección en la Home</label>
        <p className="mb-4 text-sm text-zinc-400">Cargá únicamente respuestas aprobadas por DCL. Las preguntas desactivadas no se publican.</p>
        <div className="space-y-4">{draft.faqItems.map((item, index) => <div key={item.id} className="min-w-0 space-y-3 rounded-xl border border-white/15 p-3 sm:p-4">
          <label className="block text-sm">Pregunta {index + 1}<input maxLength={250} className={control} value={item.question} onChange={e => change({ faqItems: draft.faqItems.map(f => f.id === item.id ? { ...f, question: e.target.value } : f) })} /></label>
          <label className="block text-sm">Respuesta<textarea maxLength={3000} rows={4} className={control} value={item.answer} onChange={e => change({ faqItems: draft.faqItems.map(f => f.id === item.id ? { ...f, answer: e.target.value } : f) })} /></label>
          <label className="flex min-h-12 items-center gap-3"><input type="checkbox" checked={item.enabled} onChange={e => change({ faqItems: draft.faqItems.map(f => f.id === item.id ? { ...f, enabled: e.target.checked } : f) })} />Pregunta visible</label>
          <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={index === 0 || busy} onClick={() => move(index, -1)} aria-label={`Subir pregunta ${index + 1}`}>Subir</button><button type="button" className={button} disabled={index === draft.faqItems.length - 1 || busy} onClick={() => move(index, 1)} aria-label={`Bajar pregunta ${index + 1}`}>Bajar</button><button type="button" className={`${button} text-red-300`} onClick={() => { if (window.confirm("¿Quitar esta pregunta? El cambio se publica al guardar.")) change({ faqItems: draft.faqItems.filter(f => f.id !== item.id) }); }}>Eliminar pregunta</button></div>
        </div>)}</div>
        <button type="button" className={`${button} mt-4`} disabled={busy || draft.faqItems.length >= 30} onClick={() => change({ faqItems: [...draft.faqItems, { id: crypto.randomUUID(), question: "", answer: "", enabled: false }] })}>Agregar pregunta</button>
      </details>
      <details className="rounded-2xl border border-white/10 p-4">
        <summary className="min-h-12 cursor-pointer py-3 text-lg font-bold">Imagen de medios de pago</summary>
        <label className="flex min-h-12 items-center gap-3"><input type="checkbox" checked={draft.homePaymentEnabled} onChange={e => change({ homePaymentEnabled: e.target.checked })} />Mostrar sección en la Home</label>
        <label className="block text-sm">Título<input maxLength={150} className={control} value={draft.homePaymentTitle} onChange={e => change({ homePaymentTitle: e.target.value })} /></label>
        <p className="my-3 text-sm text-zinc-400">Usá PNG o JPG de hasta 10 MB. PNG conserva su transparencia; JPG conserva su fondo. Incluí solo los medios realmente aceptados. Esta imagen no habilita pagos ni cambia el checkout.</p>
        <label className="block text-sm">Subir o reemplazar imagen<input type="file" accept="image/png,image/jpeg" className={`${control} py-3`} onChange={e => {
          const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
          if (!["image/png", "image/jpeg"].includes(file.type) || file.size > MAX_FILE_SIZE_BYTES) { setMessage("Elegí un PNG o JPG de hasta 10 MB."); return; }
          clearImage(); const next = { file, url: URL.createObjectURL(file) }; imageRef.current = next; setImage(next); setMessage("Imagen seleccionada. Todavía no está publicada.");
        }} /></label>
        {shown.homePaymentImage && <><img src={shown.homePaymentImage} alt="Vista previa de la imagen seleccionada" className="mx-auto my-4 h-auto max-h-48 max-w-full object-contain" /><button type="button" className={button} onClick={() => { clearImage(); change({ homePaymentImage: "" }); }}>Quitar imagen</button></>}
        {!shown.homePaymentImage && <p className="mt-3 text-sm text-zinc-400">Sin imagen, esta sección no aparece en la Home.</p>}
      </details>
      <div className="flex flex-wrap gap-3"><button type="button" className={button} onClick={() => setPreview(!preview)}>{preview ? "Cerrar vista previa" : "Vista previa"}</button><button type="button" className={`${button} bg-red-600`} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar cambios"}</button></div>
    </fieldset>
    {message && <p role="status" className="text-sm text-amber-100">{message}</p>}
    {preview && <div className="rounded-2xl border border-white/15 bg-black text-white"><p className="p-4 text-sm text-zinc-400">Vista previa de lo que se publicará (según visibilidad y preguntas activas).</p><HomePaymentImage settings={shown} /><HomeFaq settings={shown} /></div>}
  </section>;
}
