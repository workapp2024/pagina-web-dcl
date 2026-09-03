"use client";

import { whatsappUrl } from "@/lib/whatsapp";
import { analyticsEvents, capture } from "@/lib/analytics";

type WhatsAppButtonProps = { label?: string; className?: string; floating?: boolean; message?: string; source?: "header"|"floating"|"footer"|"product"|"vehicle_search"|"promotion"|"cart"|"other" };

function WhatsAppIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className="h-5 w-5 shrink-0 fill-current">
      <path d="M16.02 3A12.8 12.8 0 0 0 5.14 22.55L3.4 29l6.6-1.7A12.85 12.85 0 1 0 16.02 3Zm0 23.35c-2.02 0-3.99-.58-5.68-1.68l-.41-.25-3.91 1.01 1.04-3.8-.27-.42A10.52 10.52 0 1 1 16.02 26.35Zm5.77-7.88c-.32-.16-1.87-.92-2.16-1.03-.29-.11-.5-.16-.71.16-.21.31-.82 1.03-1 1.24-.19.21-.37.24-.69.08-.31-.16-1.33-.49-2.53-1.56a9.48 9.48 0 0 1-1.75-2.18c-.18-.31-.02-.48.14-.64.14-.14.31-.37.47-.55.16-.19.21-.32.31-.53.11-.21.06-.39-.02-.55-.08-.16-.72-1.74-.98-2.38-.26-.62-.52-.54-.71-.55h-.61c-.21 0-.55.08-.84.39-.29.32-1.11 1.08-1.11 2.64 0 1.55 1.14 3.06 1.3 3.27.15.21 2.24 3.42 5.42 4.8.76.32 1.35.52 1.81.67.76.24 1.45.21 2 .13.61-.09 1.87-.77 2.14-1.5.26-.74.26-1.37.18-1.5-.08-.14-.29-.21-.61-.37Z" />
    </svg>
  );
}

export function WhatsAppButton({ label = "WhatsApp", className = "", floating = false, message, source }: WhatsAppButtonProps) {
  const whatsappHref = whatsappUrl(message || "Hola DCL Cree LED, quiero consultar por iluminación para mi vehículo.");

  return (
    <a
      href={whatsappHref}
      target="_blank"
      rel="noreferrer"
      aria-label="Consultar por WhatsApp"
      onClick={() => capture(analyticsEvents.whatsappClick, { source: source || (floating ? "floating" : "other") })}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-full bg-[#25D366] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-zinc-950 shadow-sm transition duration-200 hover:bg-[#2ee071] hover:shadow-md active:scale-[.98]",
        floating ? "fixed bottom-[max(.75rem,env(safe-area-inset-bottom))] right-3 z-[45] h-[3.25rem] w-[3.25rem] p-0 shadow-[0_10px_28px_rgba(0,0,0,.4)] sm:bottom-[max(1rem,env(safe-area-inset-bottom))] sm:right-5 sm:h-12 sm:w-auto sm:px-4" : "",
        className,
      ].join(" ")}
    >
      <WhatsAppIcon />
      {floating ? <span className="hidden text-xs sm:inline">Consultanos</span> : <span>{label}</span>}
    </a>
  );
}
