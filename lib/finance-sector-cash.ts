export type FinanceSector = "minoristas" | "mayoristas" | "unassigned";
export type CashRow = {
  id: string; period_id?: string | null; account_id: string | null; amount: number | string;
  movement_type: string; sale_id?: string | null; wholesale_payment_entry_id?: string | null;
  transfer_id?: string | null; description: string; occurred_at: string;
  reversal_of_id?: string | null;
  created_at?: string; payment_method?: string | null; order_number?: string;
  operation?: { id: string; action: string; actor_id: string; created_at: string; reverse_of: string | null; legacy_movement_id?: string | null; request: { from?: FinanceSector | null; to?: FinanceSector | null; party?: string; reason?: string; kind?: string } };
};
export type CashAllocation = { cash_movement_id: string; sector: FinanceSector; operation_id?: string };
export type AttributedCashRow = CashRow & { sector: FinanceSector; amount: number };
export type CashSummary = { available: number; income: number; expense: number };
export type SectorCash = {
  minoristas: CashSummary; mayoristas: CashSummary; unassigned: CashSummary;
  total: number; movements: AttributedCashRow[]; sharedOpening: boolean; attributionNeedsReview: boolean;
};

// Un único libro de dinero. Reconocimientos de ventas y cobros pendientes no entran aquí.
export function buildSectorCash(rows: CashRow[], allocations: CashAllocation[] = []): SectorCash {
  const explicit = new Map<string, FinanceSector>();
  for (const row of allocations) {
    if (!["minoristas", "mayoristas", "unassigned"].includes(row.sector) || explicit.has(row.cash_movement_id)) throw new Error("Atribución financiera inválida.");
    explicit.set(row.cash_movement_id, row.sector);
  }
  const cents = {
    minoristas: { available: 0, income: 0, expense: 0 },
    mayoristas: { available: 0, income: 0, expense: 0 },
    unassigned: { available: 0, income: 0, expense: 0 },
  };
  const seen = new Set<string>();
  const movements = rows.map(row => {
    if (seen.has(row.id)) throw new Error("Movimiento financiero duplicado.");
    seen.add(row.id);
    const amount = Number(row.amount), value = Math.round(amount * 100);
    if (row.amount === null || row.amount === undefined || String(row.amount).trim() === "" || !Number.isFinite(amount) || !Number.isSafeInteger(value) || Math.abs(amount * 100 - value) > 0.0001) throw new Error("Importe financiero inválido.");
    let sector: FinanceSector = "unassigned";
    if (row.wholesale_payment_entry_id && !row.sale_id) sector = "mayoristas";
    else if (row.sale_id && !row.wholesale_payment_entry_id && ["sale_income", "sale_reversal"].includes(row.movement_type)) sector = "minoristas";
    else if (!row.sale_id && !row.wholesale_payment_entry_id && row.movement_type !== "opening_balance") sector = explicit.get(row.id) ?? "unassigned";
    cents[sector].available += value;
    // Aperturas y transferencias trasladan saldos; no son ingresos/egresos externos.
    if (row.movement_type !== "opening_balance" && !row.transfer_id) {
      if (value > 0) cents[sector].income += value;
      else cents[sector].expense -= value;
    }
    return { ...row, amount: value / 100, sector };
  });
  const normalize = (value: CashSummary) => ({ available: value.available / 100, income: value.income / 100, expense: value.expense / 100 });
  const total = cents.minoristas.available + cents.mayoristas.available + cents.unassigned.available;
  if (!Number.isSafeInteger(total)) throw new Error("Saldo financiero fuera de rango.");
  return { minoristas: normalize(cents.minoristas), mayoristas: normalize(cents.mayoristas), unassigned: normalize(cents.unassigned), total: total / 100,
    movements: movements.sort((a,b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at) || a.id.localeCompare(b.id)),
    sharedOpening: rows.some(row => row.movement_type === "opening_balance" && Number(row.amount) !== 0),
    attributionNeedsReview: cents.unassigned.available < 0 };
}
