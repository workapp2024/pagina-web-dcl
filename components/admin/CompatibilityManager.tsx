/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import {
  deleteAdminVehicleCompatibility,
  getAdminVehicleCompatibilities,
  upsertAdminVehicleCompatibility,
  VEHICLE_TYPES,
  type VehicleCompatibilityFull,
} from "@/lib/supabase/vehicle-compatibility";

const emptyForm = {
  vehicleType: "Auto" as string,
  brandName: "",
  modelName: "",
  yearFrom: "",
  yearTo: "",
  version: "",
  connectorLow: "",
  connectorHigh: "",
  connectorFog: "",
  connectorAux: "",
  combinedHighLow: false,
  notes: "",
  active: true,
};

export function AdminCompatibilityManager() {
  const [rows, setRows] = useState<VehicleCompatibilityFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ type: "saving" | "success" | "error"; message: string } | null>(null);
  const [tableError, setTableError] = useState(false);

  const loadRows = async () => {
    setLoading(true);
    const data = await getAdminVehicleCompatibilities();
    if (data === null) {
      setTableError(true);
      setRows([]);
    } else {
      setTableError(false);
      setRows(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadRows();
  }, []);

  const updateField = (field: keyof typeof emptyForm, value: string | boolean) => {
    setForm((previous) => ({ ...previous, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!form.brandName.trim() || !form.modelName.trim() || !form.yearFrom.trim() || (form.combinedHighLow && !form.connectorLow.trim())) {
      setStatus({ type: "error", message: "Marca, modelo y año desde son obligatorios." });
      return;
    }

    setStatus({ type: "saving", message: "Guardando en Supabase..." });

    const result = await upsertAdminVehicleCompatibility({
      vehicleType: form.vehicleType,
      id: editingId || undefined,
      active: form.active,
      brandName: form.brandName.trim(),
      modelName: form.modelName.trim(),
      yearFrom: Number(form.yearFrom),
      yearTo: form.yearTo.trim() ? Number(form.yearTo) : null,
      version: form.version.trim() || undefined,
      connectorLow: form.connectorLow.trim() || undefined,
      connectorHigh: form.connectorHigh.trim() || undefined,
      connectorFog: form.connectorFog.trim() || undefined,
      connectorAux: form.connectorAux.trim() || undefined,
      combinedHighLow: form.combinedHighLow,
      notes: form.notes.trim() || undefined,
    });

    if (result.success) {
      setStatus({ type: "success", message: editingId ? "✓ Compatibilidad actualizada" : "✓ Compatibilidad guardada" });
      setForm(emptyForm);
      setEditingId(null);
      await loadRows();
      setTimeout(() => setStatus(null), 4000);
    } else {
      setStatus({ type: "error", message: result.error || "Error al guardar en Supabase" });
    }
  };

  const handleEdit = (row: VehicleCompatibilityFull) => {
    setEditingId(row.id);
    setForm({
      vehicleType: row.vehicleType || "Auto",
      brandName: row.brandName,
      modelName: row.modelName,
      yearFrom: String(row.yearFrom),
      yearTo: row.yearTo === null ? "" : String(row.yearTo),
      version: row.version || "",
      connectorLow: row.connectorLow || "",
      connectorHigh: row.connectorHigh || "",
      connectorFog: row.connectorFog || "",
      connectorAux: row.connectorAux || "",
      combinedHighLow: row.combinedHighLow,
      notes: row.notes || "",
      active: row.active,
    });
    setStatus(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm);
    setStatus(null);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("¿Eliminar esta compatibilidad? Esta acción no se puede deshacer.")) return;
    const result = await deleteAdminVehicleCompatibility(id);
    if (result.success) {
      await loadRows();
    } else {
      window.alert(result.error || "Error al eliminar en Supabase");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black uppercase tracking-[-0.06em] text-white">Compatibilidades</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Relación Tipo → Marca → Modelo → Año → Conector, utilizada por el buscador de LED público.
        </p>
      </div>

      {tableError ? (
        <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-200">
          Todavía no existen las tablas de compatibilidad en Supabase. Ejecutá la migración
          <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5">supabase/migrations/20260830_vehicle_compatibility.sql</code>
          desde el SQL Editor de Supabase y volvé a cargar esta página.
        </div>
      ) : null}

      <section className="rounded-[1.75rem] border border-white/10 bg-zinc-950/80 p-5 sm:p-6">
        <h2 className="text-xl font-black uppercase tracking-[-0.05em] text-white">
          {editingId ? "Editar compatibilidad" : "Agregar compatibilidad"}
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          {editingId ? "Estás modificando el registro existente; se conservará su identificador." : "Si la marca o el modelo ya existen, se reutilizan automáticamente (no se duplican)."}
        </p>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <label className="block text-sm text-zinc-300">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Tipo de vehículo</span>
            <select
              value={form.vehicleType}
              onChange={(event) => updateField("vehicleType", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
            >
              {VEHICLE_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </label>

          <label className="block text-sm text-zinc-300">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Marca</span>
            <input
              placeholder="Toyota"
              value={form.brandName}
              onChange={(event) => updateField("brandName", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
            />
          </label>

          <label className="block text-sm text-zinc-300">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Modelo</span>
            <input
              placeholder="Hilux"
              value={form.modelName}
              onChange={(event) => updateField("modelName", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
            />
          </label>

          <label className="block text-sm text-zinc-300">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Año desde</span>
            <input
              type="number"
              placeholder="2016"
              value={form.yearFrom}
              onChange={(event) => updateField("yearFrom", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
            />
          </label>

          <label className="block text-sm text-zinc-300">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Año hasta (opcional)</span>
            <input
              type="number"
              placeholder="2023"
              value={form.yearTo}
              onChange={(event) => updateField("yearTo", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
            />
          </label>

          <label className="block text-sm text-zinc-300">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Versión (opcional)</span>
            <input
              placeholder="SRV 4x4"
              value={form.version}
              onChange={(event) => updateField("version", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
            />
          </label>

          <label className="block text-sm text-zinc-300">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Conector luz baja</span>
            <input
              placeholder="H4"
              value={form.connectorLow}
              onChange={(event) => updateField("connectorLow", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
            />
          </label>

          <label className="block text-sm text-zinc-300">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Conector luz alta</span>
            <input
              placeholder="H1"
              value={form.connectorHigh}
              disabled={form.combinedHighLow}
              onChange={(event) => updateField("connectorHigh", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white disabled:opacity-40"
            />
          </label>

          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-900 px-3 py-3 text-sm text-zinc-200">
            <input type="checkbox" checked={form.combinedHighLow} onChange={(event) => setForm((previous) => ({ ...previous, combinedHighLow: event.target.checked, connectorHigh: event.target.checked ? "" : previous.connectorHigh }))} />
            Alta y baja juntas (una lámpara)
          </label>

          <label className="block text-sm text-zinc-300">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Antiniebla (opcional)</span>
            <input
              placeholder="H11"
              value={form.connectorFog}
              onChange={(event) => updateField("connectorFog", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
            />
          </label>

          <label className="block text-sm text-zinc-300">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Auxiliar/posición (opcional)</span>
            <input
              placeholder="W5W"
              value={form.connectorAux}
              onChange={(event) => updateField("connectorAux", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
            />
          </label>

          <label className="block text-sm text-zinc-300 md:col-span-3">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Observaciones (opcional)</span>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(event) => updateField("notes", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
            />
          </label>

          <label className="inline-flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => setForm((previous) => ({ ...previous, active: event.target.checked }))}
            />
            Compatibilidad activa
          </label>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={status?.type === "saving"}
            className="rounded-full bg-red-600 px-5 py-2.5 text-xs font-bold uppercase tracking-[0.16em] text-white transition hover:bg-red-500 disabled:opacity-50"
          >
            {status?.type === "saving" ? "Guardando..." : editingId ? "Guardar cambios" : "Guardar compatibilidad"}
          </button>
          {editingId ? (
            <button
              type="button"
              onClick={cancelEdit}
              disabled={status?.type === "saving"}
              className="rounded-full border border-white/15 px-5 py-2.5 text-xs font-bold uppercase tracking-[0.16em] text-zinc-300 transition hover:border-white/40 hover:text-white disabled:opacity-50"
            >
              Cancelar
            </button>
          ) : null}
          {status?.message ? (
            <span className={["text-xs font-medium", status.type === "error" ? "text-red-400" : "text-green-400"].join(" ")}>
              {status.message}
            </span>
          ) : null}
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-white/10 bg-zinc-950/80 p-5 sm:p-6">
        <h2 className="text-xl font-black uppercase tracking-[-0.05em] text-white">Compatibilidades cargadas</h2>
        {loading ? (
          <p className="mt-4 text-sm text-zinc-400">Cargando...</p>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-400">Todavía no hay compatibilidades cargadas.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm text-zinc-300">
              <thead>
                <tr className="border-b border-white/10 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                  <th className="py-2 pr-3">Tipo</th>
                  <th className="py-2 pr-3">Marca / Modelo</th>
                  <th className="py-2 pr-3">Años</th>
                  <th className="py-2 pr-3">Baja / Alta / Antiniebla / Aux</th>
                  <th className="py-2 pr-3">Estado</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-white/5">
                    <td className="py-2 pr-3">{row.vehicleType}</td>
                    <td className="py-2 pr-3 font-semibold text-white">{row.brandName} {row.modelName}</td>
                    <td className="py-2 pr-3">{row.yearFrom}{row.yearTo ? `–${row.yearTo}` : "+"}</td>
                    <td className="py-2 pr-3">
                      {row.combinedHighLow ? `Alta y baja: ${row.connectorLow}` : [row.connectorLow, row.connectorHigh, row.connectorFog, row.connectorAux].filter(Boolean).join(" / ") || "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <span className={row.active ? "text-emerald-300" : "text-zinc-500"}>{row.active ? "Activa" : "Inactiva"}</span>
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleEdit(row)}
                        className="mr-2 rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-200 hover:border-white/40"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(row.id)}
                        className="rounded-full border border-red-500/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-red-300 hover:bg-red-600/10"
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
