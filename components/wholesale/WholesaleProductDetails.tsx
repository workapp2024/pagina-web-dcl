"use client";

import { useEffect, useRef } from "react";
import { ProductImageGallery } from "@/components/public/ProductImageGallery";
import { productVehicleTypes } from "@/lib/product-taxonomy";
import type { WholesaleCatalogItem } from "@/lib/wholesale-server";

export function WholesaleProductDetails({ product, compatibility, onClose }: { product: WholesaleCatalogItem | null; compatibility?: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (product && !element.open) element.showModal();
    else if (!product && element.open) element.close();
  }, [product]);

  const specifications = product ? [
    ["Conector", product.connectorType],
    ["Potencia", product.watts ? `${product.watts} W` : null],
    ["Lúmenes", product.lumens ? `${product.lumens} lm` : null],
    ["Voltaje", product.voltage],
    ["Temperatura de color", product.colorTemperature],
    ["Chip", product.chipType],
    ["Canbus", product.canbus == null ? null : product.canbus ? "Sí" : "No"],
    ["Garantía", product.warranty],
    ["Duración de garantía", product.warrantyDays ? `${product.warrantyDays} días` : null],
    ["Alta y baja integradas", product.integratedHighLow ? "Sí" : null],
  ].filter((entry): entry is [string, string] => Boolean(entry[1])) : [];
  const vehicleLabels = product ? productVehicleTypes.filter(type => product.vehicleTypes.includes(type.id)).map(type => type.label) : [];

  return <dialog ref={dialog} aria-labelledby="wholesale-product-details-title" onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }} className="fixed inset-0 m-auto max-h-[92dvh] w-[min(48rem,calc(100vw-1rem))] overflow-y-auto rounded-2xl border border-white/15 bg-[var(--background)] p-0 text-white shadow-2xl backdrop:bg-black/80">
    {product && <section className="p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-widest text-[var(--red)]">Ficha mayorista</p><h2 id="wholesale-product-details-title" className="mt-1 text-xl font-black sm:text-2xl">{product.name}</h2></div>
        <button type="button" onClick={onClose} className="min-h-11 shrink-0 rounded-full border border-white/20 px-4 text-sm font-semibold">Cerrar</button>
      </header>
      <ProductImageGallery image={product.imageUrl} images={product.images} name={product.name} />
      {product.description && <p className="mt-5 whitespace-pre-line text-sm leading-6 text-zinc-300">{product.description}</p>}
      {vehicleLabels.length > 0 && <section className="mt-5"><h3 className="text-sm font-bold">Aplicación general</h3><p className="mt-1 text-sm text-zinc-300">{vehicleLabels.join(" · ")}</p><p className="mt-1 text-xs text-zinc-500">Confirmá la compatibilidad exacta por vehículo antes de solicitar.</p></section>}
      {compatibility && <section className="mt-5 rounded-xl border border-emerald-400/30 bg-emerald-950/20 p-3"><h3 className="text-sm font-bold text-emerald-200">Compatibilidad encontrada</h3><p className="mt-1 text-sm text-zinc-200">{compatibility}</p></section>}
      {specifications.length > 0 && <section className="mt-5"><h3 className="mb-2 text-sm font-bold">Especificaciones técnicas</h3><dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">{specifications.map(([label, value]) => <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-3"><dt className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{label}</dt><dd className="mt-1 text-sm font-semibold">{value}</dd></div>)}</dl></section>}
    </section>}
  </dialog>;
}
