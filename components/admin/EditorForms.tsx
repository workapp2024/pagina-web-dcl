"use client";

import { useEffect, useState } from "react";

import { useSiteContent } from "@/components/providers/SiteContentProvider";
import type {
  Product,
  Promotion,
  SiteSettings,
  VehicleCategory,
} from "@/lib/site-data";
import { ManagedImage } from "@/components/ui/ManagedImage";
import { validateImageFile, type StorageCategory } from "@/lib/supabase/storage";
import { getAdminSupabaseProducts, upsertSupabaseProduct } from "@/lib/supabase/products";
import { upsertSupabasePromotion } from "@/lib/supabase/promotions";
import { upsertSupabaseVehicleCategory } from "@/lib/supabase/vehicle-categories";
import { upsertSupabaseSiteSettings } from "@/lib/supabase/site-settings";
import { upsertSupabaseHomeSettings } from "@/lib/supabase/home-settings";
import {
  calculateMarginPercentage,
  calculateSalePrice,
  parsePricingInput,
} from "@/lib/product-pricing";

function slugifyProductName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type PricingDraft = Partial<Record<"cost" | "margin" | "price", string>>;

function SectionCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[1.75rem] border border-white/10 bg-zinc-950/80 p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="text-xl font-black uppercase tracking-[-0.05em] text-white">{title}</h2>
        <p className="mt-2 text-sm text-zinc-400">{description}</p>
      </div>
      {children}
    </section>
  );
}

function ImagePicker({
  source,
  label,
  storageKey,
  onChange,
  fit = "contain",
}: {
  source: string;
  label: string;
  storageKey: string;
  onChange: (source: string) => void;
  fit?: "contain" | "cover";
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const validation = validateImageFile(file);
    if (!validation.valid) {
      window.alert(validation.error || "Seleccioná una imagen válida de hasta 10 MB.");
      return;
    }

    setIsSaving(true);
    setUploadStatus("Subiendo a Supabase Storage...");

    const category: StorageCategory = storageKey.startsWith("product")
      ? "products"
      : storageKey.startsWith("promotion")
      ? "promotions"
      : storageKey.startsWith("vehicle")
      ? "vehicles"
      : storageKey.startsWith("hero")
      ? "hero"
      : "site";

    try {
      const body = new FormData();
      body.append("file", file);
      body.append("category", category);
      body.append("idHint", storageKey);

      const response = await fetch("/api/admin/upload", { method: "POST", body });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.ok || !data.publicUrl) {
        throw new Error(data.error || data.message || "No se pudo subir la imagen a Supabase Storage.");
      }

      onChange(data.publicUrl);
      setUploadStatus("✓ Subida a Supabase Storage exitosa");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error al subir la imagen.";
      setUploadStatus(message);
      window.alert(message);
    } finally {
      setIsSaving(false);
      setTimeout(() => setUploadStatus(null), 4000);
    }
  }

  return (
    <div>
      <div className="flex h-52 w-full items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/80 p-2">
        <ManagedImage
          source={source}
          alt={label}
          className={fit === "contain" ? "max-h-full max-w-full object-contain" : "h-full w-full object-cover object-center"}
        />
      </div>
      <label className="mt-3 inline-flex cursor-pointer rounded-full border border-red-500/50 bg-red-600/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-red-300 transition hover:bg-red-600/20">
        {isSaving ? (uploadStatus || "Guardando...") : label}
        <input type="file" accept="image/*" onChange={handleFileChange} disabled={isSaving} className="sr-only" />
      </label>
      {uploadStatus ? (
        <p className="mt-2 text-xs font-semibold text-red-300">{uploadStatus}</p>
      ) : (
        <p className="mt-2 text-xs text-zinc-500">
          Las imágenes se suben directamente al bucket de Supabase Storage.
        </p>
      )}
    </div>
  );
}

