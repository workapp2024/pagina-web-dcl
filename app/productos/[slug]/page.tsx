import { notFound } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { WhatsAppButton } from "@/components/ui/WhatsAppButton";
import { ManagedImage } from "@/components/ui/ManagedImage";
import { SiteContentProvider } from "@/components/providers/SiteContentProvider";
import { getSupabaseProducts } from "@/lib/supabase/products";
import { whatsappUrl } from "@/lib/whatsapp";
import { EventOnMount } from "@/components/analytics/EventOnMount";
import { analyticsEvents } from "@/lib/analytics";
import { assessFitment } from "@/lib/store/fitment";
import { ProductPurchaseActions } from "@/components/store/ProductPurchaseActions";
import { getPublicVehicleCompatibilityById } from "@/lib/supabase/vehicle-compatibility";

export const revalidate = 60;

type ProductoDetallePageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ fitment?: string; position?: string; year?: string }>;
};

export async function generateMetadata({ params }: ProductoDetallePageProps) {
  const { slug } = await params;
  const products = await getSupabaseProducts();
  const product = (products ?? []).find((item) => item.href === `/productos/${slug}`);

  if (!product) {
    return { title: "Producto no encontrado | DCL Cree LED" };
  }

  return {
    title: `${product.name} | DCL Cree LED`,
    description: product.description,
  };
}

export default async function ProductoDetallePage({ params, searchParams }: ProductoDetallePageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const products = await getSupabaseProducts();
  const product = (products ?? []).find((item) => item.href === `/productos/${slug}` && item.active);

  if (!product) {
    notFound();
  }

  const whatsappHref = whatsappUrl(`Hola DCL Cree LED, quiero consultar por ${product.name}.`);
  const fitment = query.fitment ? await getPublicVehicleCompatibilityById(query.fitment) : null;
  const assessment = assessFitment(fitment, product.connectorType, query.position, query.year);
  const positionLabels: Record<string, string> = { low: "Baja", high: "Alta", fog: "Antiniebla", aux: "Auxiliar" };
  const selectedYear = Number(query.year);
  const selectedConnector = assessment.connector;
  const yearValid = assessment.state === "confirmed";
  const connectorFitment = assessment.state !== "invalid" ? fitment : null;
  const verifiedFitment = yearValid ? fitment : null;
  const cartProduct = { id: product.id, name: product.name, price: product.price, image: product.image, href: product.href, category: product.category };

  const specs = [
    { label: "Conector", value: product.connectorType },
    { label: "Potencia", value: product.watts ? `${product.watts} W` : undefined },
    { label: "Lúmenes", value: product.lumens ? `${product.lumens} lm` : undefined },
    { label: "Voltaje", value: product.voltage },
    { label: "Temperatura de color", value: product.colorTemperature },
    { label: "Chip", value: product.chipType },
    { label: "Canbus", value: product.canbus === undefined ? undefined : product.canbus ? "Sí" : "No" },
    { label: "Garantía", value: product.warranty },
  ].filter((spec) => Boolean(spec.value));

  return (
    <SiteContentProvider initialProducts={products ?? undefined}>
      <div className="min-h-screen bg-black text-white">
        <Header />
        <EventOnMount event={analyticsEvents.productView} properties={{ product_id: product.id, product_slug: slug, category: product.category }}/>

        <main>
          <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
            <Link href="/productos" className="mb-6 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-zinc-400 transition hover:text-red-300">
              ← Volver al catálogo
            </Link>

            <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
              <div className="flex h-80 items-center justify-center overflow-hidden rounded-[1.75rem] border border-white/10 bg-zinc-950/60 p-6 lg:h-[480px]">
                <ManagedImage source={product.image} alt={product.name} className="max-h-full max-w-full object-contain" />
              </div>

              <div className="flex flex-col">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-red-400">{product.category}</p>
                <h1 className="mt-3 text-3xl font-black uppercase tracking-[-0.06em] text-white md:text-4xl">
                  {product.name}
                </h1>
                <p className="mt-4 text-sm leading-7 text-zinc-300">{product.description}</p>

                <div className="mt-6 flex items-baseline gap-3">
                  <span className="text-3xl font-black text-white">
                    ${new Intl.NumberFormat("es-AR").format(product.price)}
                  </span>
                  {product.previousPrice ? (
                    <span className="text-base text-zinc-500 line-through">
                      ${new Intl.NumberFormat("es-AR").format(product.previousPrice)}
                    </span>
                  ) : null}
                </div>

                {verifiedFitment ? <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4"><p className="text-xs font-bold uppercase tracking-widest text-emerald-300">Compatible con</p><p className="mt-2 font-bold">{verifiedFitment.brandName} {verifiedFitment.modelName}{yearValid ? ` ${selectedYear}` : ""}</p><p className="mt-1 text-sm text-zinc-300">{positionLabels[query.position!]} · {selectedConnector}</p></div> : null}

                {connectorFitment && !query.year && <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4"><p className="font-bold">Confirmar el año del vehículo</p><p className="mt-2 text-sm">{connectorFitment.brandName} {connectorFitment.modelName}: {connectorFitment.yearFrom}{connectorFitment.yearTo ? ' a '+connectorFitment.yearTo : ' en adelante'}. El conector coincide para ese rango; falta confirmar el año de tu vehículo.</p></div>}
                {assessment.state === "out_of_range" && <p className="mt-6 rounded-2xl border border-amber-500/30 p-4">El a?o indicado no corresponde al rango compatible de este producto. Revis? el a?o o consultanos antes de comprar.</p>}
                <ProductPurchaseActions product={cartProduct}/>

                {specs.length > 0 ? (
                  <div className="mt-8 grid gap-3 sm:grid-cols-2">
                    {specs.map((spec) => (
                      <div key={spec.label} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">{spec.label}</div>
                        <div className="mt-1 text-sm font-semibold text-white">{spec.value}</div>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <a
                    href={whatsappHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center rounded-full bg-red-600 px-6 py-3.5 text-sm font-bold uppercase tracking-[0.14em] text-white transition hover:bg-red-500"
                  >
                    Consultar por WhatsApp
                  </a>
                  {!verifiedFitment && <a
                    href="/vehiculos"
                    className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/5 px-6 py-3.5 text-sm font-bold uppercase tracking-[0.14em] text-white transition hover:border-red-500/70 hover:text-red-300"
                  >
                    ¿Es compatible con mi vehículo?
                  </a>}
                </div>
              </div>
            </div>
          </section>
        </main>

        <Footer />
        <WhatsAppButton floating />
      </div>
    </SiteContentProvider>
  );
}
