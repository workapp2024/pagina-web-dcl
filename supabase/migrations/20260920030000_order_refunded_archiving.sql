BEGIN;

CREATE OR REPLACE FUNCTION public.order_archive_block_reason(p_order UUID) RETURNS TEXT
LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT CASE
    WHEN o.operational_status NOT IN ('delivered','cancelled') THEN 'ORDER_NOT_TERMINAL'
    WHEN o.status NOT IN ('paid','completed','cancelled','rejected','refunded') THEN 'ORDER_REQUIRES_ATTENTION'
    WHEN (SELECT count(*) FROM payment_transactions WHERE order_id=o.id)<>1 THEN 'PAYMENT_AMBIGUOUS'
    WHEN o.status='refunded' AND EXISTS(
      SELECT 1 FROM payment_transactions WHERE order_id=o.id AND status<>'refunded'
    ) THEN 'PAYMENT_REQUIRES_ATTENTION'
    WHEN o.status<>'refunded' AND EXISTS(
      SELECT 1 FROM payment_transactions WHERE order_id=o.id AND status IN ('pending','error','refunded')
    ) THEN 'PAYMENT_REQUIRES_ATTENTION'
    WHEN EXISTS(SELECT 1 FROM inventory_reservations WHERE order_id=o.id AND status='active' AND expires_at>statement_timestamp()) THEN 'RESERVATION_ACTIVE'
    WHEN EXISTS(SELECT 1 FROM payment_transactions WHERE order_id=o.id AND (amount<>o.total OR currency<>o.currency)) THEN 'PAYMENT_MISMATCH'
    WHEN o.status='refunded' AND (o.operational_status<>'cancelled' OR EXISTS(
      SELECT 1 FROM payment_transactions t LEFT JOIN sales s ON s.id=t.sale_id
      WHERE t.order_id=o.id AND t.sale_id IS NOT NULL
        AND (s.id IS NULL OR s.status<>'cancelled' OR s.customer_id<>o.customer_id OR s.total<>o.total)
    )) THEN 'CANCELLATION_FINANCIAL_MISMATCH'
    WHEN o.operational_status='delivered' AND (o.status<>'completed' OR NOT EXISTS(
      SELECT 1 FROM payment_transactions t JOIN sales s ON s.id=t.sale_id
      WHERE t.order_id=o.id AND t.status='approved' AND s.status='completed' AND s.total=o.total
    )) THEN 'DELIVERY_FINANCIAL_MISMATCH'
    WHEN o.operational_status='cancelled' AND o.status<>'refunded' AND (o.status NOT IN ('cancelled','rejected') OR EXISTS(
      SELECT 1 FROM payment_transactions WHERE order_id=o.id AND (status NOT IN ('cancelled','rejected') OR sale_id IS NOT NULL)
    )) THEN 'CANCELLATION_FINANCIAL_MISMATCH'
    ELSE NULL END
  FROM orders o WHERE o.id=p_order;
$$;

COMMIT;
