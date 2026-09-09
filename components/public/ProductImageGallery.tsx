"use client";
import { useEffect, useRef, useState } from "react";
import { ManagedImage } from "@/components/ui/ManagedImage";
import { productImageSources } from "@/lib/product-images";

export function ProductImageGallery({ image, images, name }: { image: string; images?: string[]; name: string }) {
  const sources = productImageSources({ image, images });
  const [selected, setSelected] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const previousOverflow = useRef("");
  useEffect(() => {
    const element = dialog.current;
    return () => { if (element?.open) { element.close(); document.body.style.overflow = previousOverflow.current; } };
  }, []);
  const move = (direction: number) => setSelected(index => (index + direction + sources.length) % sources.length);
  const touch = {
    onTouchStart: (event: React.TouchEvent) => { const point = event.touches[0]; start.current = { x: point.clientX, y: point.clientY }; swiped.current = false; },
    onTouchEnd: (event: React.TouchEvent) => {
      const point = event.changedTouches[0], first = start.current;
      if (first && sources.length > 1 && Math.abs(point.clientX - first.x) > 45 && Math.abs(point.clientX - first.x) > Math.abs(point.clientY - first.y)) { move(point.clientX < first.x ? 1 : -1); swiped.current = true; }
      start.current = null;
    },
  };
  function close() { dialog.current?.close(); document.body.style.overflow = previousOverflow.current; }
  const arrows = sources.length > 1 && <div className="flex items-center justify-center gap-4">
    <button type="button" aria-label="Imagen anterior" onClick={() => move(-1)} className="min-h-11 min-w-11 rounded-full border border-white/20">←</button>
    <span aria-live="polite">{selected + 1} / {sources.length}</span>
    <button type="button" aria-label="Imagen siguiente" onClick={() => move(1)} className="min-h-11 min-w-11 rounded-full border border-white/20">→</button>
  </div>;
  return <div className="min-w-0 space-y-3" onKeyDown={event => { if (sources.length > 1 && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1); } }}>
    <button type="button" aria-label={`Ampliar imagen de ${name}`} disabled={!sources.length} {...touch} onClick={() => { if (swiped.current) { swiped.current = false; return; } previousOverflow.current = document.body.style.overflow; dialog.current?.showModal(); document.body.style.overflow = "hidden"; }} className="flex h-80 w-full touch-pan-y items-center justify-center overflow-hidden rounded-[1.75rem] border border-white/10 bg-zinc-950/60 p-6 lg:h-[480px]">
      <ManagedImage source={sources[selected] ?? image} alt={name} className="max-h-full max-w-full object-contain" />
    </button>
    {sources.length > 1 && <div className="flex justify-center gap-3">{sources.map((source, index) => <button type="button" key={source} aria-label={`Ver imagen ${index + 1}${index === 0 ? ' (principal)' : ''}`} aria-pressed={selected === index} onClick={() => setSelected(index)} className={`flex h-20 w-20 items-center justify-center rounded-xl border p-2 ${selected === index ? 'border-red-500' : 'border-white/20'}`}><ManagedImage source={source} alt={`${name}, imagen ${index + 1}`} className="max-h-full max-w-full object-contain" /></button>)}</div>}
    {arrows}
    <dialog ref={dialog} aria-label={`Imágenes de ${name}`} onCancel={event => { event.preventDefault(); close(); }} onClose={() => { document.body.style.overflow = previousOverflow.current; }} className="m-auto max-h-[95dvh] w-[min(70rem,96vw)] rounded-2xl border border-white/20 bg-zinc-950 p-4 text-white backdrop:bg-black/90">
      <div className="mb-3 flex justify-end"><button type="button" onClick={close} className="min-h-11 rounded-full border border-white/20 px-5">Cerrar imágenes</button></div>
      <div {...touch} className="flex h-[65dvh] touch-pan-y items-center justify-center"><ManagedImage source={sources[selected] ?? image} alt={`${name}, imagen ${selected + 1}`} className="max-h-full max-w-full object-contain" /></div>
      {arrows}
    </dialog>
  </div>;
}
