"use client";

import { useEffect, useMemo, useState } from "react";

type Data = { warranties: any[]; saleItems: any[] };

export function WarrantiesManager() {
  const [data, setData] = useState<Data>({ warranties: [], saleItems: [] });
  const [query, setQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const load = async () => {
    const response = await fetch("/api/admin/warranties");
    const json = await response.json();
    if (json.ok) setData({ warranties: json.warranties ?? [], saleItems: json.saleItems ?? [] });
    else setError(json.error ?? "No se pudieron cargar las garantías.");
  };
  useEffect(() => void load(), []);
  const availableItems = useMemo(
    () => data.saleItems.filter((item) => JSON.stringify(item).toLowerCase().includes(query.toLowerCase())).slice(0, 20),
    [data.saleItems, query],
  );
  const registerWarranty = async () => {
    const response = await fetch("/api/admin/warranties", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ saleItemId: selectedItem, expiresAt, notes }) });
    const json = await response.json();
    if (!json.ok) return setError(json.error ?? "No se pudo registrar la garantía.");
    setSelectedItem(""); setExpiresAt(""); setNotes(""); await load();
  };
  const update = async (body: object) => { const response = await fetch("/api/admin/warranties", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const json = await response.json(); if (!json.ok) setError(json.error ?? "No se pudo actualizar."); else await load(); };
  return <div className="space-y-6">
    <div><h1 className="text-3xl font-black">Garantías y reclamos</h1><p className="mt-2 text-sm text-zinc-400">Trazabilidad desde el producto vendido hasta la resolución.</p></div>
    <section className="rounded-2xl border border-white/10 p-4"><h2 className="font-bold">Registrar garantía</h2><input className="mt-3 w-full rounded-xl bg-zinc-900 p-3" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cliente, producto o venta" />
      {query && <div className="mt-2 max-h-48 overflow-auto rounded-xl border border-white/10">{availableItems.map((item) => <button type="button" key={item.id} onClick={() => setSelectedItem(item.id)} className={`block w-full px-3 py-2 text-left text-sm ${selectedItem === item.id ? "bg-red-600/20" : "hover:bg-white/5"}`}>{item.sales?.customers?.full_name ?? "Cliente"} · {item.product_name} × {item.quantity}</button>)}</div>}
      <div className="mt-3 grid gap-3 sm:grid-cols-3"><input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="rounded-xl bg-zinc-900 p-3" /><input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Observaciones" className="rounded-xl bg-zinc-900 p-3" /><button type="button" disabled={!selectedItem} onClick={() => void registerWarranty()} className="rounded-xl bg-red-600 px-4 py-3 font-semibold disabled:opacity-50">Crear garantía</button></div>
    </section>
    {error && <p className="text-sm text-red-300">{error}</p>}
    <div className="space-y-3">{data.warranties.map((warranty) => <article key={warranty.id} className="rounded-2xl border border-white/10 p-4"><div className="flex flex-col justify-between gap-2 sm:flex-row"><div><b>{warranty.customers?.full_name ?? "Cliente"}</b><p className="text-sm text-zinc-400">{warranty.sale_items?.product_name} · venta {warranty.sale_items?.sales?.created_at ? new Date(warranty.sale_items.sales.created_at).toLocaleDateString("es-AR") : ""}</p></div><select value={warranty.status} onChange={(event) => void update({ kind: "warranty", id: warranty.id, status: event.target.value, expiresAt: warranty.expires_at, notes: warranty.notes })} className="rounded-xl bg-zinc-900 p-2"><option value="active">Activa</option><option value="expired">Vencida</option><option value="void">Anulada</option></select></div><p className="mt-2 text-sm">Vence: {warranty.expires_at ? new Date(warranty.expires_at).toLocaleDateString("es-AR") : "Sin vencimiento"}</p><div className="mt-3 space-y-2">{warranty.warranty_claims?.map((claim: any) => <div key={claim.id} className="rounded-xl bg-white/5 p-3 text-sm"><b>{claim.status}</b> · {claim.description}{claim.resolution && ` — ${claim.resolution}`} {claim.status === "open" && <button type="button" onClick={() => void update({ kind: "claim", id: claim.id, status: "resolved", resolution: "Resuelto administrativamente" })} className="ml-2 text-red-300">Resolver</button>}</div>)}<button type="button" onClick={() => { const description = window.prompt("Descripción del reclamo"); if (description) void update({ kind: "new_claim", warrantyId: warranty.id, description }); }} className="text-sm text-red-300">+ Registrar reclamo</button></div></article>)}</div>
  </div>;
}
