export type CurrencyTotal = { currency: string; amount: number };
export type WholesaleFinanceReadModel = {
  available: boolean;
  received: CurrencyTotal[];
  refunds: CurrencyTotal[];
  netCashEntries: CurrencyTotal[];
  recognized: CurrencyTotal[];
  saleReversals: CurrencyTotal[];
  recognizedNet: CurrencyTotal[];
  receivables: Array<{
    order_id: string;
    order_number: string;
    customer_id: string | null;
    customer_name: string;
    currency: string;
    amount: number;
  }>;
  activity: Array<{
    id: string;
    movement_type: string;
    amount: number;
    description: string;
    occurred_at: string;
    sale_id: null;
    account_id: string;
    transfer_id: null;
    source: "wholesale";
    order_id: string;
    order_number: string;
    payment_entry_id?: string;
    payment_method?: string;
    currency: string;
  }>;
  reconciliation: { reconciled: number; pending: number };
  journalStates: Record<string, number>;
  unaccountedSaleProfit: boolean;
};
export function buildWholesaleFinanceReadModel(input: {
  orders?: Record<string, unknown>[]; payments?: Record<string, unknown>[]; recognitions?: Record<string, unknown>[]; reversals?: Record<string, unknown>[];
  reconciliationEvents?: Record<string, unknown>[]; journals?: Record<string, unknown>[]; customers?: Record<string, unknown>[]; financialPostings?: Record<string, unknown>[];
  period: { id?: string; starts_at: string; ends_at: string | null };
  from?: string; to?: string; accountId?: string; movementType?: string;
}): WholesaleFinanceReadModel;
