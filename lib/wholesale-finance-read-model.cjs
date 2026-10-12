function inPeriod(value, period) {
  const time = Date.parse(value);
  return Number.isFinite(time)
    && time >= Date.parse(period.starts_at)
    && (!period.ends_at || time <= Date.parse(period.ends_at));
}

function aggregateByCurrency(rows, amountOf) {
  const totals = new Map();
  for (const row of rows) {
    const currency = String(row.currency || "").trim();
    if (!currency) continue;
    totals.set(currency, (totals.get(currency) || 0) + amountOf(row));
  }
  return [...totals].map(([currency, amount]) => ({ currency, amount }));
}

function toInclusiveEnd(to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to || "")) return to ? Date.parse(to) : Infinity;
  return Date.parse(`${to}T00:00:00.000Z`) + 24 * 60 * 60 * 1000 - 1;
}

function buildWholesaleFinanceReadModel({
  orders = [], payments = [], recognitions = [], reversals = [],
  reconciliationEvents = [], journals = [], customers = [], financialPostings = [], period,
  from = "", to = "", accountId = "", movementType = "",
}) {
  const customerNames = new Map(customers.map((customer) => [customer.id, customer.full_name]));
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const reversalByRecognition = new Map();
  for (const reversal of reversals) {
    reversalByRecognition.set(reversal.recognition_id,
      (reversalByRecognition.get(reversal.recognition_id) || 0) + Number(reversal.amount));
  }

  const postingByEntry = new Map(financialPostings.map((posting) => [posting.payment_entry_id, posting]));
  const periodPayments = payments.filter((entry) => {
    const posting = postingByEntry.get(entry.id);
    if (posting?.status === "posted") return posting.period_id === period.id;
    if (posting?.status === "included_in_opening_balance") return false;
    return inPeriod(entry.occurred_at, period);
  });
  const periodRecognitions = recognitions.filter((entry) => inPeriod(entry.recognized_at, period));
  const periodReversals = reversals.filter((entry) => inPeriod(entry.reversed_at, period));
  const refunds = periodPayments.filter((entry) => entry.entry_type === "refund");
  const received = periodPayments.filter((entry) => entry.entry_type === "payment");
  const netPayments = (entries) => aggregateByCurrency(entries, (entry) =>
    Number(entry.amount) * (entry.entry_type === "refund" ? -1 : 1));

  const receivableByOrder = new Map();
  const addReceivable = (orderId, currency, amount) => {
    const key = `${orderId}:${currency}`;
    receivableByOrder.set(key, (receivableByOrder.get(key) || 0) + amount);
  };
  for (const row of recognitions) addReceivable(row.order_id, row.currency, Number(row.amount));
  for (const row of reversals) addReceivable(row.order_id, row.currency, -Number(row.amount));
  for (const row of payments) addReceivable(row.order_id, row.currency,
    Number(row.amount) * (row.entry_type === "refund" ? 1 : -1));

  const receivables = [...receivableByOrder].map(([key, amount]) => {
    const split = key.lastIndexOf(":");
    const orderId = key.slice(0, split);
    const currency = key.slice(split + 1);
    const order = orderById.get(orderId);
    return {
      order_id: orderId,
      order_number: order?.order_number || orderId,
      customer_id: order?.customer_id || null,
      customer_name: customerNames.get(order?.customer_id) || "Cliente",
      currency,
      amount,
    };
  }).filter((row) => Math.abs(row.amount) > 0.000001)
    .sort((a, b) => a.customer_name.localeCompare(b.customer_name) || a.order_number.localeCompare(b.order_number));

  const activity = periodPayments.map((entry) => ({
    id: `wholesale-payment:${entry.id}`,
    movement_type: entry.entry_type === "payment" ? "wholesale_payment" : "wholesale_refund",
    amount: Number(entry.amount) * (entry.entry_type === "refund" ? -1 : 1),
    description: `${entry.entry_type === "payment" ? "Cobro mayorista" : "Reembolso mayorista"} · ${entry.payment_method}${entry.external_reference ? ` · Ref. ${entry.external_reference}` : ""}`,
    occurred_at: entry.occurred_at,
    sale_id: null,
    account_id: "",
    transfer_id: null,
    source: "wholesale",
    order_id: entry.order_id,
    order_number: orderById.get(entry.order_id)?.order_number || entry.order_id,
    payment_entry_id: entry.id,
    payment_method: entry.payment_method,
    currency: entry.currency,
  })).concat(
    periodRecognitions.map((entry) => ({
      id: `wholesale-recognition:${entry.id}`,
      movement_type: "wholesale_sale_recognition",
      amount: Number(entry.amount),
      description: "Venta mayorista reconocida por entrega completa",
      occurred_at: entry.recognized_at,
      sale_id: null,
      account_id: "",
      transfer_id: null,
      source: "wholesale",
      order_id: entry.order_id,
      order_number: orderById.get(entry.order_id)?.order_number || entry.order_id,
      payment_entry_id: "",
      currency: entry.currency,
    })),
    periodReversals.map((entry) => ({
      id: `wholesale-reversal:${entry.id}`,
      movement_type: "wholesale_sale_reversal",
      amount: -Number(entry.amount),
      description: "Reversión del reconocimiento por corrección de entrega",
      occurred_at: entry.reversed_at,
      sale_id: null,
      account_id: "",
      transfer_id: null,
      source: "wholesale",
      order_id: entry.order_id,
      order_number: orderById.get(entry.order_id)?.order_number || entry.order_id,
      payment_entry_id: "",
      currency: entry.currency,
    }))
  );

  const filteredActivity = activity.filter((row) =>
    (!from || Date.parse(row.occurred_at) >= Date.parse(from))
    && Date.parse(row.occurred_at) <= toInclusiveEnd(to)
    && (!accountId || accountId === `wholesale:${row.payment_method}`
      || (accountId === "cash" && row.payment_method === "cash")
      || (accountId === "mercadopago" && row.payment_method === "mercadopago"))
    && (!movementType || movementType === row.movement_type));

  const journalStates = journals.reduce((summary, journal) => {
    summary[journal.status] = (summary[journal.status] || 0) + 1;
    return summary;
  }, {});
  const latestReconciliation = new Map();
  for (const event of reconciliationEvents) {
    const previous = latestReconciliation.get(event.payment_entry_id);
    if (!previous || Date.parse(event.created_at) > Date.parse(previous.created_at)) {
      latestReconciliation.set(event.payment_entry_id, event);
    }
  }

  return {
    available: true,
    received: aggregateByCurrency(received, (entry) => Number(entry.amount)),
    refunds: aggregateByCurrency(refunds, (entry) => Number(entry.amount)),
    netCashEntries: netPayments(periodPayments),
    recognized: aggregateByCurrency(periodRecognitions, (entry) => Number(entry.amount)),
    saleReversals: aggregateByCurrency(periodReversals, (entry) => Number(entry.amount)),
    recognizedNet: aggregateByCurrency(
      [...periodRecognitions, ...periodReversals],
      (entry) => Number(entry.amount) * (entry.reversed_at ? -1 : 1)
    ),
    receivables,
    activity: filteredActivity,
    reconciliation: {
      reconciled: [...latestReconciliation.values()].filter((event) => event.event_type === "reconciled").length,
      pending: payments.filter((entry) => entry.entry_type === "payment")
        .filter((entry) => latestReconciliation.get(entry.id)?.event_type !== "reconciled").length,
    },
    journalStates,
    unaccountedSaleProfit: true,
  };
}

module.exports = { buildWholesaleFinanceReadModel };
