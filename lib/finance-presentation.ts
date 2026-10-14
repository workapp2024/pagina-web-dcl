export type CurrencyAmount = { currency: string; amount: number };
export type FinanceMovement = { id: string; source?: string; movement_type: string; sale_id?: string | null; amount: number; currency?: string; description: string; occurred_at: string };
export type FinancePresentationData = {
  activated: boolean; totalAvailable?: number; salesTotal?: number; realizedProfit?: number; retailCostsComplete?: boolean;
  accounts: { id: string; name: string; balance: number }[];
  periods: { id: string; name: string; status: string }[];
  selectedPeriod?: { id: string; name: string };
  movements?: FinanceMovement[];
  wholesale?: { available: boolean; recognizedNet?: CurrencyAmount[]; received?: CurrencyAmount[]; refunds?: CurrencyAmount[];
    receivables?: { order_number: string; customer_name: string; currency: string; amount: number }[];
    pendingFinancialEntries?: { id: string; order_number: string; amount: number; currency: string; entry_type: string; status: string }[] };
};

export function sumByCurrency(rows: CurrencyAmount[]) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (!row.currency?.trim() || !Number.isFinite(Number(row.amount))) return null;
    const currency = row.currency.trim();
    totals.set(currency, (totals.get(currency) ?? 0) + Number(row.amount));
  }
  return [...totals].map(([currency, amount]) => ({ currency, amount }));
}

export function sectorFinancialPresentation(data: FinancePresentationData, sector: "minoristas" | "mayoristas") {
  const wholesale = data.wholesale;
  return {
    // Account balances include shared opening balances, expenses and transfers.
    // The absence of a wholesale reference is NOT proof of retail ownership.
    cash: null,
    sales: sector === "minoristas" ? (Number.isFinite(data.salesTotal) ? [{ currency: "ARS", amount: data.salesTotal! }] : null)
      : wholesale?.available && wholesale.recognizedNet ? sumByCurrency(wholesale.recognizedNet) : null,
    receivables: sector === "mayoristas" && wholesale?.available && wholesale.receivables ? sumByCurrency(wholesale.receivables) : null,
    profit: sector === "minoristas" && data.retailCostsComplete === true && Number.isFinite(data.realizedProfit)
      ? [{ currency: "ARS", amount: data.realizedProfit! }] : null,
    movements: (data.movements ?? []).filter(movement => sector === "mayoristas" ? movement.source === "wholesale"
      : movement.source !== "wholesale" && Boolean(movement.sale_id) && ["sale_income", "sale_reversal"].includes(movement.movement_type)),
  };
}
