"use client";
import { useState } from "react";
import { useSiteContent } from "@/components/providers/SiteContentProvider";
import { DEFAULT_THEME, themePresets, type ThemePreset } from "@/lib/theme";
import { upsertSupabaseSiteSettings } from "@/lib/supabase/site-settings";
import type { PaymentCardBrand, PaymentPresentationMethod } from "@/lib/site-data";
import { paymentCardBrands } from "@/lib/payment-presentation";

export function AppearanceSettings() {
  const { content, setContent } = useSiteContent();
  const [applied, setApplied] = useState<ThemePreset>(content.siteSettings.themePreset || DEFAULT_THEME);
  const [status, setStatus] = useState("");
  const selected = content.siteSettings.themePreset || DEFAULT_THEME;
  const preview = (themePreset: ThemePreset) => setContent((previous) => ({ ...previous, siteSettings: { ...previous.siteSettings, themePreset } }));
  async function apply() { setStatus("Guardando paleta…"); const result = await upsertSupabaseSiteSettings({ themePreset: selected }, "appearance"); if (!result.success) return setStatus(result.error || "No se pudo guardar la paleta."); setApplied(selected); setStatus("Paleta aplicada."); }
  return <section className="rounded-[1.75rem] border border-white/10 bg-zinc-950/80 p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-black">Apariencia</h2><p className="mt-2 text-sm text-zinc-400">Elegí una paleta. La estructura, tipografía y composición permanecen iguales.</p></div><span className="rounded-full bg-red-600/15 px-3 py-1 text-xs font-bold text-red-300">Activa: {themePresets.find((theme) => theme.id === applied)?.name}</span></div><div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">{themePresets.map((theme) => <button type="button" key={theme.id} onClick={() => preview(theme.id)} className={`rounded-2xl border p-4 text-left transition ${selected === theme.id ? "border-red-500 bg-red-600/10" : "border-white/10 hover:border-red-500/40"}`}><div className="overflow-hidden rounded-xl border border-white/10" style={{ backgroundColor: theme.swatches[0], color: theme.id === "clean-light" ? "#172033" : "#fff" }}><div className="flex items-center justify-between border-b border-black/10 px-3 py-2 text-[9px] font-bold"><span>DCL</span><span>PRODUCTOS · VENTAS</span></div><div className="grid grid-cols-[.8fr_1fr] gap-2 p-3"><div className="min-h-16 rounded-lg" style={{ backgroundColor: theme.swatches[1] }}/><div><b className="block text-sm">Título destacado</b><small className="block opacity-70">Métrica o producto</small><span className="mt-2 inline-block rounded px-2 py-1 text-[9px] font-bold" style={{ backgroundColor: theme.swatches[1] }}>ACCIONAR</span></div></div></div><b className="mt-4 block">{theme.name}</b><small className="mt-1 block text-zinc-400">{theme.description}</small>{selected === theme.id && <small className="mt-3 block font-bold text-red-300">Vista previa activa</small>}</button>)}</div><div className="mt-5 flex flex-wrap items-center gap-3"><button type="button" onClick={() => void apply()} className="rounded-full bg-red-600 px-5 py-3 text-xs font-bold uppercase">Aplicar paleta</button><button type="button" onClick={() => preview(applied)} className="rounded-full border border-white/15 px-5 py-3 text-xs font-bold uppercase">Restaurar tema activo</button>{status && <p className="text-sm text-zinc-400">{status}</p>}</div></section>;
}

