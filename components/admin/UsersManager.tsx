"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { StaffProfile } from "@/lib/admin-permissions";

type UsersState = { data: StaffProfile[]; legacy: boolean; bootstrapAvailable: boolean };
async function fetchUsers(): Promise<UsersState> {
  const response = await fetch("/api/admin/users");
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || body.error || "No se pudieron cargar los usuarios.");
  return body;
}

export function UsersManager() {
  const [state, setState] = useState<UsersState | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setState(await fetchUsers());
  }
  useEffect(() => {
    let cancelled = false;
    void fetchUsers().then(data => { if (!cancelled) setState(data); }).catch(error => { if (!cancelled) setMessage(error.message); });
    return () => { cancelled = true; };
  }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true); setMessage("");
    try {
      const bootstrap = state?.legacy && state.bootstrapAvailable;
      const response = await fetch(bootstrap ? "/api/admin/users/bootstrap" : "/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: values.get("name"), email: values.get("email"), password: values.get("password"), ...(bootstrap ? { confirmation: values.get("confirmation") } : {}) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || body.error || "No se pudo crear el usuario.");
      form.reset(); setMessage(bootstrap ? "Administrador principal creado. Cerrá sesión e ingresá con tu email y contraseña nuevos para verificar el acceso." : "Vendedor creado."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo conectar."); }
    finally { setBusy(false); }
  }
  async function toggle(user: StaffProfile) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: user.id, active: !user.active }) });
      if (!response.ok) throw new Error("No se pudo actualizar el vendedor.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo conectar."); }
    finally { setBusy(false); }
  }
  const input = "mt-2 block w-full rounded-xl border border-white/10 bg-zinc-900 p-3";
  return <div className="space-y-6"><h1 className="text-2xl font-black">Usuarios</h1>
    {state && (!state.legacy || state.bootstrapAvailable) && <form onSubmit={create} className="space-y-4 rounded-2xl border border-white/10 p-5">
      <h2 className="font-bold">{state.legacy ? "Crear administrador principal" : "Crear vendedor"}</h2>
      <label className="block">Nombre<input name="name" required={state.legacy} maxLength={160} className={input} /></label>
      <label className="block">Email<input name="email" type="email" autoComplete="off" required maxLength={255} className={input} /></label>
      <label className="block">Contraseña inicial<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} className={input} /></label>
      {state.legacy && <label className="block">Confirmar contraseña<input name="confirmation" type="password" autoComplete="new-password" required minLength={12} maxLength={128} className={input} /></label>}
      <button disabled={busy} className="rounded-full bg-red-600 px-5 py-3 disabled:opacity-50">{state.legacy ? "Crear administrador principal" : "Crear vendedor"}</button>
    </form>}
    {state?.legacy && !state.bootstrapAvailable && <p>El alta inicial ya está cerrada. Cerrá sesión e ingresá con tu cuenta ADMIN individual para administrar usuarios.</p>}
    {message && <p role="status">{message}</p>}
    <div className="space-y-3">{state?.data.map(user => <article key={user.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 p-4">
      <div><b>{user.display_name || user.email}</b><p className="break-all text-sm text-zinc-400">{user.email} · {user.role} · {user.active ? "Activo" : "Inactivo"}</p></div>
      {user.role === "VENDEDOR" && <button disabled={busy} onClick={() => void toggle(user)} className="rounded-full border border-white/20 px-4 py-2 disabled:opacity-50">{user.active ? "Desactivar" : "Activar"}</button>}
    </article>)}</div>
  </div>;
}
