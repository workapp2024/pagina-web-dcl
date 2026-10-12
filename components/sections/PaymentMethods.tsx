import type { PaymentCardBrand, PaymentPresentationMethod, SiteSettings } from "@/lib/site-data";

type Surface = "home" | "wholesale" | "checkout";

export function PaymentMethods({ settings, surface }: { settings: Partial<SiteSettings>; surface: Surface }) {
  if (settings.paymentPresentationEnabled === false || settings[`paymentPresentation${surface[0].toUpperCase()}${surface.slice(1)}` as "paymentPresentationHome" | "paymentPresentationWholesale" | "paymentPresentationCheckout"] === false) return null;
  const transferReady = Boolean((settings.transferAlias?.trim() || settings.transferCbuCvu?.trim()) && settings.transferHolder?.trim() && settings.transferInstitution?.trim());
  const mercadoPagoReady = Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN);
  const cardReady = mercadoPagoReady && Boolean(process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY);
  const flags = { home: "showHome", wholesale: "showWholesale", checkout: "showCheckout" } as const;
  const methods = (settings.paymentPresentationMethods || []).filter(method => method.enabled && method[flags[surface]]
    && (method.id !== "transfer" || transferReady)
    && (method.id !== "mercadopago" || mercadoPagoReady)
    && (method.id !== "card" || cardReady));
  if (!methods.length) return null;
  const description = settings.paymentPresentationDescription || "Aceptamos tarjetas, transferencias bancarias y medios de pago digitales.";
  const safeDescription = transferReady ? description : description.replace(/,?\s*transferencias? bancarias?/i, "").replace(/\s+,/g, ",").replace(/,{2,}/g, ",");
  return (
    <section aria-labelledby={`payment-methods-${surface}`} className="mx-auto my-8 max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-zinc-900/90 to-black px-5 py-6 sm:px-7">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <div>
            <h2 id={`payment-methods-${surface}`} className="text-lg font-black tracking-tight sm:text-xl">{settings.paymentPresentationTitle || "Pagá como más te convenga"}</h2>
            <p className="mt-1 max-w-2xl text-sm text-zinc-400">{safeDescription}</p>
          </div>
          <ul className="flex flex-wrap items-center gap-2" aria-label="Medios de pago disponibles">
            {methods.map(method => (
              <li key={method.id} className="flex min-h-10 flex-wrap items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-xs font-bold text-zinc-100">
                {method.logoUrl && <PaymentLogo url={method.logoUrl} name={method.name} />}
                <span>{method.name}</span>
                {method.id === "card" && <CardBrands method={method} />}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function CardBrands({ method }: { method: PaymentPresentationMethod }) {
  const brands = (method.cardBrands || []).filter(brand => brand.enabled);
  if (!brands.length) return null;
  return <span className="flex flex-wrap items-center justify-center gap-1.5 border-l border-white/15 pl-2" aria-label="Marcas de tarjetas aceptadas">
    {brands.map(brand => <CardBrandMark key={brand.id} brand={brand} />)}
  </span>;
}

function CardBrandMark({ brand }: { brand: PaymentCardBrand }) {
  if (!brand.logoUrl) return <span className="rounded-md bg-white px-2 py-1 text-[10px] font-extrabold text-zinc-900">{brand.name}</span>;
  return <PaymentLogo url={brand.logoUrl} name={brand.name} decorative={false} />;
}

function PaymentLogo({ url, name, decorative = true }: { url: string; name: string; decorative?: boolean }) {
  // The admin supplies an authorized, public asset. Explicit dimensions reduce layout shift;
  // native lazy loading keeps these small, below-the-fold marks off the critical path.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={decorative ? "" : name} aria-hidden={decorative || undefined} width={56} height={24} loading="lazy" decoding="async" className="h-6 w-14 object-contain" />;
}
