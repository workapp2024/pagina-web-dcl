import Link from "next/link";
import { WhatsAppButton } from "@/components/ui/WhatsAppButton";

export function WholesaleCTA() {
  return <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8" aria-labelledby="wholesale-title">
    <div className="grid gap-6 rounded-3xl border border-amber-300/20 bg-[linear-gradient(120deg,_rgba(120,80,20,0.22),_rgba(24,24,27,0.96)_55%)] p-6 sm:p-9 md:grid-cols-[1fr_auto] md:items-center">
      <div><p className="text-xs font-bold uppercase tracking-[0.24em] text-amber-200">Para comercios y profesionales</p><h2 id="wholesale-title" className="mt-2 text-2xl font-black uppercase tracking-tight text-white sm:text-3xl">DCL Mayoristas</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300">Precios especiales con acceso mediante código individual. Si todavía no sos cliente mayorista, escribinos para conocer la propuesta.</p></div>
      <div className="flex w-full flex-col gap-3 sm:flex-row md:w-auto md:flex-col"><Link href="/mayoristas/ingresar" className="inline-flex min-h-12 items-center justify-center rounded-full bg-amber-300 px-5 text-sm font-bold text-zinc-950 transition hover:bg-amber-200">INGRESAR CON MI CÓDIGO</Link><WhatsAppButton label="CONSULTAR POR WHATSAPP" message="Hola DCL Cree LED, quiero consultar cómo ser cliente mayorista." className="min-h-12 justify-center rounded-full border border-white/20 bg-transparent px-5 text-sm text-white hover:border-amber-200" /></div>
    </div>
  </section>;
}
