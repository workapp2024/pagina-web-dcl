/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildWholesaleFinanceReadModel } = require("../lib/wholesale-finance-read-model.cjs");

const period = { starts_at: "2026-10-01T00:00:00.000Z", ends_at: null };
const orderA = { id: "order-a", order_number: "MW-000001", customer_id: "customer-a" };
const orderB = { id: "order-b", order_number: "MW-000002", customer_id: "customer-b" };

test("unifica cobros parciales, anticipos, reembolsos y saldos sin confundirlos con ventas", () => {
  const model = buildWholesaleFinanceReadModel({
    orders: [orderA, orderB],
    customers: [
      { id: "customer-a", full_name: "Cliente A" },
      { id: "customer-b", full_name: "Cliente B" },
    ],
    payments: [
      { id: "prior-payment", order_id: "order-a", entry_type: "payment", amount: "30", currency: "ARS", payment_method: "cash", occurred_at: "2026-09-30T22:00:00Z" },
      { id: "part-payment", order_id: "order-a", entry_type: "payment", amount: "50", currency: "ARS", payment_method: "mercadopago", occurred_at: "2026-10-10T12:00:00Z" },
      { id: "refund", order_id: "order-a", entry_type: "refund", amount: "10", currency: "ARS", payment_method: "cash", occurred_at: "2026-10-10T13:00:00Z" },
      { id: "advance", order_id: "order-b", entry_type: "payment", amount: "25", currency: "ARS", payment_method: "bank_transfer", occurred_at: "2026-10-10T14:00:00Z" },
    ],
    recognitions: [{ id: "recognition", order_id: "order-a", amount: "200", currency: "ARS", recognized_at: "2026-10-09T12:00:00Z" }],
    reversals: [{ id: "reversal", recognition_id: "recognition", order_id: "order-a", amount: "20", currency: "ARS", reversed_at: "2026-10-10T15:00:00Z" }],
    reconciliationEvents: [
      { payment_entry_id: "part-payment", event_type: "reconciled", created_at: "2026-10-10T12:30:00Z" },
      { payment_entry_id: "part-payment", event_type: "reconciliation_reversed", created_at: "2026-10-10T13:30:00Z" },
    ],
    journals: [{ status: "awaiting_account_mapping" }, { status: "ready" }],
    period,
  });

  assert.deepEqual(model.received, [{ currency: "ARS", amount: 75 }]);
  assert.deepEqual(model.refunds, [{ currency: "ARS", amount: 10 }]);
  assert.deepEqual(model.netCashEntries, [{ currency: "ARS", amount: 65 }]);
  assert.deepEqual(model.recognized, [{ currency: "ARS", amount: 200 }]);
  assert.deepEqual(model.saleReversals, [{ currency: "ARS", amount: 20 }]);
  assert.deepEqual(model.recognizedNet, [{ currency: "ARS", amount: 180 }]);
  assert.equal(model.activity.filter((row) => row.source === "wholesale").length, 5);
  assert.equal(model.receivables.find((row) => row.order_id === "order-a").amount, 110);
  assert.equal(model.receivables.find((row) => row.order_id === "order-b").amount, -25);
  assert.equal(model.reconciliation.reconciled, 0);
  assert.equal(model.reconciliation.pending, 3);
  assert.equal(model.journalStates.awaiting_account_mapping, 1);
});

test("muestra actividad mayorista en el rango inclusive y filtra por origen/tipo sin duplicar", () => {
  const model = buildWholesaleFinanceReadModel({
    orders: [orderA],
    payments: [
      { id: "same-day", order_id: "order-a", entry_type: "payment", amount: "15", currency: "ARS", payment_method: "cash", occurred_at: "2026-10-31T23:59:59Z" },
      { id: "other-day", order_id: "order-a", entry_type: "refund", amount: "3", currency: "ARS", payment_method: "cash", occurred_at: "2026-11-01T00:00:00Z" },
    ],
    period: { starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-11-01T00:00:00Z" },
    from: "2026-10-31",
    to: "2026-10-31",
    accountId: "cash",
    movementType: "wholesale_payment",
  });
  assert.equal(model.activity.length, 1);
  assert.equal(model.activity[0].id, "wholesale-payment:same-day");
  assert.equal(model.activity[0].order_number, "MW-000001");
});

test("reporta cobros catch-up en el período financiero que recibió el asiento y no repite los de apertura", () => {
  const model = buildWholesaleFinanceReadModel({
    orders: [orderA],
    payments: [
      { id: "late-posted", order_id: "order-a", entry_type: "payment", amount: "35", currency: "ARS", payment_method: "bank_transfer", occurred_at: "2026-09-30T23:00:00Z" },
      { id: "opening-covered", order_id: "order-a", entry_type: "payment", amount: "10", currency: "ARS", payment_method: "cash", occurred_at: "2026-10-02T12:00:00Z" },
    ],
    financialPostings: [
      { payment_entry_id: "late-posted", status: "posted", period_id: "open-period" },
      { payment_entry_id: "opening-covered", status: "included_in_opening_balance", period_id: null },
    ],
    period: { id: "open-period", starts_at: "2026-10-01T00:00:00.000Z", ends_at: null },
  });
  assert.deepEqual(model.received, [{ currency: "ARS", amount: 35 }]);
  assert.deepEqual(model.netCashEntries, [{ currency: "ARS", amount: 35 }]);
  assert.equal(model.activity.length, 1);
  assert.equal(model.activity[0].payment_entry_id, "late-posted");
});
