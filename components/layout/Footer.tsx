import Link from "next/link";
import { WhatsAppButton } from "@/components/ui/WhatsAppButton";

const footerLinks = [
  { label: "Inicio", href: "#inicio" },
  { label: "Productos", href: "#productos" },
  { label: "Vehículos", href: "#vehiculos" },
  { label: "Promociones", href: "#promociones" },
  { label: "Nosotros", href: "#nosotros" },
  { label: "Contacto", href: "#contacto" },
];

export function Footer() {
  return (
    <footer id="contacto" className="border-t border-white/10 bg-black px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-3">
        <div>
          <img src="/brand/logo-dcl.png.png" alt="DCL Cree LED" className="h-16 w-auto sm:h-20" />
          <p className="mt-4 max-w-xs text-sm leading-6 text-zinc-400">
            Iluminación LED para vehículos pensada para circular con mejor visibilidad, estilo y confianza.
          </p>
        </div>

        <div>
          <h3 className="text-sm font-bold uppercase tracking-[0.22em] text-zinc-300">Navegación</h3>
          <ul className="mt-4 space-y-3 text-sm text-zinc-400">
            {footerLinks.map((item) => (
              <li key={item.label}>
                <a href={item.href} className="transition hover:text-red-400">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-bold uppercase tracking-[0.22em] text-zinc-300">Contacto</h3>
          <div className="mt-4 space-y-3 text-sm text-zinc-400">
            <WhatsAppButton label="WhatsApp" className="p-0 bg-transparent text-zinc-400 hover:bg-transparent hover:text-red-400" />
            <a href="#nosotros" className="block transition hover:text-red-400">
              Redes sociales
            </a>
          </div>
          <div className="mt-5">
            <WhatsAppButton label="CONSULTAR" className="w-full justify-center" />
          </div>
        </div>
      </div>

      <div className="mx-auto mt-8 flex max-w-7xl flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 text-xs text-zinc-500 sm:flex-row">
        <div className="uppercase tracking-[0.22em]">DCL Cree LED</div>
        <Link
          href="/admin/login"
          className="inline-flex items-center gap-1.5 text-zinc-500 transition hover:text-zinc-300"
        >
          <span>⚙️</span>
          <span>Administrador</span>
        </Link>
      </div>
    </footer>
  );
}