export function TransferSettings() {
  const { content, setContent } = useSiteContent();
  const [status, setStatus] = useState(() => ((content.siteSettings.transferAlias.trim() || content.siteSettings.transferCbuCvu.trim()) && content.siteSettings.transferHolder.trim() && content.siteSettings.transferInstitution.trim()) ? "Transferencia configurada." : "Configuración incompleta.");
  const transfer = content.siteSettings;
  const configured = Boolean((transfer.transferAlias.trim() || transfer.transferCbuCvu.trim()) && transfer.transferHolder.trim() && transfer.transferInstitution.trim());
  const update = (key: "transferAlias" | "transferCbuCvu" | "transferHolder" | "transferInstitution" | "transferInstructions", value: string) => setContent(previous => ({ ...previous, siteSettings: { ...previous.siteSettings, [key]: value } }));
  async function save() { if (!configured) { setStatus("Configuración incompleta: indicá alias o CBU/CVU, titular e institución."); return; } setStatus("Guardando…"); const result = await upsertSupabaseSiteSettings(content.siteSettings, "transfer"); setStatus(result.success ? "Transferencia configurada." : result.error || "No se pudo guardar."); }
  const fields = [["transferAlias", "Alias"], ["transferCbuCvu", "CBU/CVU (opcional)"], ["transferHolder", "Titular"], ["transferInstitution", "Banco o billetera"]] as const;
  return <section className="rounded-[1.75rem] border border-white/10 bg-zinc-950/80 p-5 sm:p-6"><h2 className="text-xl font-black">Transferencia</h2><p className="mt-2 text-sm text-zinc-400">Datos mostrados en el checkout.</p><div className="mt-5 grid gap-4 md:grid-cols-2">{fields.map(([key,label])=><label key={key} className="text-sm"><span className="mb-2 block text-xs text-zinc-400">{label}</span><input value={content.siteSettings[key]} onChange={event=>update(key,event.target.value)} className="min-h-11 w-full rounded-xl bg-zinc-900 px-3"/></label>)}<label className="text-sm md:col-span-2"><span className="mb-2 block text-xs text-zinc-400">Texto adicional</span><textarea value={content.siteSettings.transferInstructions} onChange={event=>update("transferInstructions",event.target.value)} className="min-h-24 w-full rounded-xl bg-zinc-900 p-3"/></label></div><button type="button" onClick={()=>void save()} className="mt-5 rounded-full bg-red-600 px-5 py-3 text-xs font-bold uppercase">Guardar transferencia</button>{status&&<span className="ml-3 text-sm text-zinc-400">{status}</span>}</section>;
}

