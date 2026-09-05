type Fitment = { yearFrom: number; yearTo: number | null; connectorLow: string | null; connectorHigh: string | null; connectorFog: string | null; connectorAux: string | null; combinedHighLow: boolean };
export function assessFitment(fitment: Fitment | null, productConnector: string | undefined, position: string | undefined, year: string | undefined) {
  if (!fitment || typeof position !== "string" || !position) return { state: "invalid" as const, connector: null };
  const connectors: Record<string, string | null> = { low: fitment.connectorLow, high: fitment.combinedHighLow ? fitment.connectorLow : fitment.connectorHigh, fog: fitment.connectorFog, aux: fitment.connectorAux };
  const connector = Object.hasOwn(connectors, position) ? connectors[position] : null;
  const normalize = (value: string) => value.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (!connector || !productConnector || normalize(connector) !== normalize(productConnector)) return { state: "invalid" as const, connector: null };
  if (!year) return { state: "missing_year" as const, connector };
  const selected = Number(year);
  if (typeof year !== "string" || !/^\d{4}$/.test(year) || selected < fitment.yearFrom || (fitment.yearTo !== null && selected > fitment.yearTo)) return { state: "out_of_range" as const, connector };
  return { state: "confirmed" as const, connector };
}
