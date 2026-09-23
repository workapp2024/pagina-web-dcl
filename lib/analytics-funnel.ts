export const funnelLabels = ["Productos vistos", "Agregados al carrito", "Checkout iniciado", "Pedidos creados", "Pagos aprobados", "Compras completadas"] as const;

export type FunnelStep = {
  label: string;
  count: number;
  journeys: number;
  comparisonUnit: "recorridos" | "pedidos";
  conversion: number | null;
  drop: number | null;
  dropPercent: number | null;
};
export type FunnelData = { steps: FunnelStep[]; conversion: number | null };
export type FunnelResult = { startAt: string | null } & (
  | { status: "start_not_configured" | "not_configured" | "before_start" | "pending" }
  | { status: "error"; message: string }
  | { status: "ok"; from: number; to: number; data: FunnelData }
);

export function funnelPercent(value: number | null): string {
  return value === null ? "—" : `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(value)}%`;
}

// Each row is [step, unique sessions reaching it, unique orders reaching it].
// The navigation/order boundary uses nested session sets; the last two transitions
// use nested order sets. Never divide orders by sessions. Full conversion is sessions.
export function parseFunnelRows(rows: unknown): FunnelData {
  if (!Array.isArray(rows) || rows.length !== 6) throw new Error("Invalid funnel result");
  const number = (value: unknown) => {
    if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "" || !Number.isSafeInteger(Number(value)) || Number(value) < 0) throw new Error("Invalid funnel count");
    return Number(value);
  };
  const counts = rows.map((row, index) => {
    if (!Array.isArray(row) || row.length !== 3 || number(row[0]) !== index + 1) throw new Error("Invalid funnel step");
    return { journeys: number(row[1]), orders: number(row[2]) };
  });
  const steps = counts.map(({ journeys, orders }, index): FunnelStep => {
    if ((index > 0 && journeys > counts[index - 1].journeys) || (index < 3 && orders !== 0) || (index >= 3 && (orders < journeys || (journeys === 0 && orders !== 0))) || (index > 3 && orders > counts[index - 1].orders)) throw new Error("Invalid funnel sequence");
    const comparisonUnit = index > 3 ? "pedidos" : "recorridos";
    const reached = index > 3 ? orders : journeys;
    const previous = index ? (index > 3 ? counts[index - 1].orders : counts[index - 1].journeys) : null;
    const conversion = previous ? reached / previous * 100 : null;
    return { label: funnelLabels[index], count: index < 3 ? journeys : orders, journeys, comparisonUnit, conversion,
      drop: previous === null ? null : previous - reached, dropPercent: conversion === null ? null : 100 - conversion };
  });
  return { steps, conversion: counts[0].journeys ? counts[5].journeys / counts[0].journeys * 100 : null };
}

