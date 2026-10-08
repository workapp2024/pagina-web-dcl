/** Convierte importes argentinos (10.300,50) o decimales simples (74.76) a número. */
export function parsePricingInput(value: string): number | undefined {
  const raw = value.trim().replace(/\s/g, "");
  if (!raw || /[,.]$/.test(raw)) return undefined;

  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : /^-?\d{1,3}(\.\d{3})+$/.test(raw)
      ? raw.replace(/\./g, "")
      : raw;
  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateMarginPercentage(cost: number | undefined, salePrice: number | undefined): number | undefined {
  if (!cost || cost <= 0 || salePrice === undefined || !Number.isFinite(salePrice)) return undefined;
  return Math.round((((salePrice - cost) / cost) * 100 + Number.EPSILON) * 100) / 100;
}

export function calculateSalePrice(cost: number | undefined, marginPercentage: number | undefined): number | undefined {
  if (!cost || cost <= 0 || marginPercentage === undefined || !Number.isFinite(marginPercentage)) return undefined;
  return roundMoney(cost * (1 + marginPercentage / 100));
}

/** margin_percentage historically stores markup over cost, not margin over sales. */
export function pricingProfit(cost: number | undefined, price: number | null | undefined) {
  if (cost === undefined || !Number.isFinite(cost) || cost <= 0 || price == null || !Number.isFinite(price)) return null;
  return { gain: roundMoney(price - cost), markup: calculateMarginPercentage(cost, price)!, margin: price > 0 ? roundMoney((price - cost) / price * 100) : undefined, belowCost: price < cost };
}

export function priceFromSalesMargin(cost: number | undefined, percentage: number) {
  if (!cost || cost <= 0 || !Number.isFinite(percentage) || percentage >= 100) return undefined;
  return roundMoney(cost / (1 - percentage / 100));
}

export function validateProductMoney(value: unknown, label: string, optional = false, positive = false): number | null {
  if (optional && (value === undefined || value === null || value === "")) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (positive && value === 0) || value > 9999999999.99 || Math.abs(value * 100 - Math.round(value * 100)) > 0.0001) {
    throw new Error(`${label}: indicá un importe válido, con hasta dos decimales${positive ? " y mayor que cero" : ""}.`);
  }
  return value;
}
