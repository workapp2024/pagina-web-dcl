import { ManagedImage } from "@/components/ui/ManagedImage";
import { AddToCartButton } from "@/components/store/AddToCartButton";

type ProductCardProps = {
  id: string;
  name: string;
  description: string;
  image: string;
  href: string;
  ctaText: string;
  price: number;
  previousPrice?: number;
};

export function ProductCard({ id, name, description, image, href, ctaText, price, previousPrice }: ProductCardProps) {
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/3">
      <div className="relative flex h-64 w-full items-center justify-center overflow-hidden bg-zinc-950/60 p-4">
        <ManagedImage
          source={image}
          alt={name}
          className="max-h-full max-w-full object-contain transition duration-500 group-hover:scale-105"
        />
      </div>

      <div className="flex flex-1 flex-col p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-red-400">DCL</p>
        <h3 className="mt-3 text-2xl font-black uppercase tracking-[-0.05em] text-white">{name}</h3>
        <p className="mt-3 text-sm leading-6 text-zinc-300">{description}</p>

        <div className="mt-4 flex items-baseline gap-3">
          <span className="text-xl font-black text-white">${new Intl.NumberFormat("es-AR").format(price)}</span>
          {previousPrice ? <span className="text-sm text-zinc-500 line-through">${new Intl.NumberFormat("es-AR").format(previousPrice)}</span> : null}
        </div>

        <div className="mt-auto flex flex-col gap-2.5 pt-5 sm:flex-row xl:flex-col min-[1536px]:flex-row">
          <a
            href={href}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full bg-red-600 px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white whitespace-nowrap transition hover:bg-red-500"
          >
            {ctaText}
          </a>
          <AddToCartButton product={{ id, name, price, image, href }} />
          <a
            href={`https://api.whatsapp.com/send?text=${encodeURIComponent(`Hola DCL Cree LED, quiero consultar por ${name}.`)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full border border-white/15 bg-transparent px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white whitespace-nowrap transition hover:border-red-500/70 hover:text-red-300"
          >
            CONSULTAR
          </a>
        </div>
      </div>
    </article>
  );
}