export function PaymentPresentationSettings() {
  const { content, setContent } = useSiteContent();
  const [status, setStatus] = useState("");
  const settings = content.siteSettings;
  function updateMethod(id: PaymentPresentationMethod["id"], patch: Partial<PaymentPresentationMethod>) {
    setContent(previous => ({ ...previous, siteSettings: { ...previous.siteSettings, paymentPresentationMethods: previous.siteSettings.paymentPresentationMethods.map(method => method.id === id ? { ...method, ...patch } : method) } }));
  }
  function updateCardBrand(id: PaymentCardBrand["id"], patch: Partial<PaymentCardBrand>) {
    const current = settings.paymentPresentationMethods.find(method => method.id === "card")?.cardBrands || [];
    updateMethod("card", { cardBrands: current.map(brand => brand.id === id ? { ...brand, ...patch } : brand) });
  }
  async function save() {
    if (settings.paymentPresentationMethods.some(method => method.id === "transfer" && method.enabled)) {
      const transfer = settings;
      if (!(transfer.transferAlias.trim() || transfer.transferCbuCvu.trim()) || !transfer.transferHolder.trim() || !transfer.transferInstitution.trim()) {
        setStatus("Configurá alias o CBU/CVU, titular e institución antes de mostrar transferencias."); return;
      }
    }
    setStatus("Guardando…");
    const result = await upsertSupabaseSiteSettings(settings, "payments");
    setStatus(result.success ? "Presentación de pagos guardada." : result.error || "No se pudo guardar.");
  }
  const toggle = (key: "paymentPresentationEnabled" | "paymentPresentationHome" | "paymentPresentationWholesale" | "paymentPresentationCheckout") =>
    setContent(previous => ({ ...previous, siteSettings: { ...previous.siteSettings, [key]: !previous.siteSettings[key] } }));
  return <section className="rounded-[1.75rem] border border-white/10 bg-zinc-950/80 p-5 sm:p-6">
    <h2 className="text-xl font-black">Medios de pago visibles</h2>
    <p className="mt-2 text-sm text-zinc-400">Controla solo la información comercial. La habilitación real para cobrar es independiente. Activá una marca solo si Mercado Pago la acepta para tu cuenta. Cargar un logo nunca activa un medio.</p>
    <div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-sm">Título<input maxLength={120} value={settings.paymentPresentationTitle} onChange={e=>setContent(p=>({...p,siteSettings:{...p.siteSettings,paymentPresentationTitle:e.target.value}}))} className="mt-1 w-full rounded-lg bg-zinc-900 p-2"/></label><label className="text-sm">Descripción<input maxLength={240} value={settings.paymentPresentationDescription} onChange={e=>setContent(p=>({...p,siteSettings:{...p.siteSettings,paymentPresentationDescription:e.target.value}}))} className="mt-1 w-full rounded-lg bg-zinc-900 p-2"/></label></div>
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">{([["paymentPresentationEnabled","Mostrar sección"],["paymentPresentationHome","Home"],["paymentPresentationWholesale","Mayoristas"],["paymentPresentationCheckout","Checkout"]] as const).map(([key,label])=><label key={key} className="flex items-center gap-2"><input type="checkbox" checked={settings[key]} onChange={()=>toggle(key)}/>{label}</label>)}</div>
    <div className="mt-4 space-y-3">{settings.paymentPresentationMethods.map(method=><article key={method.id} className="grid gap-3 rounded-xl border border-white/10 p-3 md:grid-cols-[140px_1fr_1.2fr_90px]"><div><b className="block">{method.id === "card" ? "Tarjeta" : method.id === "mercadopago" ? "Mercado Pago" : "Transferencia"}</b><label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={method.enabled} onChange={e=>updateMethod(method.id,{enabled:e.target.checked})}/>Visible</label></div><label className="text-xs text-zinc-400">Nombre<input maxLength={60} value={method.name} onChange={e=>updateMethod(method.id,{name:e.target.value})} className="mt-1 w-full rounded-lg bg-zinc-900 p-2 text-sm text-white"/></label><label className="text-xs text-zinc-400">Logo opcional · URL HTTPS<input maxLength={1000} value={method.logoUrl} onChange={e=>updateMethod(method.id,{logoUrl:e.target.value})} placeholder="URL pública de un logo autorizado" className="mt-1 w-full rounded-lg bg-zinc-900 p-2 text-sm text-white"/></label><label className="text-xs text-zinc-400">Orden<input type="number" min="0" max="1000" value={method.sortOrder} onChange={e=>updateMethod(method.id,{sortOrder:Number(e.target.value)})} className="mt-1 w-full rounded-lg bg-zinc-900 p-2 text-sm text-white"/></label><div className="flex flex-wrap gap-4 text-xs md:col-span-4">{([["showHome","Home"],["showWholesale","Mayoristas"],["showCheckout","Checkout"]] as const).map(([key,label])=><label key={key} className="flex items-center gap-2"><input type="checkbox" checked={method[key]} onChange={e=>updateMethod(method.id,{[key]:e.target.checked})}/>{label}</label>)}</div></article>)}</div>
    <div className="mt-4 rounded-xl border border-white/10 p-3"><h3 className="font-bold">Marcas de tarjeta aceptadas</h3><p className="mt-1 text-xs text-zinc-400">Activá solo marcas habilitadas en la cuenta de Mercado Pago. Se muestran dentro de Tarjetas y nunca activan cobros. Para logotipos, cargá una URL HTTPS de un recurso oficial o autorizado; sin URL se muestra el nombre.</p>{paymentCardBrands.map(definition=>{const brand=settings.paymentPresentationMethods.find(method=>method.id==="card")?.cardBrands?.find(item=>item.id===definition.id)||{...definition,logoUrl:"",enabled:false,sortOrder:0};return <div key={brand.id} className="mt-3 grid gap-2 sm:grid-cols-[180px_1fr_100px]"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={brand.enabled} onChange={e=>updateCardBrand(brand.id,{enabled:e.target.checked})}/>{brand.name}</label><label className="text-xs text-zinc-400">Logo autorizado · URL HTTPS<input maxLength={1000} value={brand.logoUrl} onChange={e=>updateCardBrand(brand.id,{logoUrl:e.target.value})} placeholder="Sin URL: mostrar nombre" className="mt-1 w-full rounded-lg bg-zinc-900 p-2 text-sm text-white"/></label><label className="text-xs text-zinc-400">Orden<input type="number" min="0" max="1000" value={brand.sortOrder} onChange={e=>updateCardBrand(brand.id,{sortOrder:Number(e.target.value)})} className="mt-1 w-full rounded-lg bg-zinc-900 p-2 text-sm text-white"/></label></div>;})}</div>
    <button type="button" onClick={()=>void save()} className="mt-4 rounded-full bg-red-600 px-5 py-3 text-xs font-bold uppercase">Guardar medios visibles</button>{status&&<p role="status" className="mt-3 text-sm text-zinc-400">{status}</p>}
  </section>;
}
