import { ManagedImage } from "@/components/ui/ManagedImage";
import type { WholesaleCatalogItem } from "@/lib/wholesale-server";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export function WholesaleProductCard({ product, compatibility, onAdd, onQuantityChange, onDetails, selected = false, selectedQuantity, variant = "default" }: { product: WholesaleCatalogItem; compatibility?: string; onAdd?: (product: WholesaleCatalogItem) => void; onQuantityChange?: (productId: string, quantity: number, product?: WholesaleCatalogItem) => void; onDetails?: (product: WholesaleCatalogItem, compatibility?: string) => void; selected?: boolean; selectedQuantity?: number; variant?: "default" | "wholesale" }) {
  const wholesale = variant === "wholesale";
  const quantity = selectedQuantity ?? 0;
  return <article className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 ${wholesale ? "shadow-lg shadow-black/10" : ""}`}>
    <div className={`${wholesale ? "aspect-[16/10] p-3 sm:p-4" : "aspect-[4/3] p-4"} w-full bg-zinc-900`}>
      <ManagedImage source={product.imageUrl} alt={product.name} className="h-full w-full object-contain" />
    </div>
    <div className={`flex flex-1 flex-col ${wholesale ? "p-3 sm:p-4" : "p-4 sm:p-5"}`}>
      {product.category && <p className={`text-xs font-semibold uppercase tracking-widest ${wholesale ? "text-[var(--red)]" : "text-red-300"}`}>{product.category}</p>}
      <h2 className={`break-words font-bold ${wholesale ? "mt-1 line-clamp-2 min-h-12 text-base sm:text-lg" : "mt-2 text-lg sm:text-xl"}`}>{product.name}</h2>
      {product.connectorType && <p className={`mt-2 text-sm text-zinc-400 ${wholesale ? "w-fit rounded-full border border-white/10 px-2.5 py-1" : ""}`}>Conector: {product.connectorType}</p>}
      <p className={`text-sm leading-6 text-zinc-300 ${wholesale ? "mt-2 line-clamp-2" : "mt-3 line-clamp-3"}`}>{product.description}</p>
      {compatibility && <p className={`${wholesale ? "mt-2 line-clamp-2" : "mt-3"} text-xs leading-5 text-emerald-200`}>Compatible: {compatibility}</p>}
      <p className={`${wholesale ? "mt-auto pt-3 text-xl" : "mt-5 text-2xl"} font-black text-white`}>{money.format(product.wholesalePrice)}</p>
      {onDetails && <button type="button" onClick={() => onDetails(product, compatibility)} className="mt-2 min-h-11 text-left text-sm font-semibold text-zinc-200 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-[var(--red)]">Ver ficha y especificaciones</button>}
      {onQuantityChange && <div className="mt-3 flex items-center justify-between gap-2" aria-label={`Cantidad de ${product.name}`}>
        <span className="text-sm text-zinc-300">Cantidad</span>
        <div className="flex items-center gap-2">
          <button type="button" aria-label={`Disminuir cantidad de ${product.name}`} disabled={quantity === 0} onClick={() => onQuantityChange(product.id, quantity - 1, product)} className="min-h-11 min-w-11 rounded-lg border border-white/20 text-lg font-bold text-white focus-visible:outline-2 focus-visible:outline-[var(--red)] disabled:opacity-40">−</button>
          <span aria-live="polite" className="min-w-7 text-center font-bold">{quantity}</span>
          <button type="button" aria-label={`Aumentar cantidad de ${product.name}`} disabled={quantity >= 100} onClick={() => onQuantityChange(product.id, quantity + 1, product)} className="min-h-11 min-w-11 rounded-lg border border-white/20 text-lg font-bold text-white focus-visible:outline-2 focus-visible:outline-[var(--red)] disabled:opacity-40">+</button>
        </div>
      </div>}
      {onAdd && !onQuantityChange && <button type="button" disabled={selectedQuantity !== undefined && selectedQuantity >= 100} aria-pressed={selected} aria-label={selected ? `${product.name} está en el carrito${selectedQuantity ? `, ${selectedQuantity} unidades` : ""}` : `Agregar ${product.name} al carrito`} onClick={() => onAdd(product)} className={`${wholesale ? "mt-3" : "mt-4"} min-h-12 w-full rounded-full px-4 text-sm font-bold transition focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-60 ${wholesale ? "bg-[var(--red)] text-[var(--background)] hover:bg-[var(--red-strong)] focus-visible:outline-[var(--red)]" : "bg-red-600 text-white hover:bg-red-500 focus-visible:outline-red-300"}`}>
        {selectedQuantity !== undefined && selectedQuantity >= 100 ? "Máximo de 100 unidades" : selected ? `En carrito · ${selectedQuantity ?? 1} u.` : "Agregar al carrito"}
      </button>}
    </div>
  </article>;
}
