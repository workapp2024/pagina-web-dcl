"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ManagedImage } from "@/components/ui/ManagedImage";
import { useCart } from "@/components/store/CartProvider";
import { analyticsEvents, capture } from "@/lib/analytics";

const money = (value: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(value);

function CartIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-10 w-10 fill-none stroke-current" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"><path d="M3 4h2l2.1 10.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L20 8H6"/><circle cx="10" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></svg>;
}

export function CartPageContent({ categories }: { categories: string[] }) {
  const { lines, change, remove, total } = useCart();
  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    capture(analyticsEvents.cartView, { item_count: lines.reduce((sum, item) => sum + item.quantity, 0) });
  }, [lines]);

  return <main className="mx-auto min-h-[70svh] max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
    <div className="mb-7"><span className="text-xs font-bold uppercase tracking-[.24em] text-red-400">Compra segura DCL</span><h1 className="mt-2 text-3xl font-black uppercase tracking-[-.05em] text-white sm:text-4xl">Carrito</h1></div>
    {!lines.length ? <section className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-zinc-950/80">
      <div className="px-5 py-9 text-center sm:px-8 sm:py-12"><div className="mx-auto grid h-20 w-20 place-items-center rounded-full border border-red-500/30 bg-red-500/10 text-red-300"><CartIcon/></div><h2 className="mt-6 text-2xl font-black text-white">Tu carrito está vacío</h2><p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-zinc-400">Todavía no agregaste productos. Encontrá la iluminación ideal para tu vehículo o explorá nuestras categorías.</p><Link href="/vehiculos" className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full bg-red-600 px-6 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-red-500">Encontrá el LED para tu vehículo</Link></div>
      {categories.length > 0 && <div className="border-t border-white/10 bg-white/3 px-5 py-7 sm:px-8"><h3 className="text-center text-sm font-bold uppercase tracking-[.16em] text-zinc-300">Explorar categorías</h3><div className="mx-auto mt-5 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3">{categories.map(category => <Link key={category} href={`/productos?categoria=${encodeURIComponent(category)}`} className="flex min-h-12 items-center justify-center rounded-xl border border-white/10 bg-zinc-950 px-3 text-center text-xs font-bold uppercase text-zinc-200 transition hover:border-red-500/50 hover:text-white">{category}</Link>)}</div></div>}
    </section> : <div className="grid gap-6 lg:grid-cols-[1fr_21rem] lg:items-start"><section className="space-y-3" aria-label="Productos del carrito">{lines.map(item => <article key={item.id} className="grid grid-cols-[5rem_1fr] gap-4 rounded-2xl border border-white/10 bg-zinc-950/80 p-3 sm:grid-cols-[6rem_1fr_auto] sm:items-center sm:p-4"><div className="flex h-20 items-center justify-center overflow-hidden rounded-xl bg-black p-2 sm:h-24"><ManagedImage source={item.image} alt={item.name} className="max-h-full max-w-full object-contain"/></div><div className="min-w-0"><Link href={item.href} className="block truncate font-black text-white hover:text-red-300">{item.name}</Link>{item.category && <small className="mt-1 block text-xs uppercase tracking-wider text-red-400">{item.category}</small>}<p className="mt-2 text-xs text-zinc-400">Precio unitario: {money(item.price)}</p><div className="mt-3 flex items-center gap-2"><button type="button" aria-label={`Reducir cantidad de ${item.name}`} onClick={() => change(item.id, item.quantity - 1)} className="grid h-11 w-11 place-items-center rounded-full border border-white/15 text-lg">−</button><b className="min-w-7 text-center">{item.quantity}</b><button type="button" aria-label={`Aumentar cantidad de ${item.name}`} onClick={() => change(item.id, item.quantity + 1)} className="grid h-11 w-11 place-items-center rounded-full border border-white/15 text-lg">+</button></div></div><div className="col-span-2 flex items-center justify-between border-t border-white/10 pt-3 sm:col-span-1 sm:block sm:border-0 sm:pt-0 sm:text-right"><span><small className="block text-xs text-zinc-500">Subtotal</small><b className="text-lg text-white">{money(item.price * item.quantity)}</b></span><button type="button" onClick={() => remove(item.id)} className="min-h-11 px-2 text-xs font-bold text-red-300 sm:mt-3">Eliminar</button></div></article>)}</section><aside className="rounded-2xl border border-red-500/20 bg-zinc-950 p-5 shadow-[0_18px_50px_rgba(0,0,0,.25)] lg:sticky lg:top-28"><span className="text-xs font-bold uppercase tracking-[.18em] text-red-400">Resumen de compra</span><div className="mt-5 flex items-center justify-between border-b border-white/10 pb-4 text-sm text-zinc-400"><span>Productos</span><span>{lines.reduce((sum, item) => sum + item.quantity, 0)}</span></div><div className="flex items-end justify-between pt-5"><span className="font-bold text-white">Total</span><b className="text-2xl text-white">{money(total)}</b></div><Link href="/checkout" className="mt-6 flex min-h-12 w-full items-center justify-center rounded-full bg-red-600 px-5 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-red-500">Continuar al checkout</Link><Link href="/productos" className="mt-3 flex min-h-11 w-full items-center justify-center text-xs font-bold text-zinc-400 hover:text-white">Seguir comprando</Link></aside></div>}
  </main>;
}
