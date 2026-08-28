export function VehicleSelector() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="rounded-[2rem] border border-red-500/20 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-6 shadow-[0_30px_60px_rgba(0,0,0,0.5)] sm:p-8 lg:p-10">
        <div className="mb-7 max-w-2xl">
          <h2 className="text-3xl font-black uppercase tracking-[-0.06em] text-white md:text-4xl">
            ENCONTRÁ EL LED PARA TU VEHÍCULO
          </h2>
          <p className="mt-3 text-base leading-7 text-zinc-300">
            Seleccioná tu vehículo y encontrá las opciones de iluminación compatibles.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">Marca</span>
            <select
              aria-label="Marca"
              disabled
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-base text-zinc-400 outline-none transition focus:border-red-500/70"
            >
              <option>Seleccioná</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">Modelo</span>
            <select
              aria-label="Modelo"
              disabled
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-base text-zinc-400 outline-none transition focus:border-red-500/70"
            >
              <option>Seleccioná</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">Año</span>
            <select
              aria-label="Año"
              disabled
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-base text-zinc-400 outline-none transition focus:border-red-500/70"
            >
              <option>Seleccioná</option>
            </select>
          </label>
        </div>

        <div className="mt-6">
          <button
            type="button"
            disabled
            className="inline-flex items-center justify-center rounded-full bg-red-600 px-6 py-3.5 text-sm font-bold uppercase tracking-[0.14em] text-white opacity-60"
          >
            BUSCAR ILUMINACIÓN
          </button>
        </div>
      </div>
    </section>
  );
}
