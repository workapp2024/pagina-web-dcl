import { WhatsAppButton } from "@/components/ui/WhatsAppButton";

export function ConsultationBanner() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="rounded-[2rem] border border-red-500/20 bg-gradient-to-r from-red-600/15 via-zinc-950 to-zinc-950 p-6 sm:p-8 lg:p-10">
        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr] lg:items-center">
          <div>
            <h2 className="text-3xl font-black uppercase tracking-[-0.06em] text-white md:text-4xl">
              ¿NO SABÉS CUÁL NECESITÁS?
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-300">
              No importa si no conocés el modelo de lámpara. Mandanos los datos de tu vehículo y te ayudamos a encontrar la opción adecuada.
            </p>
            <div className="mt-5 flex flex-wrap gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">Marca</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">Modelo</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">Año</span>
            </div>
          </div>

          <div className="flex justify-start lg:justify-end">
            <WhatsAppButton label="CONSULTAR POR WHATSAPP" className="w-full justify-center sm:w-auto" />
          </div>
        </div>
      </div>
    </section>
  );
}
