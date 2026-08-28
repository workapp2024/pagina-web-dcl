type WhatsAppButtonProps = {
  label?: string;
  className?: string;
  floating?: boolean;
};

export function WhatsAppButton({
  label = "WhatsApp",
  className = "",
  floating = false,
}: WhatsAppButtonProps) {
  const whatsappHref =
    "https://api.whatsapp.com/send?text=Hola%20DCL%20Cree%20LED%2C%20quiero%20consultar%20por%20iluminaci%C3%B3n%20para%20mi%20veh%C3%ADculo.";

  return (
    <a
      href={whatsappHref}
      target="_blank"
      rel="noreferrer"
      aria-label="Consultar por WhatsApp"
      className={[
        "inline-flex items-center justify-center gap-2 rounded-full bg-red-600 px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-red-500",
        floating ? "fixed bottom-5 right-5 z-50 h-14 w-14 rounded-full p-0 shadow-[0_0_30px_rgba(239,68,68,0.6)]" : "",
        className,
      ].join(" ")}
    >
      <span aria-hidden="true">✆</span>
      {!floating ? <span>{label}</span> : null}
    </a>
  );
}
