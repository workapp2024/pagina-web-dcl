"use client";
import { useEffect,useRef,useState } from "react";
import type { GalleryItem } from "@/lib/supabase/gallery";
import { ManagedImage } from "@/components/ui/ManagedImage";

export function WorkGallery({items}:{items:GalleryItem[]}){
  const track=useRef<HTMLDivElement>(null);const [paused,setPaused]=useState(false);
  useEffect(()=>{if(paused||items.length<2)return;const timer=window.setInterval(()=>{const node=track.current;if(!node)return;const step=Math.min(node.clientWidth*.82,360);node.scrollTo({left:node.scrollLeft+step>=node.scrollWidth-node.clientWidth-8?0:node.scrollLeft+step,behavior:"smooth"})},4500);return()=>window.clearInterval(timer)},[paused,items.length]);
  if(!items.length)return null;
  return <section className="border-y border-white/10 bg-zinc-950 py-14" aria-labelledby="gallery-title"><div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8"><span className="text-xs font-bold uppercase tracking-[.24em] text-red-400">Experiencia DCL</span><h2 id="gallery-title" className="mt-2 text-3xl font-black uppercase tracking-[-.05em]">DCL en acción</h2><p className="mt-3 max-w-2xl text-sm text-zinc-400">Entregas e instalaciones reales que muestran cómo queda cada solución.</p><div ref={track} onMouseEnter={()=>setPaused(true)} onMouseLeave={()=>setPaused(false)} onFocusCapture={()=>setPaused(true)} onBlurCapture={()=>setPaused(false)} className="mt-7 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 [scrollbar-width:none] touch-pan-x">{items.map(item=><article key={item.id} className="relative aspect-[4/3] w-[82vw] max-w-sm shrink-0 snap-center overflow-hidden rounded-3xl border border-white/10 bg-zinc-900"><ManagedImage source={item.imageUrl} alt={item.title||"Trabajo realizado por DCL"} loading="lazy" className="h-full w-full object-cover"/><div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent p-5 pt-14">{item.title&&<h3 className="font-bold text-white">{item.title}</h3>}{item.caption&&<p className="mt-1 text-sm text-zinc-300">{item.caption}</p>}</div></article>)}</div></div></section>
}
