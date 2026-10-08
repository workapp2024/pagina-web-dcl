"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { WhatsAppButton } from "@/components/ui/WhatsAppButton";

export function WholesaleAccessForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedCode = code.trim();
    setCode("");
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/wholesale/session", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: submittedCode }), cache: "no-store",
      });
      const body = await response.json();
      if (!body.ok) throw new Error(body.error || "Código inválido o acceso inactivo.");
      router.replace("/mayoristas");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo validar el código. Intentá nuevamente.");
    } finally { setBusy(false); }
  }

  return <main className="mx-auto flex min-h-[calc(100svh-4rem)] max-w-xl items-center px-4 py-10 sm:px-6">
    <section className="w-full rounded-3xl border border-white/10 bg-zinc-950 p-5 shadow-2xl sm:p-8">
      <p className="text-xs font-bold uppercase tracking-[0.25em] text-red-300">DCL CREE LED</p>
      <h1 className="mt-3 text-3xl font-black uppercase tracking-tight">DCL Mayoristas</h1>
      <p className="mt-3 text-sm leading-6 text-zinc-300">Ingresá tu código individual para consultar los precios especiales para clientes mayoristas.</p>
      <form onSubmit={submit} className="mt-7 space-y-4">
        <label htmlFor="wholesale-code" className="block text-sm font-semibold text-zinc-200">Código de acceso</label>
        <input id="wholesale-code" name="code" type="password" inputMode="text" autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={64} value={code} onChange={event => setCode(event.target.value)} className="min-h-12 w-full rounded-xl border border-white/15 bg-black px-4 text-base tracking-widest text-white outline-none focus:border-red-400" />
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <button type="submit" disabled={busy || !code.trim()} className="min-h-12 w-full rounded-full bg-red-600 px-5 text-sm font-bold uppercase tracking-wider text-white hover:bg-red-500 disabled:opacity-50">{busy ? "Validando…" : "Ingresar"}</button>
      </form>
      <div className="mt-7 border-t border-white/10 pt-5"><p className="mb-3 text-sm text-zinc-400">¿Todavía no sos cliente mayorista? Consultá con DCL.</p><WhatsAppButton label="CONSULTAR POR WHATSAPP" message="Hola DCL Cree LED, quiero consultar cómo ser cliente mayorista." className="min-h-12 w-full justify-center rounded-full border border-white/15 bg-transparent text-white hover:border-red-400" /></div>
    </section>
  </main>;
}
