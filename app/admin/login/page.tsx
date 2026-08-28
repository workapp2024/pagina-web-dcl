"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const formData = new FormData();
    formData.set("password", password);

    const response = await fetch("/api/admin/login", {
      method: "POST",
      body: formData,
    });

    setIsSubmitting(false);

    if (!response.ok) {
      setError("Contraseña incorrecta. Consultá al administrador del sitio.");
      return;
    }

    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(239,68,68,0.2),transparent_35%),#050505] px-4">
      <div className="w-full max-w-md rounded-[2rem] border border-white/10 bg-zinc-950/90 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.6)] sm:p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-red-500/60 bg-red-600/10 text-xl font-black uppercase tracking-[0.15em] text-red-400">
            DCL
          </div>
          <h1 className="mt-4 text-2xl font-black uppercase tracking-[-0.06em] text-white">Panel admin</h1>
          <p className="mt-2 text-sm text-zinc-400">Ingresá la contraseña para continuar.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm text-zinc-300">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Contraseña</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-3 text-white outline-none transition focus:border-red-500/60"
              placeholder="••••••••"
              required
            />
          </label>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-full bg-red-600 px-5 py-3 text-sm font-bold uppercase tracking-[0.16em] text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "INGRESANDO..." : "INGRESAR"}
          </button>
        </form>
      </div>
    </div>
  );
}
