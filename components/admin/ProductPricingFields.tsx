"use client";

import { useEffect, useState } from "react";
import type { Product } from "@/lib/site-data";
import { calculateMarginPercentage, calculateSalePrice, parsePricingInput, priceFromSalesMargin, pricingProfit, validateProductMoney } from "@/lib/product-pricing";

export function ProductPricingFields({ product, onChange, onValidityChange }: { product: Product; onChange: (changes: Partial<Product>) => void; onValidityChange: (invalid: boolean) => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const invalidDraft = (key: string, raw: string) => {
    if (!raw.trim()) return false;
    const parsed = parsePricingInput(raw);
    if (parsed === undefined) return true;
    if (key.endsWith("salesMargin")) return parsed >= 100;
    if (key.endsWith("markup")) return parsed < -100 || (!key.startsWith("wholesale") && Math.abs(parsed) > 9999.99);
    try { validateProductMoney(parsed, "Importe", false, key === "wholesaleprice"); return false; } catch { return true; }
  };
  const invalid = Object.entries(drafts).some(([key, raw]) => invalidDraft(key, raw));
  useEffect(() => { onValidityChange(invalid); }, [invalid, onValidityChange]);
  const input = (key: string, label: string, value: number | null | undefined, change: (value: number | undefined) => void, percentage = false) => {
    const raw = drafts[key];
    const invalid = raw !== undefined && invalidDraft(key, raw);
    return <label className="block min-w-0 text-sm text-zinc-300"><span className="mb-2 block text-xs font-bold">{label}</span><input type="text" inputMode="decimal" value={raw ?? (value == null ? "" : String(value))} aria-invalid={invalid || undefined} onChange={event => {
      const text = event.target.value;
      const next = parsePricingInput(text);
      setDrafts(previous => ({ ...previous, [key]: text }));
      if (!text.trim()) change(undefined);
      else if (next !== undefined && !invalidDraft(key, text) && (percentage || next >= 0)) change(next);
    }} className="min-h-11 w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white" />{invalid && <span className="mt-1 block text-xs text-red-300">Valor inválido{key.endsWith("salesMargin") ? ": debe ser menor que 100%" : ""}.</span>}</label>;
  };
  const clearPercentages = () => setDrafts(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.endsWith("markup") && !key.endsWith("salesMargin"))));
  const tier = (wholesale: boolean) => {
    const prefix = wholesale ? "wholesale" : "retail";
    const price = wholesale ? product.wholesalePrice : product.price;
    const profit = pricingProfit(product.costPrice, price);
    const setPrice = (value: number | undefined) => {
      clearPercentages();
      onChange(wholesale ? { wholesalePrice: value ?? null } : { price: value ?? 0, marginPercentage: calculateMarginPercentage(product.costPrice, value ?? 0) });
    };
    const percent = (value: number | undefined, salesMargin: boolean) => {
      const next = value === undefined ? undefined : salesMargin ? priceFromSalesMargin(product.costPrice, value) : calculateSalePrice(product.costPrice, value);
      if (next !== undefined && next >= 0) {
        setDrafts(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith(prefix))));
        onChange(wholesale ? { wholesalePrice: next } : { price: next, marginPercentage: calculateMarginPercentage(product.costPrice, next) });
      } else if (!wholesale && !salesMargin) onChange({ marginPercentage: value });
    };
    return <div className="min-w-0 space-y-3 rounded-xl border border-white/10 p-3 sm:p-4"><h4 className="font-bold text-white">{wholesale ? "Mayorista (opcional)" : "Minorista"}</h4>
      {input(`${prefix}price`, wholesale ? "Precio mayorista" : "Precio de venta minorista", price, setPrice)}
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">{input(`${prefix}markup`, "Recargo sobre costo (%)", profit?.markup, value => percent(value, false), true)}{input(`${prefix}salesMargin`, "Margen sobre venta (%)", profit?.margin, value => percent(value, true), true)}</div>
      {profit ? <><p className="text-sm text-zinc-300">Ganancia: {new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(profit.gain)}</p>{profit.belowCost && <p role="status" className="text-sm font-bold text-amber-300">El precio está por debajo del costo.</p>}</> : <p className="text-xs text-zinc-400">{price == null ? "Sin precio mayorista: excluido del futuro catálogo mayorista." : "Ingresá un costo mayor que cero para calcular rentabilidad."}</p>}
    </div>;
  };
  return <section aria-labelledby="product-pricing-title" className="min-w-0 rounded-2xl border border-white/10 p-4"><h3 id="product-pricing-title" className="text-lg font-bold text-white">Precios y rentabilidad</h3><p className="mt-2 text-xs leading-5 text-zinc-400">Recargo = ganancia / costo. Margen = ganancia / precio de venta. Son cálculos brutos, sin gastos ni impuestos adicionales.</p>
    <div className="my-4 grid min-w-0 gap-4 sm:grid-cols-2">{input("cost", "Precio de costo", product.costPrice, costPrice => { clearPercentages(); onChange({ costPrice, marginPercentage: calculateMarginPercentage(costPrice, product.price) }); })}{input("previous", "Precio anterior", product.previousPrice, previousPrice => onChange({ previousPrice }))}</div>
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">{tier(false)}{tier(true)}</div>
  </section>;
}
