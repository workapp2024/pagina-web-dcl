"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSiteContent } from "@/components/providers/SiteContentProvider";
import { ManagedImage } from "@/components/ui/ManagedImage";
import { WhatsAppButton } from "@/components/ui/WhatsAppButton";
import { ProductPurchaseActions } from "@/components/store/ProductPurchaseActions";
import { analyticsEvents, capture } from "@/lib/analytics";
import { getPublicVehicleBrands, getPublicVehicleModels, searchPublicVehicleCompatibilities, VEHICLE_TYPES, type VehicleBrand, type VehicleModel } from "@/lib/supabase/vehicle-compatibility";
import { vehiclePositions, vehicleProductMatches, vehicleReferenceLinks } from "@/lib/vehicle-product-search";

const control = "min-h-12 w-full rounded-xl border border-white/10 bg-zinc-900 px-3 text-white disabled:opacity-40";
const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase("es") === b.trim().toLocaleLowerCase("es");

export function VehicleFinder() {
  const { content } = useSiteContent();
  const [type, setType] = useState("");
  const [brands, setBrands] = useState<VehicleBrand[]>([]);
  const [brandName, setBrandName] = useState("");
  const [models, setModels] = useState<VehicleModel[]>([]);
  const [modelName, setModelName] = useState("");
  const [year, setYear] = useState("");
  const [position, setPosition] = useState("");
  const [matches, setMatches] = useState<ReturnType<typeof vehicleProductMatches> | null>(null);
  const [searching, setSearching] = useState(false);
  const request = useRef(0);
  const brand = brands.find(item => sameName(item.name, brandName));
  const model = models.find(item => sameName(item.name, modelName));
  const context = { type, brand: brandName, model: modelName, year, position };
  const references = vehicleReferenceLinks(context);
  function invalidate() { request.current++; setMatches(null); setSearching(false); }

  useEffect(() => {
    let current = true;
    if (type) getPublicVehicleBrands(type).then(rows => { if (current) setBrands(rows ?? []); });
    return () => { current = false; };
  }, [type]);
  useEffect(() => {
    let current = true;
    if (brand) getPublicVehicleModels(brand.id, type).then(rows => { if (current) setModels(rows ?? []); });
    return () => { current = false; };
  }, [brand, type]);

  async function search() {
    if (!type || !brandName.trim() || !modelName.trim() || !/^\d{4}$/.test(year)) return;
    const version = ++request.current;
    setSearching(true); setMatches(null);
    capture(analyticsEvents.vehicleSearchStarted);
    try {
      const rows = brand && model ? await searchPublicVehicleCompatibilities(type, brand.id, model.id) : [];
      if (version !== request.current) return;
      const found = vehicleProductMatches(content.products, rows ?? [], year, position);
      setMatches(found);
      const props = { vehicle_type: type, brand: brandName, model: modelName, year_provided: true, result_count: found.length };
      capture(found.length ? analyticsEvents.vehicleSearchCompleted : analyticsEvents.vehicleSearchNoResults, props);
      if (found.length) capture(analyticsEvents.fitmentResultViewed, { result_count: found.length });
    } catch { if (version === request.current) setMatches([]); }
    finally { if (version === request.current) setSearching(false); }
  }

  return <div className="space-y-5">
    <form onSubmit={event => { event.preventDefault(); void search(); }} className="rounded-[1.75rem] border border-white/10 bg-zinc-950/60 p-5 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="space-y-2 text-sm">Tipo de vehículo<select required value={type} className={control} onChange={event => { invalidate(); setType(event.target.value); setBrands([]); setBrandName(""); setModels([]); setModelName(""); setYear(""); setPosition(""); }}><option value="">Seleccioná</option>{VEHICLE_TYPES.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="space-y-2 text-sm">Marca<input required disabled={!type} list="fitment-brands" maxLength={80} value={brandName} className={control} onChange={event => { invalidate(); setBrandName(event.target.value); setModels([]); setModelName(""); setYear(""); setPosition(""); }} /><datalist id="fitment-brands">{brands.map(item => <option key={item.id} value={item.name} />)}</datalist></label>
        <label className="space-y-2 text-sm">Modelo<input required disabled={!brandName.trim()} list="fitment-models" maxLength={80} value={modelName} className={control} onChange={event => { invalidate(); setModelName(event.target.value); setYear(""); setPosition(""); }} /><datalist id="fitment-models">{models.map(item => <option key={item.id} value={item.name} />)}</datalist></label>
        <label className="space-y-2 text-sm">Año<input required disabled={!modelName.trim()} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={year} className={control} onChange={event => { invalidate(); setYear(event.target.value); setPosition(""); }} /></label>
        <label className="space-y-2 text-sm">Posición<select disabled={!type || !brandName.trim() || !modelName.trim() || !/^\d{4}$/.test(year)} value={position} className={control} onChange={event => { invalidate(); setPosition(event.target.value); }}><option value="">Todas las posiciones</option>{type && brandName.trim() && modelName.trim() && /^\d{4}$/.test(year) && vehiclePositions.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      </div>
      <p className="mt-3 text-xs text-zinc-400">Elegí una sugerencia o escribí tu marca/modelo si no aparece. Solo confirmamos productos con compatibilidad cargada para el año y la posición.</p>
      <button type="submit" disabled={searching || !type || !brandName.trim() || !modelName.trim() || !/^\d{4}$/.test(year)} className="mt-5 min-h-12 rounded-full bg-red-600 px-8 text-sm font-bold disabled:opacity-40">{searching ? "Buscando…" : "Buscar"}</button>
      <Link href="/productos" className="ml-4 inline-flex min-h-12 items-center text-sm text-red-300 underline">Ya sé el conector</Link>
    </form>
    {matches !== null && <div aria-live="polite">
      <h3 className="mb-3 text-lg font-black">{matches.length ? "Productos compatibles" : "No encontramos productos con compatibilidad confirmada"}</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{matches.map(({ product, row, position: selectedPosition, connector }) => {
        const href = product.href + '?fitment=' + encodeURIComponent(row.id) + '&position=' + selectedPosition.key + '&year=' + encodeURIComponent(year);
        const cartProduct = { id: product.id, name: product.name, price: product.price, image: product.image, href, category: product.category };
        return <article key={product.id + '-' + row.id + '-' + selectedPosition.key} className="rounded-2xl border border-white/10 bg-white/5 p-3"><Link href={href} className="flex gap-3"><div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-black p-2"><ManagedImage source={product.image} alt={product.name} className="max-h-full max-w-full object-contain" /></div><div><b>{product.name}</b><small className="mt-1 block text-zinc-400">{row.brandName} {row.modelName} {year}</small><small className="block text-zinc-400">{selectedPosition.label} · {connector}</small><span className="mt-2 block text-xs font-bold text-red-300">Ver producto →</span></div></Link><div className="mt-3"><ProductPurchaseActions product={cartProduct} compact /></div></article>;
      })}</div>
    </div>}
    <div className="rounded-2xl border border-white/10 p-5 text-center">
      <p className="font-bold">¿No encontraste tu vehículo o tenés dudas?</p>
      <p className="mt-2 text-sm text-zinc-400">Una referencia externa no confirma compatibilidad; consultanos antes de comprar.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-3"><a href={references.google} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center rounded-full border border-white/20 px-5 text-sm font-bold">Buscar referencia en Google</a><WhatsAppButton source="vehicle_search" message={references.whatsappMessage} label="Consultar por WhatsApp" className="min-h-12" /></div>
    </div>
  </div>;
}