export function AdminProductsManager() {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [pricingDrafts, setPricingDrafts] = useState<Record<string, PricingDraft>>({});
  const [productStatuses, setProductStatuses] = useState<
    Record<string, { status: "saving" | "success" | "error"; message?: string }>
  >({});

  useEffect(() => {
    let isMounted = true;

    getAdminSupabaseProducts().then((result) => {
      if (!isMounted) return;
      if (result.success) {
        setProducts(result.products ?? []);
      } else {
        setLoadError(result.error || "No se pudieron cargar los productos administrativos.");
      }
      setIsLoadingProducts(false);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const saveProductToSupabase = async (productToSave: Product): Promise<boolean> => {
    setProductStatuses((prev) => ({
      ...prev,
      [productToSave.id]: { status: "saving", message: "Guardando en Supabase..." },
    }));

    const result = await upsertSupabaseProduct(productToSave);

    if (result.success) {
      setProductStatuses((prev) => ({
        ...prev,
        [productToSave.id]: { status: "success", message: "✓ Guardado en Supabase" },
      }));
      setTimeout(() => {
        setProductStatuses((prev) => {
          const next = { ...prev };
          delete next[productToSave.id];
          return next;
        });
      }, 4000);
      return true;
    } else {
      setProductStatuses((prev) => ({
        ...prev,
        [productToSave.id]: { status: "error", message: result.error || "Error al guardar en Supabase" },
      }));
      return false;
    }
  };

  const updateProduct = (productId: string, changes: Partial<Product>) => {
    setProducts((previous) =>
      previous.map((product) =>
        product.id === productId ? { ...product, ...changes } : product,
      ),
    );
  };

  const updatePricingDraft = (productId: string, field: keyof PricingDraft, value: string) => {
    setPricingDrafts((previous) => ({
      ...previous,
      [productId]: { ...previous[productId], [field]: value },
    }));
  };

  const updateCost = (product: Product, rawValue: string) => {
    updatePricingDraft(product.id, "cost", rawValue);
    const cost = parsePricingInput(rawValue);
    if (cost === undefined || cost <= 0) {
      updateProduct(product.id, { costPrice: cost, marginPercentage: undefined });
      updatePricingDraft(product.id, "margin", "");
      return;
    }

    const margin = calculateMarginPercentage(cost, product.price);
    updateProduct(product.id, { costPrice: cost, marginPercentage: margin });
    updatePricingDraft(product.id, "margin", margin === undefined ? "" : String(margin));
  };

  const updateSalePrice = (product: Product, rawValue: string) => {
    updatePricingDraft(product.id, "price", rawValue);
    const salePrice = parsePricingInput(rawValue);
    if (salePrice === undefined) {
      if (!rawValue.trim()) updateProduct(product.id, { price: 0 });
      return;
    }

    const margin = calculateMarginPercentage(product.costPrice, salePrice);
    updateProduct(product.id, { price: salePrice, marginPercentage: margin });
    if (margin !== undefined) updatePricingDraft(product.id, "margin", String(margin));
  };

  const updateMargin = (product: Product, rawValue: string) => {
    updatePricingDraft(product.id, "margin", rawValue);
    const margin = parsePricingInput(rawValue);
    if (margin === undefined) {
      if (!rawValue.trim()) updateProduct(product.id, { marginPercentage: undefined });
      return;
    }

    const salePrice = calculateSalePrice(product.costPrice, margin);
    updateProduct(product.id, {
      marginPercentage: margin,
      ...(salePrice === undefined ? {} : { price: salePrice }),
    });
    if (salePrice !== undefined) updatePricingDraft(product.id, "price", String(salePrice));
  };

  const addProduct = async () => {
    const timestamp = Date.now();
    const productName = "Nuevo producto";
    const slug = `${slugifyProductName(productName) || "producto"}-${timestamp}`;

    const nextProduct: Product = {
      id: `producto-${timestamp}`,
      name: productName,
      description: "Descripción del producto.",
      price: 0,
      previousPrice: undefined,
      image: "https://images.unsplash.com/photo-1511919884226-fd3cad34687c?auto=format&fit=crop&w=900&q=80",
      images: [],
      category: "General",
      featured: false,
      active: true,
      order: products.length + 1,
      href: `/productos/${slug}`,
      ctaText: "VER PRODUCTO",
    };

    setProducts((previous) => [...previous, nextProduct]);

    await saveProductToSupabase(nextProduct);
  };

  const removeProduct = async (product: Product) => {
    // Desactivación segura en Supabase (sin DELETE físico)
    const saved = await saveProductToSupabase({ ...product, active: false });
    if (!saved) return;

    // Remover del estado local para la vista
    setProducts((previous) => previous.filter((item) => item.id !== product.id));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-[-0.06em] text-white">Productos</h1>
          <p className="mt-2 text-sm text-zinc-400">Administrá precios, imágenes, categorías y estado de cada producto.</p>
        </div>
        <button
          type="button"
          onClick={addProduct}
          disabled={isLoadingProducts}
          className="rounded-full bg-red-600 px-5 py-2.5 text-xs font-bold uppercase tracking-[0.16em] text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          + Agregar producto
        </button>
      </div>

      {loadError ? (
        <p className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{loadError}</p>
      ) : null}

      {isLoadingProducts ? <p className="text-sm text-zinc-400">Cargando productos administrativos...</p> : null}

      {products.map((product) => {
        const statusInfo = productStatuses[product.id];

        return (
          <SectionCard key={product.id} title={product.name} description="Actualizá los datos visibles en la web pública.">
            <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
              <div>
                <ImagePicker
                  source={product.image}
                  label="Cambiar imagen"
                  storageKey={`product-${product.id}`}
                  onChange={(image) => {
                    updateProduct(product.id, { image });
                    saveProductToSupabase({ ...product, image });
                  }}
                />
                <div className="mt-3 text-xs uppercase tracking-[0.18em] text-zinc-400">Imagen Principal</div>
              </div>

              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block text-sm text-zinc-300">
                    <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Nombre</span>
                    <input
                      value={product.name}
                      onChange={(event) => updateProduct(product.id, { name: event.target.value })}
                      className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
                    />
                  </label>

                  <label className="block text-sm text-zinc-300">
                    <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Texto del botón</span>
                    <input value={product.ctaText} onChange={(event) => updateProduct(product.id, { ctaText: event.target.value })} className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white" />
                  </label>

                  <label className="block text-sm text-zinc-300">
                    <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Categoría</span>
                    <input
                      value={product.category}
                      onChange={(event) => updateProduct(product.id, { category: event.target.value })}
                      className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
                    />
                  </label>
                </div>

                <label className="block text-sm text-zinc-300">
                  <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Descripción</span>
                  <textarea
                    rows={4}
                    value={product.description}
                    onChange={(event) => updateProduct(product.id, { description: event.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
                  />
                </label>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block text-sm text-zinc-300">
                    <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Precio de venta</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={pricingDrafts[product.id]?.price ?? String(product.price)}
                      onChange={(event) => updateSalePrice(product, event.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
                    />
                    <span className="mt-1 block text-[11px] text-zinc-500">Podés modificar el precio de venta o el margen. El otro valor se calcula automáticamente según el costo.</span>
                  </label>

                  <label className="block text-sm text-zinc-300">
                    <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Precio anterior</span>
                    <input
                      type="number"
                      value={product.previousPrice ?? ""}
                      onChange={(event) =>
                        updateProduct(product.id, {
                          previousPrice: event.target.value === "" ? undefined : Number(event.target.value),
                        })
                      }
                      className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-4 text-sm text-zinc-300">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={product.featured}
                      onChange={(event) => updateProduct(product.id, { featured: event.target.checked })}
                    />
                    Destacado
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={product.active}
                      onChange={(event) => updateProduct(product.id, { active: event.target.checked })}
                    />
                    Activo
                  </label>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
                    Especificaciones técnicas (ficha del producto y buscador de LED)
                  </p>
                  <div className="grid gap-4 md:grid-cols-3">
                    <label className="block text-sm text-zinc-300">
                      <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Conector</span>
                      <input
                        placeholder="H4, H7, H11..."
                        value={product.connectorType ?? ""}
                        onChange={(event) => updateProduct(product.id, { connectorType: event.target.value })}
                        className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
                      />
                      <span className="mt-1 block text-[11px] text-zinc-500">Usá el mismo código que en Compatibilidades.</span>
                    </label>

                    <label className="block text-sm text-zinc-300">
                      <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Potencia (W)</span>
                      <input
                        type="number"
                        value={product.watts ?? ""}
                        onChange={(event) => updateProduct(product.id, { watts: event.target.value === "" ? undefined : Number(event.target.value) })}
                        className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
                      />
                    </label>

                    <label className="block text-sm text-zinc-300">
                      <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Lúmenes</span>
                      <input
                        type="number"
                        value={product.lumens ?? ""}
                        onChange={(event) => updateProduct(product.id, { lumens: event.target.value === "" ? undefined : Number(event.target.value) })}
                        className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
                      />
                    </label>

                    <label className="block text-sm text-zinc-300">
                      <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Voltaje</span>
                      <input
                        placeholder="12V-24V"
                        value={product.voltage ?? ""}
                        onChange={(event) => updateProduct(product.id, { voltage: event.target.value })}
                        className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
                      />
                    </label>

                    <label className="block text-sm text-zinc-300">
                      <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Temperatura de color</span>
                      <input
                        placeholder="6000K"
                        value={product.colorTemperature ?? ""}
                        onChange={(event) => updateProduct(product.id, { colorTemperature: event.target.value })}
                        className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
                      />
                    </label>

                    <label className="block text-sm text-zinc-300">
                      <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Chip</span>
                      <input
                        placeholder="CREE XHP50"
                        value={product.chipType ?? ""}
                        onChange={(event) => updateProduct(product.id, { chipType: event.target.value })}
                        className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
                      />
                    </label>

                    <label className="block text-sm text-zinc-300">
                      <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Garantía</span>
                      <input
                        placeholder="12 meses"
                        value={product.warranty ?? ""}
                        onChange={(event) => updateProduct(product.id, { warranty: event.target.value })}
                        className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
                      />
                    </label>

                    <label className="inline-flex items-center gap-2 self-end pb-2.5 text-sm text-zinc-300">
                      <input
                        type="checkbox"
                        checked={product.canbus ?? true}
                        onChange={(event) => updateProduct(product.id, { canbus: event.target.checked })}
                      />
                      Canbus
                    </label>
                  </div>
                </div>

                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-200">
                    Gestión privada
                  </p>
                  <p className="mb-3 text-xs text-zinc-400">
                    Estos datos sólo se cargan desde el panel administrativo y no forman parte del catálogo público. El stock se modifica desde Inventario para conservar su historial.
                  </p>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <label className="block text-sm text-zinc-300">
                      <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Costo</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={pricingDrafts[product.id]?.cost ?? (product.costPrice === undefined ? "" : String(product.costPrice))}
                        onChange={(event) => updateCost(product, event.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
                      />
                    </label>

                    <label className="block text-sm text-zinc-300">
                      <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Margen (%)</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={pricingDrafts[product.id]?.margin ?? (product.marginPercentage === undefined ? "" : String(product.marginPercentage))}
                        onChange={(event) => updateMargin(product, event.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
                      />
                      <span className="mt-1 block text-[11px] text-zinc-500">Acepta decimales con coma, por ejemplo 74,76.</span>
                    </label>

                    <label className="block text-sm text-zinc-300">
                      <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Stock actual</span>
                      <input
                        type="number"
                        value={product.stock ?? 0}
                        readOnly
                        aria-label="Stock actual, administrado desde Inventario"
                        className="w-full cursor-not-allowed rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-zinc-400"
                      />
                    </label>

                    <label className="block text-sm text-zinc-300">
                      <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Stock mínimo</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={product.stockMin ?? 0}
                        onChange={(event) => updateProduct(product.id, { stockMin: event.target.value === "" ? 0 : Number(event.target.value) })}
                        className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
                      />
                    </label>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => saveProductToSupabase(product)}
                      disabled={statusInfo?.status === "saving"}
                      className="rounded-full bg-red-600 px-5 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white transition hover:bg-red-500 disabled:opacity-50"
                    >
                      {statusInfo?.status === "saving" ? "Guardando..." : "Guardar en Supabase"}
                    </button>
                    {statusInfo?.message ? (
                      <span
                        className={[
                          "text-xs font-medium",
                          statusInfo.status === "error" ? "text-red-400" : "text-green-400",
                        ].join(" ")}
                      >
                        {statusInfo.message}
                      </span>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => removeProduct(product)}
                    className="rounded-full border border-red-500/40 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-red-300 hover:bg-red-600/10"
                  >
                    Eliminar producto
                  </button>
                </div>
              </div>
            </div>
          </SectionCard>
        );
      })}
    </div>
  );
}

export function AdminPromotionsManager() {
  const { content, setContent } = useSiteContent();
  const [promotionStatuses, setPromotionStatuses] = useState<
    Record<string, { status: "saving" | "success" | "error"; message?: string }>
  >({});

  const savePromotionToSupabase = async (promotionToSave: Promotion) => {
    setPromotionStatuses((prev) => ({
      ...prev,
      [promotionToSave.id]: { status: "saving", message: "Guardando en Supabase..." },
    }));

    const result = await upsertSupabasePromotion(promotionToSave);

    if (result.success) {
      setPromotionStatuses((prev) => ({
        ...prev,
        [promotionToSave.id]: { status: "success", message: "✓ Guardado en Supabase" },
      }));
      setTimeout(() => {
        setPromotionStatuses((prev) => {
          const next = { ...prev };
          delete next[promotionToSave.id];
          return next;
        });
      }, 4000);
    } else {
      setPromotionStatuses((prev) => ({
        ...prev,
        [promotionToSave.id]: { status: "error", message: result.error || "Error al guardar en Supabase" },
      }));
    }
  };

  const updatePromotion = (promotionId: string, changes: Partial<Promotion>) => {
    setContent((previous) => ({
      ...previous,
      promotions: previous.promotions.map((promotion) =>
        promotion.id === promotionId ? { ...promotion, ...changes } : promotion,
      ),
    }));
  };

  const addPromotion = async () => {
    const nextPromotion: Promotion = {
      id: `promo-${Date.now()}`,
      title: "Nueva promoción",
      description: "Descripción de la oferta.",
      image: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=900&q=80",
      ctaText: "APROVECHAR PROMO",
      ctaHref: "#contacto",
      price: undefined,
      startDate: undefined,
      endDate: undefined,
      active: true,
      order: content.promotions.length + 1,
    };

    setContent((previous) => ({
      ...previous,
      promotions: [...previous.promotions, nextPromotion],
    }));

    await savePromotionToSupabase(nextPromotion);
  };

  const removePromotion = async (promotion: Promotion) => {
    // Desactivación segura en Supabase (SOFT DELETE)
    await savePromotionToSupabase({ ...promotion, active: false });

    // Remover del estado local para la vista
    setContent((previous) => ({
      ...previous,
      promotions: previous.promotions.filter((item) => item.id !== promotion.id),
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-[-0.06em] text-white">Promociones</h1>
          <p className="mt-2 text-sm text-zinc-400">Subí flyers, textos y enlaces de CTA para que la home publique promociones dinámicas.</p>
        </div>
        <button
          type="button"
          onClick={addPromotion}
          className="rounded-full bg-red-600 px-5 py-2.5 text-xs font-bold uppercase tracking-[0.16em] text-white transition hover:bg-red-500"
        >
          + Agregar promoción
        </button>
      </div>

      {content.promotions.map((promotion) => {
        const statusInfo = promotionStatuses[promotion.id];

        return (
          <SectionCard key={promotion.id} title={promotion.title} description="Actualizá campaña, flyer y estado.">
            <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
              <div>
                <ImagePicker
                  source={promotion.image}
                  label="Cambiar flyer"
                  storageKey={`promotion-${promotion.id}`}
                  onChange={(image) => {
                    updatePromotion(promotion.id, { image });
                    savePromotionToSupabase({ ...promotion, image });
                  }}
                />
              </div>

              <div className="space-y-4">
                <label className="block text-sm text-zinc-300">
                  <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Título</span>
                  <input
                    value={promotion.title}
                    onChange={(event) => updatePromotion(promotion.id, { title: event.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
                  />
                </label>

                <label className="block text-sm text-zinc-300">
                  <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Descripción</span>
                  <textarea
                    rows={3}
                    value={promotion.description}
                    onChange={(event) => updatePromotion(promotion.id, { description: event.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
                  />
                </label>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block text-sm text-zinc-300">
                    <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Texto del botón</span>
                    <input
                      value={promotion.ctaText}
                      onChange={(event) => updatePromotion(promotion.id, { ctaText: event.target.value })}
                      className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
                    />
                  </label>

                  <label className="block text-sm text-zinc-300">
                    <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Enlace</span>
                    <input
                      value={promotion.ctaHref}
                      onChange={(event) => updatePromotion(promotion.id, { ctaHref: event.target.value })}
                      className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
                    />
                  </label>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <label className="block text-sm text-zinc-300">
                    <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Precio</span>
                    <input
                      value={promotion.price ?? ""}
                      onChange={(event) => updatePromotion(promotion.id, { price: event.target.value || undefined })}
                      className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
                    />
                  </label>

                  <label className="block text-sm text-zinc-300">
                    <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Inicio</span>
                    <input
                      type="date"
                      value={promotion.startDate ?? ""}
                      onChange={(event) => updatePromotion(promotion.id, { startDate: event.target.value || undefined })}
                      className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
                    />
                  </label>

                  <label className="block text-sm text-zinc-300">
                    <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Fin</span>
                    <input
                      type="date"
                      value={promotion.endDate ?? ""}
                      onChange={(event) => updatePromotion(promotion.id, { endDate: event.target.value || undefined })}
                      className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
                    />
                  </label>
                </div>

                <label className="inline-flex items-center gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={promotion.active}
                    onChange={(event) => updatePromotion(promotion.id, { active: event.target.checked })}
                  />
                  Promoción activa
                </label>

                <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => savePromotionToSupabase(promotion)}
                      disabled={statusInfo?.status === "saving"}
                      className="rounded-full bg-red-600 px-5 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white transition hover:bg-red-500 disabled:opacity-50"
                    >
                      {statusInfo?.status === "saving" ? "Guardando..." : "Guardar en Supabase"}
                    </button>
                    {statusInfo?.message ? (
                      <span
                        className={[
                          "text-xs font-medium",
                          statusInfo.status === "error" ? "text-red-400" : "text-green-400",
                        ].join(" ")}
                      >
                        {statusInfo.message}
                      </span>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => removePromotion(promotion)}
                    className="rounded-full border border-red-500/40 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-red-300 hover:bg-red-600/10"
                  >
                    Eliminar promoción
                  </button>
                </div>
              </div>
            </div>
          </SectionCard>
        );
      })}
    </div>
  );
}

export function AdminVehicleManager() {
  const { content, setContent } = useSiteContent();
  const [vehicleStatuses, setVehicleStatuses] = useState<
    Record<string, { status: "saving" | "success" | "error"; message?: string }>
  >({});

  const saveVehicleToSupabase = async (vehicleToSave: VehicleCategory) => {
    setVehicleStatuses((prev) => ({
      ...prev,
      [vehicleToSave.id]: { status: "saving", message: "Guardando en Supabase..." },
    }));

    const result = await upsertSupabaseVehicleCategory(vehicleToSave);

    if (result.success) {
      setVehicleStatuses((prev) => ({
        ...prev,
        [vehicleToSave.id]: { status: "success", message: "✓ Guardado en Supabase" },
      }));
      setTimeout(() => {
        setVehicleStatuses((prev) => {
          const next = { ...prev };
          delete next[vehicleToSave.id];
          return next;
        });
      }, 4000);
    } else {
      setVehicleStatuses((prev) => ({
        ...prev,
        [vehicleToSave.id]: { status: "error", message: result.error || "Error al guardar en Supabase" },
      }));
    }
  };

  const updateVehicle = (vehicleId: string, changes: Partial<VehicleCategory>) => {
    setContent((previous) => ({
      ...previous,
      vehicleCategories: previous.vehicleCategories.map((vehicle) =>
        vehicle.id === vehicleId ? { ...vehicle, ...changes } : vehicle,
      ),
    }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black uppercase tracking-[-0.06em] text-white">Vehículos</h1>
        <p className="mt-2 text-sm text-zinc-400">Actualizá la imagen y el texto de cada categoría para que la Home muestre el vehículo correcto.</p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {content.vehicleCategories.map((vehicle) => {
          const statusInfo = vehicleStatuses[vehicle.id];

          return (
            <SectionCard key={vehicle.id} title={vehicle.title} description="Categoría del selector de vehículos.">
              <ImagePicker
                source={vehicle.image}
                label="Cambiar imagen"
                storageKey={`vehicle-${vehicle.id}`}
                fit="contain"
                onChange={(image) => {
                  updateVehicle(vehicle.id, { image });
                  saveVehicleToSupabase({ ...vehicle, image });
                }}
              />
              <div className="mt-4 space-y-4">
                <label className="block text-sm text-zinc-300">
                  <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Título</span>
                  <input
                    value={vehicle.title}
                    onChange={(event) => updateVehicle(vehicle.id, { title: event.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
                  />
                </label>

                <label className="block text-sm text-zinc-300">
                  <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Descripción</span>
                  <textarea rows={2} value={vehicle.description} onChange={(event) => updateVehicle(vehicle.id, { description: event.target.value })} className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white" />
                </label>

                <label className="inline-flex items-center gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={vehicle.active}
                    onChange={(event) => updateVehicle(vehicle.id, { active: event.target.checked })}
                  />
                  Visible en la home
                </label>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => saveVehicleToSupabase(vehicle)}
                    disabled={statusInfo?.status === "saving"}
                    className="rounded-full bg-red-600 px-5 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white transition hover:bg-red-500 disabled:opacity-50"
                  >
                    {statusInfo?.status === "saving" ? "Guardando..." : "Guardar en Supabase"}
                  </button>
                  {statusInfo?.message ? (
                    <span
                      className={[
                        "text-xs font-medium",
                        statusInfo.status === "error" ? "text-red-400" : "text-green-400",
                      ].join(" ")}
                    >
                      {statusInfo.message}
                    </span>
                  ) : null}
                </div>
              </div>
            </SectionCard>
          );
        })}
      </div>
    </div>
  );
}

export function AdminHomeEditor() {
  const { content, setContent } = useSiteContent();
  const [saveStatus, setSaveStatus] = useState<{ status: "saving" | "success" | "error"; message?: string } | null>(null);

  const saveHomeToSupabase = async (customSettings?: SiteSettings) => {
    const settingsToSave = customSettings || content.siteSettings;
    setSaveStatus({ status: "saving", message: "Guardando en Supabase..." });

    const [homeRes, siteRes] = await Promise.all([
      upsertSupabaseHomeSettings(settingsToSave),
      upsertSupabaseSiteSettings(settingsToSave),
    ]);

    if (homeRes.success && siteRes.success) {
      setSaveStatus({ status: "success", message: "✓ Guardado en Supabase" });
      setTimeout(() => setSaveStatus(null), 4000);
    } else {
      const err = homeRes.error || siteRes.error || "Error al guardar en Supabase";
      setSaveStatus({ status: "error", message: err });
    }
  };

  const updateSettings = (changes: Partial<SiteSettings>) => {
    setContent((previous) => ({
      ...previous,
      siteSettings: { ...previous.siteSettings, ...changes },
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-[-0.06em] text-white">Home</h1>
          <p className="mt-2 text-sm text-zinc-400">Configurá los textos principales, CTA y la imagen de fondo de la portada.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => saveHomeToSupabase()}
            disabled={saveStatus?.status === "saving"}
            className="rounded-full bg-red-600 px-5 py-2.5 text-xs font-bold uppercase tracking-[0.16em] text-white transition hover:bg-red-500 disabled:opacity-50"
          >
            {saveStatus?.status === "saving" ? "Guardando..." : "Guardar en Supabase"}
          </button>
          {saveStatus?.message ? (
            <span
              className={[
                "text-xs font-medium",
                saveStatus.status === "error" ? "text-red-400" : "text-green-400",
              ].join(" ")}
            >
              {saveStatus.message}
            </span>
          ) : null}
        </div>
      </div>

      <SectionCard title="Imagen de fondo principal" description="Seleccioná la imagen de fondo que se muestra en la portada del Hero ('ILUMINÁ MEJOR. CONDUCÍ MEJOR.').">
        <ImagePicker
          source={content.siteSettings.heroImage}
          label="Seleccionar imagen de fondo"
          storageKey="hero-background"
          fit="cover"
          onChange={(heroImage) => {
            updateSettings({ heroImage });
            saveHomeToSupabase({ ...content.siteSettings, heroImage });
          }}
        />
      </SectionCard>

      <SectionCard title="Logo de la marca" description="Logo de DCL Cree LED utilizado en el Header y en el panel del Hero. Al reemplazarlo se actualiza en todas sus apariciones.">
        <ImagePicker
          source={content.siteSettings.logo}
          label="Seleccionar logo"
          storageKey="site-logo"
          fit="contain"
          onChange={(logo) => {
            updateSettings({ logo });
            saveHomeToSupabase({ ...content.siteSettings, logo });
          }}
        />
      </SectionCard>

      <SectionCard title="Contenido principal" description="Texto visible en el hero y en la parte comercial principal.">
        <div className="space-y-4">
          <label className="block text-sm text-zinc-300">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Título</span>
            <input
              value={content.siteSettings.heroTitle}
              onChange={(event) =>
                setContent((previous) => ({
                  ...previous,
                  siteSettings: { ...previous.siteSettings, heroTitle: event.target.value },
                }))
              }
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
            />
          </label>

          <label className="block text-sm text-zinc-300">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Subtítulo</span>
            <textarea
              rows={3}
              value={content.siteSettings.heroSubtitle}
              onChange={(event) =>
                setContent((previous) => ({
                  ...previous,
                  siteSettings: { ...previous.siteSettings, heroSubtitle: event.target.value },
                }))
              }
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm text-zinc-300">
              <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">CTA principal</span>
              <input
                value={content.siteSettings.heroPrimaryCta}
                onChange={(event) =>
                  setContent((previous) => ({
                    ...previous,
                    siteSettings: { ...previous.siteSettings, heroPrimaryCta: event.target.value },
                  }))
                }
                className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
              />
            </label>

            <label className="block text-sm text-zinc-300">
              <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">CTA secundario</span>
              <input
                value={content.siteSettings.heroSecondaryCta}
                onChange={(event) =>
                  setContent((previous) => ({
                    ...previous,
                    siteSettings: { ...previous.siteSettings, heroSecondaryCta: event.target.value },
                  }))
                }
                className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
              />
            </label>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Títulos de secciones" description="Estos textos conservan los valores actuales y se pueden editar para la Home.">
        <div className="grid gap-4 md:grid-cols-2">
          {([
            ["vehicleSectionTitle", "Vehículos"],
            ["needsSectionTitle", "Necesidades"],
            ["productsSectionTitle", "Productos"],
            ["promotionsSectionTitle", "Promociones"],
            ["whyUsSectionTitle", "Por qué DCL"],
          ] as const).map(([key, label]) => (
            <label key={key} className="block text-sm text-zinc-300">
              <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">{label}</span>
              <input value={content.siteSettings[key]} onChange={(event) => updateSettings({ [key]: event.target.value })} className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white" />
            </label>
          ))}
        </div>
      </SectionCard>

      <div className="flex justify-end pt-4">
        <button
          type="button"
          onClick={() => saveHomeToSupabase()}
          disabled={saveStatus?.status === "saving"}
          className="rounded-full bg-red-600 px-6 py-3 text-xs font-bold uppercase tracking-[0.16em] text-white transition hover:bg-red-500 disabled:opacity-50"
        >
          {saveStatus?.status === "saving" ? "Guardando..." : "Guardar todos los cambios en Supabase"}
        </button>
      </div>
    </div>
  );
}

export function AdminSiteSettingsForm() {
  const { content, setContent } = useSiteContent();
  const [saveStatus, setSaveStatus] = useState<{ status: "saving" | "success" | "error"; message?: string } | null>(null);

  const saveSiteSettingsToSupabase = async (customSettings?: SiteSettings) => {
    const settingsToSave = customSettings || content.siteSettings;
    setSaveStatus({ status: "saving", message: "Guardando en Supabase..." });

    const result = await upsertSupabaseSiteSettings(settingsToSave);

    if (result.success) {
      setSaveStatus({ status: "success", message: "✓ Guardado en Supabase" });
      setTimeout(() => setSaveStatus(null), 4000);
    } else {
      setSaveStatus({ status: "error", message: result.error || "Error al guardar en Supabase" });
    }
  };

  const updateSettings = (changes: Partial<SiteSettings>) => {
    setContent((previous) => ({
      ...previous,
      siteSettings: { ...previous.siteSettings, ...changes },
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-[-0.06em] text-white">Configuración</h1>
          <p className="mt-2 text-sm text-zinc-400">Centraliá los datos de contacto, redes sociales y branding principal.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => saveSiteSettingsToSupabase()}
            disabled={saveStatus?.status === "saving"}
            className="rounded-full bg-red-600 px-5 py-2.5 text-xs font-bold uppercase tracking-[0.16em] text-white transition hover:bg-red-500 disabled:opacity-50"
          >
            {saveStatus?.status === "saving" ? "Guardando..." : "Guardar en Supabase"}
          </button>
          {saveStatus?.message ? (
            <span
              className={[
                "text-xs font-medium",
                saveStatus.status === "error" ? "text-red-400" : "text-green-400",
              ].join(" ")}
            >
              {saveStatus.message}
            </span>
          ) : null}
        </div>
      </div>

      <SectionCard title="Branding" description="Logo y enlaces de marca.">
        <div className="space-y-4">
          <label className="block text-sm text-zinc-300">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Logo</span>
            <input
              value={content.siteSettings.logo}
              onChange={(event) => updateSettings({ logo: event.target.value })}
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm text-zinc-300">
              <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">WhatsApp</span>
              <input value={content.siteSettings.whatsapp} onChange={(event) => updateSettings({ whatsapp: event.target.value })} className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white" />
            </label>
            <label className="block text-sm text-zinc-300">
              <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Email</span>
              <input value={content.siteSettings.email} onChange={(event) => updateSettings({ email: event.target.value })} className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white" />
            </label>
            <label className="block text-sm text-zinc-300">
              <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Instagram</span>
              <input value={content.siteSettings.instagram} onChange={(event) => updateSettings({ instagram: event.target.value })} className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white" />
            </label>
            <label className="block text-sm text-zinc-300">
              <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Facebook</span>
              <input value={content.siteSettings.facebook} onChange={(event) => updateSettings({ facebook: event.target.value })} className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white" />
            </label>
            <label className="block text-sm text-zinc-300 md:col-span-2">
              <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Teléfono</span>
              <input value={content.siteSettings.phone} onChange={(event) => updateSettings({ phone: event.target.value })} className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white" />
            </label>
            <label className="block text-sm text-zinc-300 md:col-span-2">
              <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Dirección</span>
              <input value={content.siteSettings.address} onChange={(event) => updateSettings({ address: event.target.value })} className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white" />
            </label>
          </div>
        </div>
      </SectionCard>

      <div className="flex justify-end pt-4">
        <button
          type="button"
          onClick={() => saveSiteSettingsToSupabase()}
          disabled={saveStatus?.status === "saving"}
          className="rounded-full bg-red-600 px-6 py-3 text-xs font-bold uppercase tracking-[0.16em] text-white transition hover:bg-red-500 disabled:opacity-50"
        >
          {saveStatus?.status === "saving" ? "Guardando..." : "Guardar en Supabase"}
        </button>
      </div>
    </div>
  );
}
