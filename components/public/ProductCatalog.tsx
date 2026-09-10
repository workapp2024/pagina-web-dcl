"use client";

import Link from "next/link";
import { ProductCard } from "@/components/ui/ProductCard";
import { ConnectorField } from "@/components/public/ConnectorField";
import { analyticsEvents, capture } from "@/lib/analytics";
import type { Product } from "@/lib/site-data";
import { commercialCategories, productFunctions, productVehicleTypes } from "@/lib/product-taxonomy";
import { categoryParam, filterCatalogProducts, parseProductFilters, productFilterEventProperties, productFilterLabels, type CatalogFilters } from "@/lib/product-filters";

const control = "mt-2 min-h-12 w-full min-w-0 rounded-xl border border-white/15 bg-zinc-950 px-3 text-base text-white";

export function ProductCatalog({ products, filters }: { products: Product[]; filters: CatalogFilters }) {
  const visible = filterCatalogProducts(products, filters);
  const context = productFilterLabels(filters.classification);
  const clear = () => capture(analyticsEvents.productFiltersCleared, productFilterEventProperties(filters.classification));
  return <>
    <form key={JSON.stringify(filters)} action="/productos" method="get" className="mb-7 space-y-4 rounded-2xl border border-white/10 p-4 sm:p-5" onSubmit={event => {
      const values = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
      const next = parseProductFilters(values);
      if (!next.invalid) capture(analyticsEvents.productFilterApplied, productFilterEventProperties(next.classification));
    }}>
      <label className="block text-sm text-zinc-300">Buscar producto, categoría o conector
        <input name="q" type="search" maxLength={120} defaultValue={filters.query} className={control} />
      </label>
      <div className="grid min-w-0 gap-4 sm:grid-cols-3">
        <label className="min-w-0 text-sm text-zinc-300">Vehículo
          <select name="vehiculo" defaultValue={filters.classification.vehicleType ?? ""} className={control}>
            <option value="">Todos los vehículos</option>
            {productVehicleTypes.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-sm text-zinc-300">Categoría
          <select name="categoria" defaultValue={filters.classification.category ? categoryParam(filters.classification.category) : ""} className={control}>
            <option value="">Todas las categorías</option>
            {commercialCategories.map(option => <option key={option.id} value={option.slug}>{option.label}</option>)}
            {filters.classification.category && !commercialCategories.some(option => option.id === filters.classification.category) && <option value={categoryParam(filters.classification.category)}>{filters.classification.category} (anterior)</option>}
          </select>
        </label>
        <label className="min-w-0 text-sm text-zinc-300">Característica
          <select name="funcion" defaultValue={filters.classification.function ?? ""} className={control}>
            <option value="">Todas las características</option>
            {productFunctions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
      </div>
      <ConnectorField products={products} id="catalog-connectors" defaultValue={filters.classification.connectorType} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="min-h-12 rounded-full bg-red-600 px-5 text-sm font-bold text-white">Aplicar filtros</button>
        <Link href="/productos" onClick={clear} className="inline-flex min-h-12 items-center rounded-full border border-white/20 px-5 text-sm text-white">Limpiar filtros</Link>
      </div>
      <p className="text-xs leading-5 text-zinc-400">Estos filtros muestran clasificación comercial; no confirman compatibilidad con marca, modelo o año.</p>
      {filters.classification.category === "Accesorios"
        ? <p className="text-sm text-zinc-300">Elegí Todos los vehículos o un tipo. Los accesorios universales se incluyen en cada tipo; no necesitás marca ni modelo.</p>
        : <Link href="/vehiculos" className="inline-flex min-h-11 items-center text-sm text-red-300 underline">No sé el conector: buscar por vehículo</Link>}
    </form>
    <div className="mb-5" aria-live="polite">
      <h2 className="break-words text-xl font-bold text-white">{filters.invalid ? "Revisá los filtros del enlace" : context || "Catálogo completo"}</h2>
      <p className="mt-2 text-sm text-zinc-400">{visible.length} producto(s){filters.query ? " para tu búsqueda" : ""}</p>
    </div>
    {visible.length ? <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{visible.map(product => <ProductCard key={product.id} {...product} />)}</div> :
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm leading-6 text-zinc-300">
        <p>{filters.invalid ? "El enlace contiene filtros no válidos. Elegí una combinación con los controles de arriba." : "No encontramos productos clasificados para esta combinación."}</p>
        <p className="mt-2">Puede haber productos pendientes de clasificación. Probá otra categoría o consultá el catálogo completo.</p>
        <Link href="/productos" onClick={clear} className="mt-3 inline-flex min-h-12 items-center font-bold text-red-300 underline">Ver catálogo completo</Link>
      </div>}
  </>;
}
