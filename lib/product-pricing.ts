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
