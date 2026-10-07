/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { WhatsAppButton } from "@/components/ui/WhatsAppButton";
import { getSupabaseSiteSettings } from "@/lib/supabase/site-settings";
import { publicContact, publicPresentation } from "@/lib/public-site-content";

const footerLinks = [
  { label: "Inicio", href: "/" },
  { label: "Productos", href: "/productos" },
  { label: "Vehículos", href: "/vehiculos" },
  { label: "DCL Music", href: "/music" },
  { label: "Promociones", href: "/#promociones" },
  { label: "Nosotros", href: "/#nosotros" },
  { label: "Contacto", href: "/#contacto" },
];

export async function Footer() {
  const settings = await getSupabaseSiteSettings();
  const contact = publicContact(settings);
  const { logo } = publicPresentation(settings);
  const socialLinks = [
    { label: "Instagram", href: settings?.instagram },
    { label: "Facebook", href: settings?.facebook },
  ].flatMap(({ label, href }) => {
    const value = href?.trim();
    if (!value) return [];
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || /\s/.test(value)) return [];
      return [{ label, href: value }];
    } catch { return []; }
  });
  return <footer id="contacto" className="border-t border-white/10 bg-black px-4 py-10 sm:px-6 lg:px-8">
    <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-3">
      <div className="min-w-0"><img src={logo} alt="DCL Cree LED" className="h-16 w-auto max-w-full object-contain object-left sm:h-20"/><p className="mt-4 max-w-xs text-sm leading-6 text-zinc-400">Iluminación LED para vehículos pensada para circular con mejor visibilidad, estilo y confianza.</p></div>
      <div><h3 className="text-sm font-bold uppercase tracking-[0.22em] text-zinc-300">Navegación</h3><ul className="mt-3 text-sm text-zinc-400">{footerLinks.map(item => <li key={item.label}><Link href={item.href} className="inline-flex min-h-11 items-center transition hover:text-red-400">{item.label}</Link></li>)}</ul></div>
      <div className="min-w-0"><h3 className="text-sm font-bold uppercase tracking-[0.22em] text-zinc-300">Contacto</h3><div className="mt-3 text-sm text-zinc-400"><WhatsAppButton label="WhatsApp" className="min-h-11 bg-transparent p-0 text-zinc-400 hover:bg-transparent hover:text-red-400"/>
        {contact.email && <a href={`mailto:${contact.email}`} className="flex min-h-11 items-center [overflow-wrap:anywhere]">{contact.email}</a>}
        {contact.phone && <a href={`tel:${contact.phone.replace(/[^+\d]/g, "")}`} className="flex min-h-11 items-center [overflow-wrap:anywhere]">{contact.phone}</a>}
        {contact.address && <p className="py-2 leading-6 [overflow-wrap:anywhere]">{contact.address}</p>}
        {socialLinks.map(link => <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center transition hover:text-red-400">{link.label}</a>)}</div><div className="mt-5"><WhatsAppButton label="CONSULTAR" className="w-full justify-center"/></div></div>
    </div>
    <div className="mx-auto mt-8 flex max-w-7xl flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 text-xs text-zinc-500 sm:flex-row"><div className="uppercase tracking-[0.22em]">DCL Cree LED</div><Link href="/privacidad" className="inline-flex min-h-11 items-center hover:text-zinc-300">Política de privacidad</Link><Link href="/admin/login" className="inline-flex min-h-11 items-center gap-1.5 text-zinc-500 transition hover:text-zinc-300"><span aria-hidden="true">⚙️</span><span>Administrador</span></Link></div>
  </footer>;
}
