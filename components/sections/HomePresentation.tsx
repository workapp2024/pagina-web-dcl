/* eslint-disable @next/next/no-img-element */
import type { HomePresentation } from "@/lib/home-presentation";

export function HomePaymentImage({ settings }: { settings: HomePresentation }) {
  if (!settings.homePaymentEnabled || !settings.homePaymentImage) return null;
  return <section aria-labelledby="home-payment-title" className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
    <h2 id="home-payment-title" className="mb-6 text-center text-2xl font-black sm:text-3xl">{settings.homePaymentTitle}</h2>
    <div className="mx-auto rounded-2xl border border-zinc-200/80 bg-zinc-50 px-5 py-6 shadow-[0_8px_30px_rgba(0,0,0,0.12)] sm:rounded-3xl sm:px-10 sm:py-8">
      <img src={settings.homePaymentImage} alt="Medios de pago aceptados por DCL Cree LED" className="mx-auto block h-auto max-h-64 w-auto max-w-full object-contain" />
    </div>
  </section>;
}

export function HomeFaq({ settings }: { settings: HomePresentation }) {
  const items = settings.faqItems.filter(item => item.enabled);
  if (!settings.faqEnabled || !items.length) return null;
  return <section aria-labelledby="home-faq-title" className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
    <h2 id="home-faq-title" className="mb-6 text-2xl font-black sm:text-3xl">Preguntas frecuentes</h2>
    <div className="space-y-3">{items.map(item => <details key={item.id} className="rounded-2xl border border-white/15 bg-zinc-950/60 px-4 sm:px-5">
      <summary className="min-h-12 cursor-pointer py-4 font-semibold focus-visible:outline-2 focus-visible:outline-red-400">{item.question}</summary>
      <p className="whitespace-pre-wrap break-words pb-5 text-sm leading-7 text-zinc-300">{item.answer}</p>
    </details>)}</div>
  </section>;
}
