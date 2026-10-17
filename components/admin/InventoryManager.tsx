"use client";
import { InventoryMovementCard } from "@/components/admin/InventoryMovementCard";
import { InventoryStockCard } from "@/components/admin/InventoryStockCard";
import { InventoryProductSearch } from "@/components/admin/InventoryProductSearch";
import { SearchableList } from "@/components/admin/SearchableList";
import { useIsOwner } from "@/components/admin/AdminIdentityProvider";

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
  const isOwner = useIsOwner();
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
          <h1 className="text-3xl font-black uppercase tracking-[-0.06em] text-white">Inventario minorista</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Consultá existencias o registrá un ingreso, salida o ajuste.
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

      {isOwner && <section className="rounded-[1.75rem] border border-white/10 bg-zinc-950/80 p-5 sm:p-6">
        <div className="mb-5">
          <h2 className="text-xl font-black uppercase tracking-[-0.05em] text-white">Registrar movimiento</h2>
          <p className="mt-2 text-sm text-zinc-400">Para ajuste, usá un delta: positivo suma unidades y negativo las descuenta.</p>
        </div>

        <form onSubmit={submitMovement} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="xl:col-span-2"><InventoryProductSearch products={activeProducts} value={form.productId} disabled={loading} onChange={productId => setForm(previous => ({ ...previous, productId }))} /></div>

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
              disabled={loading || submitting || !form.productId}
              className="w-full rounded-full bg-red-600 px-5 py-3 text-xs font-bold uppercase tracking-[0.14em] text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Registrando..." : "Registrar movimiento"}
            </button>
          </div>
        </form>
      </section>}

      <section className="rounded-[1.75rem] border border-white/10 bg-zinc-950/80 p-5 sm:p-6">
        <h2 className="text-xl font-black uppercase tracking-[-0.05em] text-white">Stock por producto</h2>
        <SearchableList rows={products} label="Productos" placeholder="Nombre o código" stock={product => product.stock} loading={loading} searchText={product => [product.name, product.id]}>
          {products => (
          <div className="mt-4">{products.map(product => { const status = stockStatus(product); return <InventoryStockCard key={product.id} name={product.name} code={product.id} stock={product.stock}><span className={status.className}>{status.label}</span>{!product.active && <span>Inactivo</span>}<details className="w-full"><summary className="min-h-11 cursor-pointer py-3">Detalles del producto</summary><dl className="grid grid-cols-2 gap-3 text-zinc-400"><div><dt>Mínimo</dt><dd>{product.stockMin}</dd></div><div><dt>Costo</dt><dd>{formatCurrency(product.costPrice)}</dd></div><div><dt>Venta</dt><dd>{formatCurrency(product.price)}</dd></div><div><dt>Margen</dt><dd>{product.marginPercentage === undefined ? "—" : product.marginPercentage + "%"}</dd></div></dl></details></InventoryStockCard>; })}</div>          )}
        </SearchableList>
      </section>

      <section className="rounded-[1.75rem] border border-white/10 bg-zinc-950/80 p-5 sm:p-6">
        <h2 className="text-xl font-black uppercase tracking-[-0.05em] text-white">Historial de movimientos</h2>
        <SearchableList rows={movements} label="Movimientos" placeholder="Producto, código, fecha, tipo o motivo" loading={loading} movement={{ date: row => row.createdAt, type: row => row.type, labels: { entrada: "Entrada", salida: "Salida", ajuste: "Ajuste", venta: "Venta" } }} searchText={movement => [movement.productName, movement.productId, movement.type, movement.reason, movement.referenceType, movement.referenceId, movement.createdAt, new Date(movement.createdAt).toLocaleDateString("es-AR")]}>
          {movements => (
          <div className="mt-4">{movements.map(movement => <InventoryMovementCard key={movement.id} name={movement.productName} type={movementLabel(movement.type)} date={movement.createdAt} reason={movement.reason}><p className={movement.quantityDelta > 0 ? "text-emerald-300" : "text-red-300"}>Existencia {movement.quantityDelta > 0 ? "+" : ""}{movement.quantityDelta}</p><details><summary className="min-h-11 cursor-pointer py-3">Referencia</summary><p>{movement.productId} {movement.referenceType} {movement.referenceId}</p></details></InventoryMovementCard>)}</div>          )}
        </SearchableList>
      </section>
    </div>
  );
}
