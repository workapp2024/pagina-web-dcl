"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { OrderReceipt } from "@/components/admin/OrderReceipt";
import { DEFAULT_RECEIPT_IDENTITY, parseReceiptIdentity, receiptLogoSource, RECEIPT_ASSET, type ReceiptIdentity } from "@/lib/receipt-identity";
import { prepareReceiptLogo, RECEIPT_LOGO_ORIGINAL_MAX_BYTES } from "@/lib/receipt-logo-client";
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
type LogoKey = "mainLogo" | "watermarkLogo";
type SelectedLogo = { url: string; name: string; file?: File; transparent?: boolean; width?: number; height?: number; path?: string };
async function responseBody(response: Response) {
  if(response.status===413)throw Error("No se pudo enviar la imagen por su tamaño. Volvé a seleccionarla para optimizarla.");
  let body;try{body=await response.json();}catch{throw Error("No se recibió una respuesta válida. Revisá tu conexión y volvé a intentarlo.");}
  if(!response.ok)throw Error(body.error || "No se pudo completar la operación. Volvé a intentarlo.");
  return body;
}

export function ReceiptIdentitySettings() {
  const [draft, setDraft] = useState<ReceiptIdentity>({ ...DEFAULT_RECEIPT_IDENTITY });
  const [revision, setRevision] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false), [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Partial<Record<LogoKey, SelectedLogo>>>({});
  const [errors, setErrors] = useState<Partial<Record<LogoKey, string>>>({});
  const selectedRef = useRef<Partial<Record<LogoKey, SelectedLogo>>>({});
  const urls = useRef(new Set<string>());
  const retryable = useRef(new Set<LogoKey>());
  const lock = useRef(false);
  useEffect(()=>{const current=urls.current;return ()=>{for(const url of current)URL.revokeObjectURL(url);};},[]);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/admin/receipt-identity", { cache: "no-store", signal: abort.signal }).then(async res => {
      const body = await responseBody(res);
      setDraft(parseReceiptIdentity(body.settings)); setRevision(body.revision); setAvailable(body.available); setLoaded(true);
    }).catch(err => { if (!abort.signal.aborted) setMessage(err instanceof Error ? err.message : "No se pudo cargar el diseño."); });
    return () => abort.abort();
  }, []);
  function change<K extends keyof ReceiptIdentity>(key: K, value: ReceiptIdentity[K]) {
    setDraft(old => ({ ...old, [key]: value })); setMessage("Cambios sin guardar.");
  }
  function clearSelected(key: LogoKey) {
    const current=selectedRef.current[key];if(current){URL.revokeObjectURL(current.url);urls.current.delete(current.url);}
    delete selectedRef.current[key];setSelected({...selectedRef.current});setErrors(old=>({...old,[key]:undefined}));
    retryable.current.delete(key);
  }
  function chooseExisting(key: LogoKey, value: string | null) { clearSelected(key);change(key,value); }
  async function selectFile(key: LogoKey, file?: File) {
    if (!file || lock.current) return;
    const fail=(message:string)=>{retryable.current.delete(key);setErrors(old=>({...old,[key]:message}));setMessage("No se cambió el logo guardado. Revisá el error junto a la imagen.");};
    if (!["image/png", "image/jpeg", ""].includes(file.type)) { fail("Elegí un PNG o JPG. Otros formatos no están admitidos.");return; }
    if (!file.size || file.size > RECEIPT_LOGO_ORIGINAL_MAX_BYTES) { fail("La imagen supera el límite de 5 MB. Exportala con menor tamaño desde Canva.");return; }
    lock.current = true; setBusy(true);clearSelected(key);setMessage("Preparando vista previa…");
    const originalUrl=URL.createObjectURL(file);urls.current.add(originalUrl);
    selectedRef.current[key]={url:originalUrl,name:file.name};setSelected({...selectedRef.current});
    try {
      const prepared=await prepareReceiptLogo(file),url=URL.createObjectURL(prepared.file);urls.current.add(url);
      URL.revokeObjectURL(originalUrl);urls.current.delete(originalUrl);
      selectedRef.current[key]={...prepared,url,name:file.name};setSelected({...selectedRef.current});
      setMessage("Imagen seleccionada, todavía sin guardar. Revisá la vista previa y guardá los cambios.");
    } catch (err) { clearSelected(key);fail(err instanceof Error ? err.message : "No se pudo preparar la imagen."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function save() {
    if (!loaded || !available || lock.current) return;
    if((Object.keys(errors) as LogoKey[]).some(key=>errors[key]&&!retryable.current.has(key))){setMessage("Revisá los errores junto a los logos antes de guardar.");return;}
    let settings;
    try { settings = parseReceiptIdentity(draft); } catch (err) { setMessage((err as Error).message); return; }
    lock.current = true; setBusy(true); setMessage("Guardando…");
    try {
      for(const key of ["mainLogo","watermarkLogo"] as const){
        const pending=selectedRef.current[key];if(!pending)continue;
        try {
          if(!pending.file)throw Error("La imagen todavía no está preparada. Volvé a seleccionarla.");
          if(!pending.path){
            const data=new FormData();data.set("file",pending.file);setMessage(`Guardando ${key==="mainLogo"?"logo principal":"marca de agua"}…`);
            const uploaded=await responseBody(await fetch("/api/admin/receipt-identity/logo",{method:"POST",body:data}));
            if(typeof uploaded.path!=="string"||!RECEIPT_ASSET.test(uploaded.path))throw Error("No se pudo confirmar la carga de la imagen.");
            pending.path=uploaded.path;
          }
          const uploadedPath=pending.path;if(!uploadedPath)throw Error("No se pudo confirmar la carga.");
          const image=new window.Image();image.src=receiptLogoSource(uploadedPath)!;
          try{await image.decode();}catch{throw Error("La imagen se subió, pero no se puede recuperar. Revisá tu sesión y volvé a guardar.");}
          settings={...settings,[key]:pending.path};
        } catch(err){retryable.current.add(key);setErrors(old=>({...old,[key]:err instanceof Error?err.message:"No se pudo guardar esta imagen."}));throw err;}
      }
      const res = await fetch("/api/admin/receipt-identity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings, revision }) });
      const body = await responseBody(res),persisted=parseReceiptIdentity(body.settings);
      if(Object.entries(settings).some(([key,value])=>persisted[key as keyof ReceiptIdentity]!==value))throw Error("No se pudo confirmar el diseño guardado. Recargá para comprobarlo.");
      setDraft(persisted); setRevision(body.revision);for(const key of ["mainLogo","watermarkLogo"] as const)clearSelected(key);setMessage("Diseño guardado correctamente para Minoristas y Mayoristas.");
    } catch (err) { setMessage(`No se confirmó el guardado. ${err instanceof Error ? err.message : "Volvé a intentarlo."}`); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="min-w-0 space-y-5 p-4 text-zinc-100 sm:p-6" aria-label="Identidad visual de comprobantes">
    <p className="text-sm text-zinc-400">Un mismo diseño para Minoristas y Mayoristas, PDF, compartir e imprimir. Los cambios se publican al guardar.</p>
    {!loaded && <p role="status">{message || "Cargando diseño…"}</p>}
    {loaded && !available && <p role="status" className="rounded-xl border border-amber-400/30 p-3 text-sm text-amber-200">Podés revisar la vista previa. Guardar requiere habilitar primero la configuración en la base de datos.</p>}
    <fieldset disabled={!loaded || busy} className="min-w-0 space-y-5 disabled:opacity-60">
      <div className="grid min-w-0 gap-5 md:grid-cols-2">{([ ["mainLogo", "Logo principal"], ["watermarkLogo", "Marca de agua independiente"] ] as const).map(([key, label]) => <div key={key} className="min-w-0 space-y-3 rounded-2xl border border-white/10 p-4">
        <label className="block space-y-2 font-semibold"><span>{label}</span><input type="file" accept="image/png,image/jpeg" aria-describedby={`${key}-help ${key}-state`} aria-invalid={!!errors[key]} className={`${field} text-sm file:mr-2 file:rounded-lg file:border-0 file:p-2`} onChange={event => { void selectFile(key, event.target.files?.[0]); event.target.value = ""; }} /></label>
        <p id={`${key}-help`} className="text-xs text-zinc-400">PNG transparente o JPG · originales de hasta 5 MB y 4096 píxeles por lado. Se optimizan antes de subir, conservando proporciones y transparencia.</p>
        {(selected[key]?.url || receiptLogoSource(draft[key])) && <div className="rounded-xl border border-white/20 p-2" style={{backgroundColor:"#ddd",backgroundImage:"linear-gradient(45deg,#bbb 25%,transparent 25%),linear-gradient(-45deg,#bbb 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#bbb 75%),linear-gradient(-45deg,transparent 75%,#bbb 75%)",backgroundSize:"16px 16px",backgroundPosition:"0 0,0 8px,8px -8px,-8px 0"}}><Image src={selected[key]?.url || receiptLogoSource(draft[key])!} width={160} height={100} alt={`Vista previa: ${label}`} unoptimized className="mx-auto h-28 max-w-full object-contain" onError={()=>setErrors(old=>({...old,[key]:"No se pudo mostrar esta imagen. Volvé a seleccionarla o recargá tu sesión."}))}/></div>}
        <div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={() => chooseExisting(key, null)}>Quitar</button><button type="button" className={button} onClick={() => chooseExisting(key, "default")}>Usar logo DCL</button></div>
        <p id={`${key}-state`} className="break-words text-xs text-zinc-300">{selected[key] ? `${selected[key]!.name} · ${selected[key]!.file ? "Seleccionada, sin guardar" : "Preparando vista previa…"}` : draft[key] === null ? "Sin logo" : draft[key] === "default" ? "Logo DCL original" : "Imagen guardada"}</p>
        {selected[key]?.file && <p className="text-xs text-zinc-300">{selected[key]!.width} × {selected[key]!.height} px · {selected[key]!.transparent ? "Transparencia comprobada" : "Imagen sin transparencia: su fondo se conserva"}</p>}
        {errors[key] && <p role="alert" className="text-sm text-red-300">{errors[key]}</p>}
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
      <div className="flex flex-wrap gap-3"><button type="button" disabled={!available} className={`${button} bg-red-700`} onClick={() => void save()}>Guardar cambios</button><button type="button" className={button} onClick={() => {for(const key of ["mainLogo","watermarkLogo"] as const)clearSelected(key);setDraft({ ...DEFAULT_RECEIPT_IDENTITY }); setMessage("Diseño predeterminado en la vista previa. Guardá para confirmarlo."); }}>Restaurar diseño predeterminado</button></div>
    </fieldset>
    <p role="status" aria-live="polite" className="text-sm">{loaded ? message : ""}</p>
    {loaded && <details open className="min-w-0"><summary className="min-h-11 cursor-pointer py-3 font-semibold">Vista previa · datos de ejemplo</summary><div className="min-w-0 overflow-hidden rounded-xl"><OrderReceipt receipt={{ ...example, visual: draft }} previewLogos={{mainLogo:selected.mainLogo?.url,watermarkLogo:selected.watermarkLogo?.url}} /></div></details>}
  </section>;
}
