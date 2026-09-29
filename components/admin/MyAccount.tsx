"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AdminRole } from "@/lib/admin-permissions";

type Account = { display_name: string; email: string; role: AdminRole };
export function MyAccount() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/admin/account").then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "No se pudo cargar la cuenta.");
      if (!cancelled) { setAccount(body.data); setName(body.data.display_name); }
    }).catch(error => { if (!cancelled) setMessage(error.message); });
    return () => { cancelled = true; };
  }, []);
  async function save(event: FormEvent<HTMLFormElement>, passwordChange: boolean) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/account", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(passwordChange ? { password: values.get("password"), confirmation: values.get("confirmation") } : { name }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "No se pudo guardar.");
      if (passwordChange) form.reset();
      setMessage(passwordChange ? "Contraseña actualizada. Tu sesión fue renovada; las sesiones anteriores ya no son válidas." : "Nombre actualizado.");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo conectar."); }
    finally { setBusy(false); }
  }
  const input = "mt-2 block w-full rounded-xl border border-white/10 bg-zinc-900 p-3";
  return <div className="max-w-xl space-y-6"><h1 className="text-2xl font-black">Mi cuenta</h1>
    {account && <><dl className="space-y-2"><dt>Email</dt><dd className="break-all">{account.email}</dd><dt>Rol</dt><dd>{account.role}</dd></dl>
      <form onSubmit={event => void save(event, false)} className="space-y-4"><label className="block">Nombre visible<input value={name} onChange={event => setName(event.target.value)} maxLength={160} className={input} /></label><button disabled={busy} className="rounded-full border border-white/20 px-5 py-3 disabled:opacity-50">Guardar nombre</button></form>
      <form onSubmit={event => void save(event, true)} className="space-y-4 border-t border-white/10 pt-5"><h2 className="font-bold">Cambiar contraseña</h2>
        <label className="block">Nueva contraseña<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} className={input} /></label>
        <label className="block">Confirmar nueva contraseña<input name="confirmation" type="password" autoComplete="new-password" required minLength={12} maxLength={128} className={input} /></label>
        <button disabled={busy} className="rounded-full bg-red-600 px-5 py-3 disabled:opacity-50">Cambiar contraseña</button>
      </form></>}
    {message && <p role="status">{message}</p>}
  </div>;
}
