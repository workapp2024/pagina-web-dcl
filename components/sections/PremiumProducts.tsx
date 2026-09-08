import Link from "next/link";
import { ManagedImage } from "@/components/ui/ManagedImage";
import { AddToCartButton } from "@/components/store/AddToCartButton";
import type { Product } from "@/lib/site-data";

export function PremiumProducts({ products }: { products: Product[] }) {
  if (!products.length) return null;
  const multiple = products.length > 1;
  return <section aria-labelledby="premium-title" className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-sm font-bold uppercase tracking-[.22em] text-red-400">Selección DCL</p><h2 id="premium-title" className="mt-1 text-3xl font-black uppercase tracking-tight text-white sm:text-4xl">Premium</h2></div>
      {multiple && <p className="text-sm text-zinc-400 lg:hidden">Deslizá para ver más →</p>}
    </div>
    <ul aria-label="Productos Premium" tabIndex={multiple ? 0 : undefined} className={`flex snap-x snap-mandatory gap-5 overflow-x-auto overscroll-x-contain pb-4 focus-visible:outline-2 focus-visible:outline-red-400 lg:grid ${multiple ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
      {products.map(product => <li key={product.id} className={`${multiple ? "w-[86%] sm:w-[60%]" : "w-full"} min-w-0 shrink-0 snap-start lg:w-auto`}>
        <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900">
          <Link href={product.href} className="flex aspect-square items-center justify-center bg-zinc-950/60 p-4"><ManagedImage source={product.image} alt={product.name} loading="lazy" className="h-full w-full object-contain" /></Link>
          <div className="flex flex-1 flex-col p-5"><h3 className="break-words text-2xl font-black tracking-tight text-white">{product.name}</h3>
            <p className="mt-3 text-3xl font-black text-white">{new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(product.price)}</p>
            <div className="mt-auto grid gap-3 pt-5"><Link href={product.href} className="flex min-h-12 items-center justify-center rounded-full bg-red-600 px-4 text-sm font-bold text-white">Ver producto</Link>
              <AddToCartButton product={{ id: product.id, name: product.name, price: product.price, image: product.image, href: product.href, category: product.category }} />
            </div>
          </div>
        </article>
      </li>)}
    </ul>
  </section>;
}
