import { ManagedImage } from "@/components/ui/ManagedImage";
import type { WholesaleCatalogItem } from "@/lib/wholesale-server";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export function WholesaleProductCard({ product, compatibility, onAdd, selected = false }: { product: WholesaleCatalogItem; compatibility?: string; onAdd?: (product: WholesaleCatalogItem) => void; selected?: boolean }) {
  return <article className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950">
    <div className="aspect-[4/3] w-full bg-zinc-900 p-4">
      <ManagedImage source={product.imageUrl} alt={product.name} className="h-full w-full object-contain" />
    </div>
    <div className="flex flex-1 flex-col p-4 sm:p-5">
      {product.category && <p className="text-xs font-semibold uppercase tracking-widest text-red-300">{product.category}</p>}
      <h2 className="mt-2 break-words text-lg font-bold sm:text-xl">{product.name}</h2>
      {product.connectorType && <p className="mt-2 text-sm text-zinc-400">Conector: {product.connectorType}</p>}
      <p className="mt-3 line-clamp-3 text-sm leading-6 text-zinc-300">{product.description}</p>
      {compatibility && <p className="mt-3 text-xs leading-5 text-emerald-200">Compatible: {compatibility}</p>}
      <p className="mt-5 text-2xl font-black text-white">{money.format(product.wholesalePrice)}</p>
      {onAdd && <button type="button" onClick={() => onAdd(product)} className="mt-4 min-h-12 w-full rounded-full bg-red-600 px-4 text-sm font-bold text-white transition hover:bg-red-500 focus-visible:outline-2 focus-visible:outline-red-300">
        {selected ? "En la solicitud · modificar cantidad" : "Agregar a solicitud"}
      </button>}
    </div>
  </article>;
}
