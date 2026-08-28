import { WhatsAppButton } from "@/components/ui/WhatsAppButton";

export function FinalCTA() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="rounded-[2rem] border border-red-500/20 bg-[linear-gradient(135deg,_rgba(239,68,68,0.15),_rgba(24,24,27,0.95),_rgba(24,24,27,1))] p-8 text-center shadow-[0_30px_70px_rgba(239,68,68,0.15)] sm:p-12">
        <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-red-300">DCL CREE LED</p>
        <h2 className="mt-4 text-3xl font-black uppercase tracking-[-0.06em] text-white md:text-5xl">
          ¿LISTO PARA VER MEJOR?
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-lg leading-8 text-zinc-300">
          Encontrá la iluminación adecuada para tu vehículo.
        </p>

        <div className="mt-8 flex flex-col justify-center gap-4 sm:flex-row">
          <a
            href="#productos"
            className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3.5 text-sm font-bold uppercase tracking-[0.14em] text-black transition hover:bg-zinc-200"
          >
            VER PRODUCTOS
          </a>
          <WhatsAppButton label="WHATSAPP" />
        </div>
      </div>
    </section>
  );
}
