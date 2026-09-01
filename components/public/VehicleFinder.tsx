"use client";

import { useEffect, useMemo, useState } from "react";
import { useSiteContent } from "@/components/providers/SiteContentProvider";
import { ManagedImage } from "@/components/ui/ManagedImage";
import {
  getPublicVehicleBrands,
  getPublicVehicleCompatibilitiesByModel,
  getPublicVehicleModels,
  getPublicVehicleTypes,
  VEHICLE_TYPES,
  type VehicleBrand,
  type VehicleCompatibility,
  type VehicleModel,
} from "@/lib/supabase/vehicle-compatibility";
import type { Product } from "@/lib/site-data";

type Mode = "vehicle" | "connector" | "unknown";

function buildWhatsAppLink(baseWhatsapp: string, message: string): string {
  // El sitio guarda el enlace de WhatsApp ya armado (api.whatsapp.com/send?text=...).
  // Si no está configurado, se arma uno genérico con el mensaje indicado.
  if (baseWhatsapp && baseWhatsapp.includes("api.whatsapp.com")) return baseWhatsapp;
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
}

function CompatibleProducts({ products, connector }: { products: Product[]; connector: string }) {
  const matches = products.filter(
    (product) => product.active && product.connectorType?.trim().toLowerCase() === connector.trim().toLowerCase()
  );

  if (matches.length === 0) {
    return (
      <p className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-zinc-400">
        Todavía no tenemos productos cargados con el conector <strong className="text-white">{connector}</strong>.
        Consultanos por WhatsApp y te ayudamos a encontrarlo.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {matches.map((product) => (
        <a
          key={product.id}
          href={product.href}
          className="group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/3"
        >
          <div className="flex h-40 items-center justify-center overflow-hidden bg-zinc-950/60 p-3">
            <ManagedImage source={product.image} alt={product.name} className="max-h-full max-w-full object-contain transition duration-500 group-hover:scale-105" />
          </div>
          <div className="p-4">
            <h3 className="text-lg font-black uppercase tracking-[-0.04em] text-white">{product.name}</h3>
            <p className="mt-1 text-sm text-zinc-400 line-clamp-2">{product.description}</p>
            <span className="mt-3 inline-block text-xs font-bold uppercase tracking-[0.14em] text-red-400">Ver producto →</span>
          </div>
        </a>
      ))}
    </div>
  );
}

export function VehicleFinder() {
  const { content } = useSiteContent();
  const [mode, setMode] = useState<Mode>("vehicle");

  // Modo A: vehículo
  const [vehicleTypes, setVehicleTypes] = useState<string[]>([...VEHICLE_TYPES]);
  const [selectedType, setSelectedType] = useState("");
  const [brands, setBrands] = useState<VehicleBrand[]>([]);
  const [selectedBrand, setSelectedBrand] = useState("");
  const [models, setModels] = useState<VehicleModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [compatibilities, setCompatibilities] = useState<VehicleCompatibility[]>([]);
  const [year, setYear] = useState("");
  const [noDataForVehicles, setNoDataForVehicles] = useState(false);

  // Modo B: conector directo
  const [connectorQuery, setConnectorQuery] = useState("");
  const [connectorSearched, setConnectorSearched] = useState("");

  useEffect(() => {
    getPublicVehicleTypes().then((types) => {
      if (types && types.length > 0) setVehicleTypes(types);
      else setNoDataForVehicles(true);
    });
  }, []);

  useEffect(() => {
    setSelectedBrand("");
    setBrands([]);
    setModels([]);
    setSelectedModel("");
    setCompatibilities([]);
    if (!selectedType) return;
    getPublicVehicleBrands(selectedType).then((data) => setBrands(data ?? []));
  }, [selectedType]);

  useEffect(() => {
    setSelectedModel("");
    setModels([]);
    setCompatibilities([]);
    if (!selectedBrand) return;
    getPublicVehicleModels(selectedBrand, selectedType).then((data) => setModels(data ?? []));
  }, [selectedBrand, selectedType]);

  useEffect(() => {
    setCompatibilities([]);
    if (!selectedModel) return;
    getPublicVehicleCompatibilitiesByModel(selectedModel).then((data) => setCompatibilities(data ?? []));
  }, [selectedModel]);

  const matchingCompatibility = useMemo(() => {
    const yearNumber = Number(year);
    if (!Number.isFinite(yearNumber) || !year) return null;
    return (
      compatibilities.find(
        (compat) => yearNumber >= compat.yearFrom && (compat.yearTo === null || yearNumber <= compat.yearTo)
      ) ?? null
    );
  }, [compatibilities, year]);

  const vehicleConnectors = matchingCompatibility
    ? [matchingCompatibility.connectorLow, matchingCompatibility.connectorHigh, matchingCompatibility.connectorFog, matchingCompatibility.connectorAux].filter(
        (value): value is string => Boolean(value)
      )
    : [];

  const whatsappHref = buildWhatsAppLink(
    content.siteSettings.whatsapp,
    "Hola DCL Cree LED, no encuentro mi vehículo/conector en la web. ¿Me ayudan a elegir el LED correcto?"
  );

  const tabs: { id: Mode; label: string }[] = [
    { id: "vehicle", label: "Conozco mi vehículo" },
    { id: "connector", label: "Conozco el conector" },
    { id: "unknown", label: "No sé qué conector uso" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setMode(tab.id)}
            className={[
              "rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] transition",
              mode === tab.id
                ? "border-red-500/60 bg-red-600/15 text-red-200"
                : "border-white/10 bg-white/0 text-zinc-300 hover:border-red-500/30 hover:text-white",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mode === "vehicle" ? (
        <div className="rounded-[1.75rem] border border-white/10 bg-zinc-950/60 p-5 sm:p-6">
          {noDataForVehicles ? (
            <p className="mb-5 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-200">
              Todavía estamos cargando la base de vehículos compatibles. Mientras tanto, escribí tu conector directamente
              o consultanos por WhatsApp.
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm text-zinc-300">
              <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Tipo</span>
              <select
                value={selectedType}
                onChange={(event) => setSelectedType(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white"
              >
                <option value="">Seleccioná...</option>
                {vehicleTypes.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </label>

            <label className="block text-sm text-zinc-300">
              <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Marca</span>
              <select
                value={selectedBrand}
                onChange={(event) => setSelectedBrand(event.target.value)}
                disabled={!selectedType || brands.length === 0}
                className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white disabled:opacity-50"
              >
                <option value="">Seleccioná...</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>{brand.name}</option>
                ))}
              </select>
            </label>

            <label className="block text-sm text-zinc-300">
              <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Modelo</span>
              <select
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                disabled={!selectedBrand || models.length === 0}
                className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white disabled:opacity-50"
              >
                <option value="">Seleccioná...</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
            </label>

            <label className="block text-sm text-zinc-300">
              <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Año</span>
              <input
                type="number"
                placeholder="2020"
                value={year}
                onChange={(event) => setYear(event.target.value)}
                disabled={!selectedModel}
                className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white disabled:opacity-50"
              />
            </label>
          </div>

          <div className="mt-6">
            {selectedModel && year && !matchingCompatibility ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-zinc-300">
                <p className="font-semibold text-white">¿No encontrás tu vehículo o el año no coincide?</p>
                <p className="mt-1 text-zinc-400">Consultanos por WhatsApp y te confirmamos el conector correcto.</p>
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center justify-center rounded-full bg-red-600 px-5 py-2.5 text-xs font-bold uppercase tracking-[0.14em] text-white transition hover:bg-red-500"
                >
                  Consultar por WhatsApp
                </a>
              </div>
            ) : null}

            {matchingCompatibility ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-red-500/30 bg-red-600/10 p-4 text-sm text-red-100">
                  Encontramos la lámpara/conector de tu vehículo: <strong>{vehicleConnectors.join(" / ")}</strong>
                </div>
                <h3 className="text-lg font-black uppercase tracking-[-0.04em] text-white">Productos compatibles</h3>
                <div className="space-y-6">
                  {vehicleConnectors.map((connector) => (
                    <CompatibleProducts key={connector} products={content.products} connector={connector} />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {mode === "connector" ? (
        <div className="rounded-[1.75rem] border border-white/10 bg-zinc-950/60 p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={connectorQuery}
              onChange={(event) => setConnectorQuery(event.target.value)}
              placeholder="H1, H3, H4, H7, H11, HB3, HB4, 9005, 9006..."
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-white sm:max-w-xs"
            />
            <button
              type="button"
              onClick={() => setConnectorSearched(connectorQuery.trim())}
              className="rounded-full bg-red-600 px-6 py-2.5 text-xs font-bold uppercase tracking-[0.16em] text-white transition hover:bg-red-500"
            >
              Buscar
            </button>
          </div>

          {connectorSearched ? (
            <div className="mt-6">
              <h3 className="mb-4 text-lg font-black uppercase tracking-[-0.04em] text-white">
                Productos compatibles con {connectorSearched}
              </h3>
              <CompatibleProducts products={content.products} connector={connectorSearched} />
            </div>
          ) : null}
        </div>
      ) : null}

      {mode === "unknown" ? (
        <div className="rounded-[1.75rem] border border-white/10 bg-zinc-950/60 p-6 text-center sm:p-8">
          <p className="text-lg font-black uppercase tracking-[-0.03em] text-white">
            ¿No encontrás tu vehículo o no sabés qué lámpara usa?
          </p>
          <p className="mt-2 text-sm text-zinc-400">
            Contanos marca, modelo y año por WhatsApp y te confirmamos el conector correcto.
          </p>
          <a
            href={whatsappHref}
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex items-center justify-center rounded-full bg-red-600 px-6 py-3.5 text-sm font-bold uppercase tracking-[0.14em] text-white transition hover:bg-red-500"
          >
            Consultanos por WhatsApp
          </a>
        </div>
      ) : null}
    </div>
  );
}
