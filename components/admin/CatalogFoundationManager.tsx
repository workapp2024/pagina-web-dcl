"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProductEditorDialog } from "@/components/admin/ProductEditorDialog";
import type { CatalogCategory, CatalogVehicleType } from "@/lib/catalog-foundation";

type CategoryRow = CatalogCategory & { usage: { products: number; children: number; aliases: number } };
type VehicleRow = CatalogVehicleType & { usage: { products: number } };
type Draft = CatalogCategory | CatalogVehicleType;
const isCategory = (row: CategoryRow | VehicleRow): row is CategoryRow => "parent_id" in row;
const endpoint = "/api/admin/catalog-foundation";
const field = "mt-1.5 min-h-12 w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-base text-white outline-none focus:border-red-400";
const button = "min-h-12 rounded-xl border border-white/15 px-4 py-2 text-sm font-bold disabled:opacity-40";
const slug = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,120).replace(/-$/g,"");
const clean = (row: CategoryRow | VehicleRow): Draft => { const { usage, ...value } = row; void usage; return value; };
export function CatalogFoundationManager() {
  const [categories,setCategories] = useState<CategoryRow[]>([]), [vehicles,setVehicles] = useState<VehicleRow[]>([]);
  const [tab,setTab] = useState<"category" | "vehicle">("category"), [query,setQuery] = useState("");
  const [loading,setLoading] = useState(true), [busy,setBusy] = useState(false), [error,setError] = useState(""), [notice,setNotice] = useState("");
  const [draft,setDraft] = useState<Draft | null>(null), [expected,setExpected] = useState<Draft | null>(null);
  const [formError,setFormError] = useState("");
  const inFlight = useRef(false), loadId = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++loadId.current; setLoading(true); setError("");
    try {
      const response = await fetch(endpoint,{cache:"no-store"});
      const body = await response.json();
      if (!response.ok || !body.ok) throw Error(body.error || "No se pudo cargar el catálogo nuevo.");
      if (id === loadId.current) { setCategories(body.categories); setVehicles(body.vehicleTypes); }
    } catch (cause) { if (id === loadId.current) setError(cause instanceof Error ? cause.message : "No se pudo cargar."); }
    finally { if (id === loadId.current) setLoading(false); }
  },[]);
  useEffect(() => { let active = true; void Promise.resolve().then(() => { if (active) void refresh(); }); return () => { active = false; }; },[refresh]);
  function open(row?: CategoryRow | VehicleRow, parentId: string | null = null) {
    setFormError(""); setExpected(row ? clean(row) : null);
    setDraft(row ? clean(row) : tab === "category" ? {id:"",name:"",description:"",slug:"",parent_id:parentId,sort_order:10,active:true,form_profile:categories.find(c=>c.id===parentId)?.form_profile ?? "general"} : {id:"",name:"",sort_order:10,active:true});
  }
  function close() {
    if (inFlight.current) return;
    if (draft && !window.confirm("¿Cerrar sin guardar este formulario?")) return;
    setDraft(null); setFormError("");
  }
  async function write(method: string, payload: object) {
    if (inFlight.current) return;
    inFlight.current=true; setBusy(true); setError(""); setFormError(""); setNotice("");
    try {
      const response = await fetch(endpoint,{method,headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
      const body = await response.json();
      if (!response.ok || !body.ok) throw Error(body.error || "No se pudo guardar.");
      setDraft(null); setNotice(method === "DELETE" ? "Registro eliminado. Ningún producto fue modificado." : "Cambios guardados en el catálogo nuevo.");
      await refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Respuesta incierta. Volvé a cargar antes de reintentar.";
      setFormError(message); setError(message);
    } finally { inFlight.current=false; setBusy(false); }
  }
  const search = query.trim().toLocaleLowerCase();
  const rows: (CategoryRow | VehicleRow)[] = tab === "category" ? categories : vehicles;
  const shown = rows.filter(row=>[row.name,row.id,...(isCategory(row)?[row.description,categories.find(c=>c.id===row.parent_id)?.name ?? ""]:[])].some(text=>text.toLocaleLowerCase().includes(search)));
  return <div className="space-y-5">
    <header><p className="text-xs font-bold uppercase tracking-widest text-red-300">Administración</p><h1 className="mt-2 text-2xl font-black sm:text-3xl">Catálogo configurable</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">Prepará categorías y destinos. La tienda sigue usando su clasificación anterior; aquí no se reasignan productos.</p></header>
    <div className="flex gap-2" role="group" aria-label="Sección del catálogo">{([['category','Categorías'],['vehicle','Tipos de vehículo']] as const).map(([id,label])=><button key={id} disabled={busy || Boolean(draft)} aria-pressed={tab===id} onClick={()=>{setTab(id);setQuery("");setNotice("");}} className={button+(tab===id?" bg-red-600":" bg-zinc-900")}>{label}</button>)}</div>
    {tab === "vehicle" && <p className="rounded-xl border border-white/10 p-4 text-sm leading-6 text-zinc-300">Universal es un destino comercial excluyente, no confirma compatibilidad por marca, modelo o año.</p>}
    <div className="flex flex-col gap-3 sm:flex-row"><label className="min-w-0 flex-1 text-xs text-zinc-400">Buscar<input type="search" className={field} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nombre o identificador"/></label><button disabled={busy || loading || Boolean(error)} onClick={()=>open()} className={button+" self-start bg-red-600 sm:self-end"}>+ {tab==='category'?"Crear categoría":"Crear tipo"}</button></div>
    {notice && <p role="status" className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-sm text-emerald-200">{notice}</p>}
    {error && <div role="alert" className="rounded-xl border border-red-400/25 p-4 text-sm text-red-200"><p>{error}</p><button disabled={busy} onClick={()=>void refresh()} className={button+" mt-3"}>Volver a cargar</button></div>}
    {loading ? <p role="status" className="py-6 text-sm text-zinc-400">Cargando configuración…</p> : !error && <div className="space-y-3">{!shown.length && <p className="py-6 text-sm text-zinc-400">No hay resultados.</p>}{shown.map(row=>{
      const category = isCategory(row) ? row : null;
      const used = row.usage.products + (category ? category.usage.children + category.usage.aliases : 0);
      return <article key={row.id} className="rounded-2xl border border-white/10 bg-zinc-950 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-bold">{category && category.parent_id && <span className="text-zinc-500">{categories.find(c=>c.id===category.parent_id)?.name} / </span>}{row.name}</p><p className="mt-1 text-xs text-zinc-400">{row.active?"Activo":"Inactivo"} · Orden {row.sort_order} · {row.usage.products} productos nuevos</p>{category && <p className="mt-2 break-words text-sm text-zinc-400">{category.description || "Sin descripción"}</p>}</div><button disabled={busy} onClick={()=>open(row)} className={button}>Editar</button></div>
        <div className="mt-4 flex flex-wrap gap-2"><button disabled={busy} className={button} onClick={()=>void write('PATCH',{kind:tab,expected:clean(row),value:{...clean(row),active:!row.active}})}>{row.active?"Desactivar":"Activar"}</button>{category && !category.parent_id && <button disabled={busy} className={button} onClick={()=>open(undefined,row.id)}>+ Subcategoría</button>}<button disabled={busy || used>0} title={used?"Tiene asociaciones; no se elimina ni reasigna automáticamente":undefined} className={button+" text-red-300"} onClick={()=>{if(window.confirm('Eliminar "'+row.name+'" de forma permanente? Esta acción no modifica productos.'))void write('DELETE',{kind:tab,expected:clean(row)});}}>Eliminar</button></div>
        {used>0 && <p className="mt-3 text-xs leading-5 text-amber-200">Tiene asociaciones. La eliminación queda bloqueada; esta etapa no modifica ni reasigna productos.{category && (category.usage.children>0 || category.usage.aliases>0)?' También deben resolverse sus subcategorías y enlaces.':''}</p>}
      </article>;
    })}</div>}
    {draft && <ProductEditorDialog title={expected?"Editar registro":tab==='category'?"Nueva categoría":"Nuevo tipo de vehículo"} onClose={close} busy={busy}><form className="space-y-4" onSubmit={e=>{e.preventDefault();void write(expected?'PATCH':'POST',{kind:tab,value:draft,...(expected?{expected}:{})});}}>
      <label className="block text-sm">Nombre<input required maxLength={120} className={field} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value,...(!expected && 'slug' in draft?{slug:slug(e.target.value)}:{})})}/></label>
      {expected && <p className="break-all text-xs text-zinc-500">Identificador estable: {expected.id}</p>}
      {'slug' in draft && <><label className="block text-sm">Descripción<textarea maxLength={2000} rows={3} className={field} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label><label className="block text-sm">Slug<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={120} className={field} value={draft.slug} onChange={e=>setDraft({...draft,slug:e.target.value})}/></label><label className="block text-sm">Categoría superior (opcional)<select className={field} value={draft.parent_id ?? ''} onChange={e=>{const parent=categories.find(c=>c.id===e.target.value);setDraft({...draft,parent_id:parent?.id ?? null,...(!expected && parent?{form_profile:parent.form_profile}:{})});}}><option value="">Principal</option>{categories.filter(c=>!c.parent_id && c.id!==draft.id).map(c=><option key={c.id} value={c.id}>{c.name}{!c.active?' (inactiva)':''}</option>)}</select></label><label className="block text-sm">Perfil del formulario<select className={field} value={draft.form_profile} onChange={e=>setDraft({...draft,form_profile:e.target.value as 'general'|'lighting'})}><option value="general">General</option><option value="lighting">Iluminación</option></select></label></>}
      <label className="block text-sm">Orden de visualización<input required type="number" min={0} max={2147483647} step={1} className={field} value={draft.sort_order} onChange={e=>setDraft({...draft,sort_order:Number(e.target.value)})}/><span className="mt-1 block text-xs text-zinc-500">Los números menores aparecen primero.</span></label><label className="flex min-h-12 items-center gap-3 text-sm"><input type="checkbox" checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked})}/>Activo</label>
      {formError && <p role="alert" className="rounded-xl border border-red-400/30 p-3 text-sm text-red-200">{formError}</p>}
      <div className="sticky bottom-0 flex gap-2 border-t border-white/10 bg-zinc-950 py-3"><button disabled={busy} className={button+" flex-1 bg-red-600"}>{busy?'Guardando…':'Guardar'}</button><button type="button" disabled={busy} onClick={close} className={button}>Cancelar</button></div>
    </form></ProductEditorDialog>}
  </div>;
}
