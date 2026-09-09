"use client";
import { useEffect, useRef } from "react";

export function ProductEditorDialog({ title, onClose, busy, children }: { title: string; onClose: () => void; busy: boolean; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => { element?.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  return <dialog ref={dialog} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} className="m-auto max-h-[92dvh] w-[min(72rem,96vw)] overflow-y-auto rounded-2xl border border-white/20 bg-zinc-950 p-0 text-white backdrop:bg-black/80">
    <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-white/10 bg-zinc-950 p-4 sm:px-6">
      <h2 className="text-xl font-bold">{title}</h2><button type="button" autoFocus disabled={busy} onClick={onClose} className="min-h-11 rounded-full border border-white/20 px-4 disabled:opacity-40">Cerrar</button>
    </div>
    <div className="p-4 sm:p-6">{children}</div>
  </dialog>;
}
