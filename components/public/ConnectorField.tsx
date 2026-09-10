import type { Product } from "@/lib/site-data";

export function ConnectorField({ products, id, label = "Conector (si lo conocés)", defaultValue = "", required = false }: { products: Product[]; id: string; label?: string; defaultValue?: string; required?: boolean }) {
  return <label className="block min-w-0 text-sm text-zinc-300">{label}
    <input name="conector" type="search" list={id} defaultValue={defaultValue} required={required} placeholder="H1, H4, H7, H11, 9005…" maxLength={30} className="mt-2 min-h-12 w-full min-w-0 rounded-xl border border-white/15 bg-zinc-950 px-3 text-base text-white" />
    <datalist id={id}>{[...new Set(products.map(product => product.connectorType).filter(Boolean))].sort().map(connector => <option key={connector} value={connector} />)}</datalist>
  </label>;
}