// Strict session funnel. The first view in the effective range anchors one journey.
// A later repeat does not restart its seven-day clock. All events stay in the selected
// period. Missing sessions are excluded from navigation, never synthesized.
// Only equality belongs in JOIN ON (HogQL); temporal conditions live in WHERE.
export const commercialFunnelQuery = `WITH
source AS (
  SELECT event, timestamp, distinct_id,
    ifNull(toString(properties['$session_id']), '') AS session_id,
    ifNull(toString(properties['order_id']), '') AS order_id
  FROM events
  WHERE timestamp >= toDateTime64({from}, 3, 'UTC') AND timestamp < toDateTime64({to}, 3, 'UTC')
    AND properties['environment'] = 'production'
    AND event IN ('product_viewed','add_to_cart','checkout_started','order_created','payment_approved','purchase_completed')
    AND notEmpty(ifNull(distinct_id, ''))
),
views AS (
  SELECT distinct_id, session_id, min(timestamp) AS first_at
  FROM source WHERE event = 'product_viewed' AND session_id != ''
  GROUP BY distinct_id, session_id
),
carts AS (
  SELECT v.distinct_id, v.session_id, v.first_at, min(e.timestamp) AS cart_at
  FROM views v INNER JOIN source e ON e.distinct_id = v.distinct_id AND e.session_id = v.session_id
  WHERE e.event = 'add_to_cart' AND e.timestamp >= v.first_at AND e.timestamp <= addDays(v.first_at, 7)
  GROUP BY v.distinct_id, v.session_id, v.first_at
),
checkouts AS (
  SELECT c.distinct_id, c.session_id, c.first_at, min(e.timestamp) AS checkout_at
  FROM carts c INNER JOIN source e ON e.distinct_id = c.distinct_id AND e.session_id = c.session_id
  WHERE e.event = 'checkout_started' AND e.timestamp >= c.cart_at AND e.timestamp <= addDays(c.first_at, 7)
  GROUP BY c.distinct_id, c.session_id, c.first_at
),
facts AS (
  SELECT event, order_id, min(distinct_id) AS fact_distinct_id, min(session_id) AS fact_session_id, min(timestamp) AS fact_at
  FROM source
  WHERE event IN ('order_created','payment_approved','purchase_completed') AND order_id != ''
  GROUP BY event, order_id
  HAVING count(DISTINCT distinct_id) = 1
    AND (event != 'order_created' OR (count(DISTINCT session_id) = 1 AND min(session_id) != ''))
),
orders AS (
  SELECT c.distinct_id, c.session_id, c.first_at, e.order_id, e.fact_at AS order_at
  FROM checkouts c INNER JOIN facts e ON e.fact_distinct_id = c.distinct_id AND e.fact_session_id = c.session_id
  WHERE e.event = 'order_created' AND e.fact_at >= c.checkout_at AND e.fact_at <= addDays(c.first_at, 7)
),
payments AS (
  SELECT o.distinct_id, o.session_id, o.first_at, o.order_id, e.fact_at AS payment_at
  FROM orders o INNER JOIN facts e ON e.fact_distinct_id = o.distinct_id AND e.order_id = o.order_id
  WHERE e.event = 'payment_approved' AND e.fact_at >= o.order_at AND e.fact_at <= addDays(o.first_at, 7)
),
purchases AS (
  SELECT p.distinct_id, p.session_id, p.order_id
  FROM payments p INNER JOIN facts e ON e.fact_distinct_id = p.distinct_id AND e.order_id = p.order_id
  WHERE e.event = 'purchase_completed' AND e.fact_at >= p.payment_at AND e.fact_at <= addDays(p.first_at, 7)
),
stages AS (
  SELECT 1 AS step, distinct_id, session_id, '' AS order_id FROM views
  UNION ALL SELECT 2 AS step, distinct_id, session_id, '' AS order_id FROM carts
  UNION ALL SELECT 3 AS step, distinct_id, session_id, '' AS order_id FROM checkouts
  UNION ALL SELECT 4 AS step, distinct_id, session_id, order_id FROM orders
  UNION ALL SELECT 5 AS step, distinct_id, session_id, order_id FROM payments
  UNION ALL SELECT 6 AS step, distinct_id, session_id, order_id FROM purchases
),
journeys AS (
  SELECT step, distinct_id, session_id, sum(CASE WHEN order_id != '' THEN 1 ELSE 0 END) AS orders_reached
  FROM stages GROUP BY step, distinct_id, session_id
),
step_numbers AS (
  SELECT 1 AS step UNION ALL SELECT 2 AS step UNION ALL SELECT 3 AS step
  UNION ALL SELECT 4 AS step UNION ALL SELECT 5 AS step UNION ALL SELECT 6 AS step
)
SELECT n.step,
  sum(CASE WHEN j.distinct_id != '' THEN 1 ELSE 0 END) AS journeys_reached,
  sum(ifNull(j.orders_reached, 0)) AS orders_reached
FROM step_numbers n LEFT JOIN journeys j ON j.step = n.step
GROUP BY n.step ORDER BY n.step`;
