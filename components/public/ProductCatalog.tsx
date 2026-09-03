"use client";

import { useEffect, useMemo, useState } from "react";
import { ProductCard } from "@/components/ui/ProductCard";
import { analyticsEvents, capture } from "@/lib/analytics";
import type { Product } from "@/lib/site-data";

export function ProductCatalog({ products, initialCategory }: { products: Product[]; initialCategory?: string }) {
  const categories = [...new Set(products.map(product => product.category))].sort();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(() => initialCategory && products.some(product => product.category === initialCategory) ? initialCategory : "all");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter(product =>
      (category === "all" || product.category === category) &&
      (!needle || [product.name, product.description, product.category, product.connectorType].some(value => String(value || "").toLowerCase().includes(needle)))
    );
  }, [products, query, category]);

  useEffect(() => {
    if (category !== "all") capture(analyticsEvents.categoryView, { category });
  }, [category]);

  useEffect(() => {
    if (!query.trim()) return;
    const timer = setTimeout(() => capture(analyticsEvents.catalogSearch, { query_length: query.trim().length, result_count: visible.length }), 600);
    return () => clearTimeout(timer);
  }, [query, visible.length]);

  return <>
    <div className="mb-7 grid gap-3 sm:grid-cols-[1fr_220px]">
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar producto, categoría o conector" className="min-h-12 rounded-xl border border-white/10 bg-zinc-950 px-4 text-white" />
      <select value={category} onChange={event => setCategory(event.target.value)} className="min-h-12 rounded-xl border border-white/10 bg-zinc-950 px-4 text-white">
        <option value="all">Todas las categorías</option>
        {categories.map(value => <option key={value}>{value}</option>)}
      </select>
    </div>
    {visible.length ? <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{visible.map(product => <ProductCard key={product.id} {...product} />)}</div> : <p className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-400">No encontramos productos para esa búsqueda.</p>}
  </>;
}
