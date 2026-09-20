"use client";

import { useEffect, useState } from "react";

type Vehicle = { id: string; brand_name: string; model_name: string; year: number | null; plate: string | null };
type Sale = { id: string; total: number; status: string; created_at: string };
type Warranty = { id: string; status: string; warranty_claims?: { status: string }[] };
type Customer = {
  id: string; full_name: string; phone: string | null; email: string | null;
  document_number: string | null; notes: string; archived_at: string | null;
  vehicles: Vehicle[]; sales: Sale[]; warranties: Warranty[]; total: number;
};
type Form = { fullName: string; phone: string; email: string; documentNumber: string; notes: string };
const emptyForm: Form = { fullName: "", phone: "", email: "", documentNumber: "", notes: "" };
const money = (value: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(value);

export function CustomersManager() {
  const [view, setView] = useState<"active" | "archived">("active");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [rows, setRows] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ view, q: query, page: String(page) });
        const response = await fetch(`/api/admin/customers?${params}`, { signal: controller.signal });
        const body = await response.json();
        if (!body.ok) throw new Error(body.error || "No se pudieron cargar los clientes.");
        setRows(body.data || []);
        setTotal(body.pagination?.total || 0);
        setError("");
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No se pudieron cargar los clientes.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, query ? 180 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [view, query, page, refresh]);

  function startCreate() { setSelected(null); setForm(emptyForm); setFormMode("create"); setError(""); }
  function startEdit(customer: Customer) {
    setForm({ fullName: customer.full_name, phone: customer.phone || "", email: customer.email || "", documentNumber: customer.document_number || "", notes: customer.notes || "" });
    setFormMode("edit"); setError("");
  }
  function chooseView(next: "active" | "archived") { setView(next); setPage(1); setSelected(null); setFormMode(null); setError(""); }
  async function mutate(action: "create" | "edit" | "archive" | "restore" | "delete") {
    if (action === "delete" && !window.confirm("¿Eliminar definitivamente este cliente? Esta acción no se puede deshacer.")) return;
    if (action === "archive" && !window.confirm("¿Archivar este cliente? Podrás restaurarlo después.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/customers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, customerId: selected?.id, ...(action === "create" || action === "edit" ? form : {}) }),
      });
      const body = await response.json();
      if (!body.ok) throw new Error(body.error || "No se pudo guardar el cliente.");
      setSelected(null); setFormMode(null); setRefresh(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar el cliente."); }
    finally { setBusy(false); }
  }

  return <div className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">Clientes</h1>
      <button onClick={startCreate} className="rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500">Crear cliente</button>
    </header>
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex border border-white/15" aria-label="Vista de clientes">
        <button aria-pressed={view === "active"} onClick={() => chooseView("active")} className={`px-4 py-2 text-sm ${view === "active" ? "bg-white text-zinc-950" : "text-zinc-300"}`}>Activos</button>
        <button aria-pressed={view === "archived"} onClick={() => chooseView("archived")} className={`px-4 py-2 text-sm ${view === "archived" ? "bg-white text-zinc-950" : "text-zinc-300"}`}>Archivados</button>
      </div>
      <input aria-label="Buscar clientes" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Buscar por nombre, teléfono, email o documento" className="min-w-0 flex-1 rounded border border-white/15 bg-zinc-900 p-2.5 text-sm" />
    </div>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {loading ? <p className="text-sm text-zinc-400">Cargando clientes...</p> : rows.length === 0 ? <p className="text-sm text-zinc-400">No hay clientes en esta vista.</p> :
      <div className="grid gap-2 md:grid-cols-2">{rows.map(customer => <button key={customer.id} onClick={() => { setSelected(customer); setFormMode(null); setError(""); }} className="border border-white/15 p-4 text-left hover:border-red-500/50">
        <strong>{customer.full_name}</strong><p className="mt-1 text-sm text-zinc-400">{customer.phone || customer.email || "Sin contacto"}</p>
        <p className="mt-3 text-sm">{customer.sales.length} compras · {money(customer.total)}</p>
        <small className="text-zinc-400">{customer.vehicles.length} vehículos · {customer.warranties.length} garantías</small>
      </button>)}</div>}
    {total > 20 && <div className="flex items-center justify-end gap-3 text-sm">
      <button disabled={page <= 1} onClick={() => setPage(value => value - 1)} className="disabled:opacity-40">Anterior</button>
      <span>Página {page} de {Math.ceil(total / 20)}</span>
      <button disabled={page * 20 >= total} onClick={() => setPage(value => value + 1)} className="disabled:opacity-40">Siguiente</button>
    </div>}
    {(selected || formMode) && <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 p-4" role="dialog" aria-modal="true" aria-label={formMode ? "Datos del cliente" : "Ficha del cliente"}>
      <section className="mx-auto max-w-xl border border-white/15 bg-zinc-950 p-5">
        <div className="flex items-start justify-between gap-3"><h2 className="text-xl font-bold">{formMode === "create" ? "Crear cliente" : formMode === "edit" ? "Editar cliente" : selected?.full_name}</h2><button onClick={() => { setSelected(null); setFormMode(null); setError(""); }} className="text-sm text-zinc-300">Cerrar</button></div>
        {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
        {formMode ? <form className="mt-5 space-y-3" onSubmit={event => { event.preventDefault(); void mutate(formMode); }}>
          {([ ["fullName", "Nombre completo", 160], ["phone", "Teléfono", 50], ["email", "Email", 255], ["documentNumber", "Documento", 40], ["notes", "Notas", 1000] ] as const).map(([field, label, max]) => <label key={field} className="block text-sm">{label}<input value={form[field]} maxLength={max} required={field === "fullName"} type={field === "email" ? "email" : "text"} onChange={event => setForm(value => ({ ...value, [field]: event.target.value }))} className="mt-1 w-full rounded border border-white/15 bg-zinc-900 p-2.5" /></label>)}
          <div className="flex gap-3"><button disabled={busy} type="submit" className="rounded bg-red-600 px-4 py-2 text-sm font-semibold disabled:opacity-50">Guardar</button><button type="button" onClick={() => { setFormMode(null); if (!selected) setError(""); }} className="text-sm text-zinc-300">Cancelar</button></div>
        </form> : selected && <div className="mt-4 space-y-4 text-sm">
          <p>{selected.phone || "Sin teléfono"} · {selected.email || "Sin email"}</p>
          {selected.document_number && <p>Documento: {selected.document_number}</p>}
          {selected.notes && <p className="text-zinc-300">{selected.notes}</p>}
          <section><h3 className="font-semibold">Vehículos</h3><p className="text-zinc-400">{selected.vehicles.map(vehicle => `${vehicle.brand_name} ${vehicle.model_name} ${vehicle.year || ""} ${vehicle.plate || ""}`).join(" · ") || "Sin vehículos"}</p></section>
          <section><h3 className="font-semibold">Historial de compras</h3>{selected.sales.length ? selected.sales.map(sale => <p key={sale.id} className="mt-2 border border-white/10 p-2">{new Date(sale.created_at).toLocaleDateString("es-AR")} · {money(sale.total)} · {sale.status}</p>) : <p className="text-zinc-400">Sin compras</p>}</section>
          <p>Gasto total: <strong>{money(selected.total)}</strong></p>
          <div className="flex flex-wrap gap-3 border-t border-white/15 pt-4">
            <button disabled={busy} onClick={() => startEdit(selected)} className="text-white disabled:opacity-50">Editar</button>
            {selected.archived_at ? <button disabled={busy} onClick={() => void mutate("restore")} className="text-green-300 disabled:opacity-50">Restaurar</button> : <button disabled={busy} onClick={() => void mutate("archive")} className="text-amber-300 disabled:opacity-50">Archivar</button>}
            <button disabled={busy} onClick={() => void mutate("delete")} className="text-red-300 disabled:opacity-50">Eliminar definitivamente</button>
          </div>
        </div>}
      </section>
    </div>}
  </div>;
}
