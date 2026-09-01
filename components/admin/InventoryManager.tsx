"use client";

import { useEffect, useMemo, useState } from "react";

import {
  createInventoryMovement,
  getAdminInventory,
  type CreateInventoryMovementInput,
  type InventoryMovement,
  type InventoryProduct,
} from "@/lib/supabase/inventory";

type MovementForm = {
  productId: string;
  type: CreateInventoryMovementInput["type"];
  quantity: string;
  reason: string;
};

const emptyForm: MovementForm = { productId: "", type: "entrada", quantity: "", reason: "" };

function stockStatus(product: InventoryProduct) {
  if (product.stock <= 0) return { label: "Sin stock", className: "border-red-500/40 bg-red-500/10 text-red-200" };
  if (product.stock <= product.stockMin) return { label: "Stock bajo", className: "border-amber-500/40 bg-amber-500/10 text-amber-100" };
  return { label: "Normal", className: "border-emerald-500/35 bg-emerald-500/10 text-emerald-100" };
}

function movementLabel(type: InventoryMovement["type"]) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function formatCurrency(value: number | undefined) {
  if (value === undefined) return "—";
  return `$${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(value)}`;
}

export function AdminInventoryManager() {
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [form, setForm] = useState<MovementForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let isMounted = true;
    getAdminInventory().then((result) => {
      if (!isMounted) return;
      if (result.success) {
        setProducts(result.data?.products ?? []);
        setMovements(result.data?.movements ?? []);
      } else {
        setError(result.error || "No se pudo cargar el inventario.");
      }
      setLoading(false);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const activeProducts = useMemo(() => products.filter((product) => product.active), [products]);

  async function refreshInventory() {
    setRefreshing(true);
    setError("");
    const result = await getAdminInventory();
    if (result.success) {
      setProducts(result.data?.products ?? []);
      setMovements(result.data?.movements ?? []);
    } else {
      setError(result.error || "No se pudo actualizar el inventario.");
    }
    setRefreshing(false);
  }

  async function submitMovement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const quantity = Number(form.quantity);

    if (!form.productId || !Number.isInteger(quantity) || quantity === 0 || !form.reason.trim()) {
      setError("Elegí un producto, ingresá una cantidad entera distinta de cero y detallá el motivo.");
      return;
    }
    if ((form.type === "entrada" || form.type === "salida") && quantity < 0) {
      setError("Las entradas y salidas se cargan con una cantidad positiva.");
      return;
    }

    setSubmitting(true);
    const result = await createInventoryMovement({
      productId: form.productId,
      type: form.type,
      quantity,
      reason: form.reason.trim(),
    });
    setSubmitting(false);

    if (!result.success) {
      setError(result.error || "No se pudo registrar el movimiento.");
      return;
    }

    setNotice("Movimiento registrado y stock actualizado.");
    setForm((previous) => ({ ...emptyForm, productId: previous.productId, type: previous.type }));
    await refreshInventory();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-[-0.06em] text-white">Inventario</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            El stock se materializa en cada producto, pero cada modificación se registra como un movimiento auditable.
          </p>
        </div>
        <button
          type="button"
          onClick={refreshInventory}
          disabled={loading || refreshing}
          className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white transition hover:border-red-500/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {refreshing ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      {error ? <div className="rounded-2xl border border-red-500/35 bg-red-500/10 p-4 text-sm text-red-100">{error}</div> : null}
      {notice ? <div className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-4 text-sm text-emerald-100">{notice}</div> : null}

      <section className="rounded-[1.75rem] border border-white/10 bg-zinc-950/80 p-5 sm:p-6">
        <div className="mb-5">
          <h2 className="text-xl font-black uppercase tracking-[-0.05em] text-white">Registrar movimiento</h2>
          <p className="mt-2 text-sm text-zinc-400">Para ajuste, usá un delta: positivo suma unidades y negativo las descuenta.</p>
        </div>

        <form onSubmit={submitMovement} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="block text-sm text-zinc-300 xl:col-span-2">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Producto</span>
            <select
              value={form.productId}
              onChange={(event) => setForm((previous) => ({ ...previous, productId: event.target.value }))}
              disabled={loading || activeProducts.length === 0}
              required
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white disabled:opacity-50"
            >
              <option value="">Seleccioná un producto...</option>
              {activeProducts.map((product) => <option key={product.id} value={product.id}>{product.name} · stock {product.stock}</option>)}
            </select>
          </label>

          <label className="block text-sm text-zinc-300">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Tipo</span>
            <select
              value={form.type}
              onChange={(event) => setForm((previous) => ({ ...previous, type: event.target.value as MovementForm["type"] }))}
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
            >
              <option value="entrada">Entrada</option>
              <option value="salida">Salida</option>
              <option value="ajuste">Ajuste</option>
            </select>
          </label>

          <label className="block text-sm text-zinc-300">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
              {form.type === "ajuste" ? "Ajuste (+/-)" : "Cantidad"}
            </span>
            <input
              type="number"
              step="1"
              min={form.type === "ajuste" ? undefined : 1}
              value={form.quantity}
              onChange={(event) => setForm((previous) => ({ ...previous, quantity: event.target.value }))}
              placeholder={form.type === "ajuste" ? "Ej. -2 o 3" : "Ej. 5"}
              required
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
            />
          </label>

          <label className="block text-sm text-zinc-300 md:col-span-2 xl:col-span-3">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Motivo / observación</span>
            <input
              value={form.reason}
              onChange={(event) => setForm((previous) => ({ ...previous, reason: event.target.value }))}
              placeholder="Ej. reposición de proveedor, corrección por conteo"
              required
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
            />
          </label>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={loading || submitting || activeProducts.length === 0}
              className="w-full rounded-full bg-red-600 px-5 py-3 text-xs font-bold uppercase tracking-[0.14em] text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Registrando..." : "Registrar movimiento"}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-[1.75rem] border border-white/10 bg-zinc-950/80 p-5 sm:p-6">
        <h2 className="text-xl font-black uppercase tracking-[-0.05em] text-white">Stock por producto</h2>
        {loading ? <p className="mt-4 text-sm text-zinc-400">Cargando inventario...</p> : null}
        {!loading && products.length === 0 ? <p className="mt-4 text-sm text-zinc-400">Todavía no hay productos disponibles.</p> : null}
        {products.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm text-zinc-300">
              <thead><tr className="border-b border-white/10 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                <th className="py-3 pr-3">Producto</th><th className="py-3 pr-3">Código</th><th className="py-3 pr-3">Stock</th><th className="py-3 pr-3">Mínimo</th><th className="py-3 pr-3">Costo</th><th className="py-3 pr-3">Venta</th><th className="py-3 pr-3">Margen</th><th className="py-3">Estado</th>
              </tr></thead>
              <tbody>{products.map((product) => {
                const status = stockStatus(product);
                return <tr key={product.id} className="border-b border-white/5">
                  <td className="py-3 pr-3 font-semibold text-white">{product.name}{!product.active ? <span className="ml-2 text-xs font-normal text-zinc-500">Inactivo</span> : null}</td>
                  <td className="py-3 pr-3 font-mono text-xs text-zinc-400">{product.id}</td>
                  <td className="py-3 pr-3 text-base font-black text-white">{product.stock}</td>
                  <td className="py-3 pr-3">{product.stockMin}</td>
                  <td className="py-3 pr-3">{formatCurrency(product.costPrice)}</td>
                  <td className="py-3 pr-3">{formatCurrency(product.price)}</td>
                  <td className="py-3 pr-3">{product.marginPercentage === undefined ? "—" : `${product.marginPercentage}%`}</td>
                  <td className="py-3"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${status.className}`}>{status.label}</span></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="rounded-[1.75rem] border border-white/10 bg-zinc-950/80 p-5 sm:p-6">
        <h2 className="text-xl font-black uppercase tracking-[-0.05em] text-white">Historial de movimientos</h2>
        {!loading && movements.length === 0 ? <p className="mt-4 text-sm text-zinc-400">Todavía no hay movimientos registrados.</p> : null}
        {movements.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm text-zinc-300">
              <thead><tr className="border-b border-white/10 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                <th className="py-3 pr-3">Fecha</th><th className="py-3 pr-3">Producto</th><th className="py-3 pr-3">Tipo</th><th className="py-3 pr-3">Cantidad</th><th className="py-3 pr-3">Motivo</th><th className="py-3">Referencia</th>
              </tr></thead>
              <tbody>{movements.map((movement) => <tr key={movement.id} className="border-b border-white/5">
                <td className="py-3 pr-3 text-zinc-400">{new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(movement.createdAt))}</td>
                <td className="py-3 pr-3 font-semibold text-white">{movement.productName}</td>
                <td className="py-3 pr-3">{movementLabel(movement.type)}</td>
                <td className={`py-3 pr-3 font-black ${movement.quantityDelta > 0 ? "text-emerald-300" : "text-red-300"}`}>{movement.quantityDelta > 0 ? "+" : ""}{movement.quantityDelta}</td>
                <td className="py-3 pr-3">{movement.reason}</td>
                <td className="py-3 text-zinc-400">{movement.referenceType && movement.referenceId ? `${movement.referenceType}: ${movement.referenceId}` : "—"}</td>
              </tr>)}</tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
