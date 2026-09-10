import type { Product } from "@/lib/site-data";
import type { VehicleCompatibilityFull } from "@/lib/supabase/vehicle-compatibility";
import { assessFitment } from "@/lib/store/fitment";

export const vehiclePositions = [
  { key: "low", label: "Baja" }, { key: "high", label: "Alta" },
  { key: "fog", label: "Antiniebla" }, { key: "aux", label: "Auxiliar" },
] as const;

// The existing fitment assessment owns position/connector/year rules.
export function vehicleProductMatches(products: Product[], rows: VehicleCompatibilityFull[], year: string, position = "") {
  if (!/^\d{4}$/.test(year)) return [];
  return rows.flatMap(row => vehiclePositions.filter(item => !position || item.key === position).flatMap(item =>
    products.filter(product => product.active && product.showInCatalog).flatMap(product => {
      const assessment = assessFitment(row, product.connectorType, item.key, year);
      return assessment.state === "confirmed" ? [{ product, row, position: item, connector: assessment.connector! }] : [];
    })));
}

export function vehicleReferenceLinks(context: { type?: string; brand?: string; model?: string; year?: string; position?: string }) {
  const vehicle = [context.type, context.brand, context.model, context.year].map(value => value?.trim()).filter(Boolean).join(" ");
  const position = vehiclePositions.find(item => item.key === context.position)?.label;
  const detail = `${vehicle || "mi vehículo"}${position ? ` para luz ${position.toLowerCase()}` : ""}`;
  return {
    google: `https://www.google.com/search?q=${encodeURIComponent(`qué tipo de lámpara conector lleva ${detail}`)}`,
    whatsappMessage: `Hola, necesito saber qué lámpara lleva ${detail}. ¿Me ayudan a confirmar la compatibilidad?`,
  };
}
