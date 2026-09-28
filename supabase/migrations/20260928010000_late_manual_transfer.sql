-- A3: no new tables, no backfill, no existing data updates.
BEGIN;

CREATE OR REPLACE FUNCTION public.complete_manual_transfer(p_order UUID,p_analytics_environment TEXT DEFAULT 'preview')
RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_order RECORD; v_transaction RECORD; v_item RECORD; v_product RECORD;
  v_sale UUID:=gen_random_uuid(); v_total NUMERIC(12,2):=0; v_now TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id=p_order AND payment_method='transfer' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido de transferencia no verificable.'; END IF;
  SELECT * INTO STRICT v_transaction FROM payment_transactions WHERE order_id=p_order AND provider='transfer' FOR UPDATE;
  IF v_transaction.sale_id IS NOT NULL THEN RETURN v_transaction.sale_id; END IF;
  IF v_order.status IN ('stock_unavailable','refund_required','refunded') AND v_transaction.status IN ('approved','refunded') THEN RETURN NULL; END IF;
  IF v_order.status<>'pending_manual_verification' OR v_order.transfer_declared_at IS NULL THEN RAISE EXCEPTION 'Pedido de transferencia no verificable.'; END IF;
  IF v_transaction.amount<>v_order.total OR v_transaction.currency<>v_order.currency OR v_transaction.amount<=0 THEN RAISE EXCEPTION 'TRANSFER_PAYMENT_INCONSISTENT'; END IF;
  -- Administrative receipt survives the commercial subtransaction below.
  IF v_transaction.status<>'approved' THEN
    UPDATE payment_transactions SET status='approved',approved_at=COALESCE(approved_at,clock_timestamp()) WHERE id=v_transaction.id;
    INSERT INTO order_notes(order_id,note) VALUES(p_order,'Admin confirmó la recepción de la transferencia. Importe y moneda conservados en la transacción de pago.');

  END IF;
  BEGIN
    PERFORM p.id FROM products p WHERE p.id IN (SELECT product_id FROM order_items WHERE order_id=p_order) ORDER BY p.id FOR UPDATE;
    v_now:=clock_timestamp();
    IF NOT EXISTS(SELECT 1 FROM order_items WHERE order_id=p_order) OR EXISTS (
      SELECT 1 FROM order_items i LEFT JOIN products p ON p.id=i.product_id
      WHERE i.order_id=p_order AND (p.id IS NULL OR NOT p.active OR p.stock-i.quantity<COALESCE(
        (SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.product_id=i.product_id AND r.order_id<>p_order AND r.status='active' AND r.expires_at>v_now),0))
    ) THEN
      UPDATE orders SET status='stock_unavailable' WHERE id=p_order;
      UPDATE inventory_reservations SET status='released' WHERE order_id=p_order AND status='active';
      INSERT INTO order_notes(order_id,note) VALUES(p_order,'Pago recibido. No hay stock disponible. Requiere devolución verificada o resolución explícita con stock.');
      PERFORM enqueue_commercial_analytics('payment_approved',p_order,p_analytics_environment);
      RETURN NULL;
    END IF;
  INSERT INTO sales(id,customer_id,status,notes,subtotal,total,payment_method) VALUES(v_sale,v_order.customer_id,'completed',concat('Transferencia verificada. Pedido ',p_order),0,0,'transfer');
  -- Consume only still-valid reservations; expired reservations are never reactivated.
  UPDATE inventory_reservations r SET status=CASE WHEN r.status='active' AND r.expires_at>v_now
    AND r.quantity=(SELECT i.quantity FROM order_items i WHERE i.order_id=p_order AND i.product_id=r.product_id)
    THEN 'consumed' ELSE 'released' END WHERE r.order_id=p_order AND r.status='active';
  FOR v_item IN SELECT * FROM order_items WHERE order_id=p_order ORDER BY product_id LOOP
    SELECT * INTO v_product FROM products WHERE id=v_item.product_id;
    INSERT INTO sale_items(sale_id,product_id,product_name,quantity,unit_price,unit_cost,line_total) VALUES(v_sale,v_product.id,v_item.product_name,v_item.quantity,v_item.unit_price,v_product.cost_price,v_item.line_total);
    INSERT INTO inventory_movements(product_id,movement_type,quantity_delta,reason,reference_type,reference_id) VALUES(v_product.id,'venta',-v_item.quantity,'Venta por transferencia verificada','sale',v_sale::TEXT);
    v_total:=v_total+v_item.line_total;
  END LOOP;
  UPDATE sales SET subtotal=v_total,total=v_total WHERE id=v_sale;
  UPDATE orders SET status='completed' WHERE id=p_order;
  UPDATE payment_transactions SET sale_id=v_sale,status='approved',approved_at=COALESCE(approved_at,v_now) WHERE id=v_transaction.id;
  PERFORM enqueue_commercial_analytics('payment_approved',p_order,p_analytics_environment);
  PERFORM enqueue_commercial_analytics('purchase_completed',p_order,p_analytics_environment);
  RETURN v_sale;
  EXCEPTION WHEN OTHERS THEN
    -- Roll back sale/items/stock, but retain receipt and let A1 capture payment_without_sale.
    UPDATE orders SET status='stock_unavailable' WHERE id=p_order;
    UPDATE inventory_reservations SET status='released' WHERE order_id=p_order AND status='active';
    INSERT INTO order_notes(order_id,note) VALUES(p_order,'Pago recibido. No se pudo completar la venta. Requiere revisión antes de completar o registrar la devolución verificada.');
    PERFORM enqueue_commercial_analytics('payment_approved',p_order,p_analytics_environment);
    RETURN NULL;
  END;
END $$;
REVOKE ALL ON FUNCTION public.complete_manual_transfer(UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_manual_transfer(UUID,TEXT) TO service_role;


CREATE OR REPLACE FUNCTION public.resolve_order(p_order UUID,p_resolution TEXT,p_external_reference TEXT,p_note TEXT,p_idempotency_key UUID,p_analytics_environment TEXT DEFAULT 'preview')
RETURNS JSONB LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_order RECORD; v_payment RECORD; v_sale RECORD; v_item RECORD; v_product RECORD;
  v_income RECORD; v_previous RECORD; v_resolution UUID; v_sale_id UUID; v_total NUMERIC(12,2):=0;
  v_now TIMESTAMPTZ:=clock_timestamp(); v_available BIGINT;
BEGIN
  IF p_order IS NULL OR p_idempotency_key IS NULL OR p_resolution IS NULL OR p_resolution NOT IN (
    'CANCEL_PENDING','REFUND_VERIFIED','TRANSFER_APPROVAL_ERROR',
    'COMPLETE_STOCK_UNAVAILABLE','REFUND_STOCK_UNAVAILABLE'
  ) OR length(btrim(COALESCE(p_note,''))) NOT BETWEEN 1 AND 1000
    OR (p_resolution IN ('REFUND_VERIFIED','REFUND_STOCK_UNAVAILABLE')
      AND length(btrim(COALESCE(p_external_reference,''))) NOT BETWEEN 1 AND 160)
    OR length(COALESCE(p_external_reference,''))>160 THEN RAISE EXCEPTION 'ORDER_RESOLUTION_INVALID_INPUT'; END IF;

  SELECT * INTO v_order FROM orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_RESOLUTION_NOT_FOUND'; END IF;
  SELECT * INTO v_previous FROM order_resolutions WHERE idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_previous.order_id<>p_order OR v_previous.resolution_type<>p_resolution
      OR v_previous.external_reference IS DISTINCT FROM NULLIF(btrim(COALESCE(p_external_reference,'')),'')
      OR v_previous.note<>btrim(p_note) THEN RAISE EXCEPTION 'ORDER_RESOLUTION_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN to_jsonb(v_previous);
  END IF;
  IF EXISTS(SELECT 1 FROM order_resolutions WHERE order_id=p_order AND resolution_type=p_resolution) THEN
    RAISE EXCEPTION 'ORDER_RESOLUTION_ALREADY_APPLIED';
  END IF;
  IF v_order.operational_status='delivered' THEN RAISE EXCEPTION 'ORDER_RESOLUTION_DELIVERED'; END IF;
  IF v_order.operational_status='cancelled'
    AND NOT (p_resolution='REFUND_STOCK_UNAVAILABLE' AND v_order.status='refund_required')
    THEN RAISE EXCEPTION 'ORDER_RESOLUTION_CLOSED'; END IF;
  SELECT * INTO v_payment FROM payment_transactions WHERE order_id=p_order ORDER BY created_at,id LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM payment_transactions WHERE order_id=p_order AND id<>v_payment.id) THEN
    RAISE EXCEPTION 'ORDER_RESOLUTION_PAYMENT_AMBIGUOUS';
  END IF;
  IF v_payment.sale_id IS NOT NULL THEN
    SELECT * INTO v_sale FROM sales WHERE id=v_payment.sale_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_RESOLUTION_SALE_MISSING'; END IF;
  END IF;

  IF p_resolution='CANCEL_PENDING' THEN
    IF v_order.status NOT IN ('pending_payment','pending_manual_verification','rejected')
      OR v_payment.status NOT IN ('pending','rejected','cancelled','error') OR v_payment.sale_id IS NOT NULL THEN
      RAISE EXCEPTION 'ORDER_RESOLUTION_NOT_PENDING';
    END IF;
    IF NOT cancel_public_order(p_order) THEN RAISE EXCEPTION 'ORDER_RESOLUTION_NOT_PENDING'; END IF;
    PERFORM set_config('dcl.operation_source','order_resolution',TRUE);
    PERFORM set_config('dcl.operation_note',btrim(p_note),TRUE);
    UPDATE orders SET operational_status='cancelled' WHERE id=p_order;

  ELSIF p_resolution='COMPLETE_STOCK_UNAVAILABLE' THEN
    IF v_order.status<>'stock_unavailable' OR v_payment.status<>'approved' OR v_payment.sale_id IS NOT NULL
      OR NOT ((v_payment.provider='mercadopago' AND v_order.payment_method IN ('mercadopago','card')) OR (v_payment.provider='transfer' AND v_order.payment_method='transfer')) THEN RAISE EXCEPTION 'ORDER_RESOLUTION_INVALID_STATE'; END IF;
    PERFORM p.id FROM products p WHERE p.id IN (SELECT product_id FROM order_items WHERE order_id=p_order) ORDER BY p.id FOR UPDATE;
    v_now:=clock_timestamp();
    IF NOT EXISTS(SELECT 1 FROM order_items WHERE order_id=p_order) THEN RAISE EXCEPTION 'ORDER_RESOLUTION_NO_ITEMS'; END IF;
    FOR v_item IN SELECT * FROM order_items WHERE order_id=p_order ORDER BY product_id LOOP
      SELECT * INTO v_product FROM products WHERE id=v_item.product_id;
      SELECT v_product.stock-COALESCE(SUM(r.quantity),0) INTO v_available FROM inventory_reservations r
        WHERE r.product_id=v_item.product_id AND r.order_id<>p_order AND r.status='active' AND r.expires_at>v_now;
      IF v_product.id IS NULL OR NOT v_product.active OR v_available<v_item.quantity THEN
        RAISE EXCEPTION 'ORDER_RESOLUTION_INSUFFICIENT_STOCK';
      END IF;
    END LOOP;
    v_sale_id:=gen_random_uuid();
    INSERT INTO sales(id,customer_id,status,notes,subtotal,total,payment_method)
      VALUES(v_sale_id,v_order.customer_id,'completed',concat('Resolución de pedido ',p_order),0,0,CASE WHEN v_payment.provider='transfer' THEN 'transfer' ELSE 'mercadopago' END);
    UPDATE inventory_reservations SET status='released' WHERE order_id=p_order AND status='active';
    FOR v_item IN SELECT * FROM order_items WHERE order_id=p_order ORDER BY product_id LOOP
      SELECT * INTO v_product FROM products WHERE id=v_item.product_id;
      INSERT INTO sale_items(sale_id,product_id,product_name,quantity,unit_price,unit_cost,line_total)
        VALUES(v_sale_id,v_product.id,v_item.product_name,v_item.quantity,v_item.unit_price,v_product.cost_price,v_item.line_total);
      INSERT INTO inventory_movements(product_id,movement_type,quantity_delta,reason,reference_type,reference_id)
        VALUES(v_product.id,'venta',-v_item.quantity,'Venta tras resolver reserva vencida','sale',v_sale_id::TEXT);
      v_total:=v_total+v_item.line_total;
    END LOOP;
    UPDATE sales SET subtotal=v_total,total=v_total WHERE id=v_sale_id;
    UPDATE orders SET status='completed' WHERE id=p_order;
    UPDATE payment_transactions SET sale_id=v_sale_id WHERE id=v_payment.id;

  ELSIF p_resolution IN ('REFUND_VERIFIED','TRANSFER_APPROVAL_ERROR','REFUND_STOCK_UNAVAILABLE') THEN
    IF p_resolution='TRANSFER_APPROVAL_ERROR' AND (v_order.payment_method<>'transfer' OR v_payment.provider<>'transfer') THEN
      RAISE EXCEPTION 'ORDER_RESOLUTION_TRANSFER_ONLY';
    END IF;
    IF p_resolution='REFUND_STOCK_UNAVAILABLE' THEN
      -- Also resolves a late approved payment on an already cancelled order.
      IF v_order.status NOT IN ('stock_unavailable','refund_required') OR v_payment.status<>'approved' OR v_payment.sale_id IS NOT NULL
        OR NOT ((v_payment.provider='mercadopago' AND v_order.payment_method IN ('mercadopago','card')) OR (v_payment.provider='transfer' AND v_order.payment_method='transfer')) THEN
        RAISE EXCEPTION 'ORDER_RESOLUTION_INVALID_STATE';
      END IF;
    ELSE
      IF v_order.status<>'completed' OR v_payment.status<>'approved' OR v_payment.sale_id IS NULL
        OR v_sale.id IS NULL OR v_sale.status<>'completed' OR v_sale.customer_id<>v_order.customer_id
        THEN RAISE EXCEPTION 'ORDER_RESOLUTION_INVALID_STATE'; END IF;
    END IF;
    IF p_resolution<>'REFUND_STOCK_UNAVAILABLE' THEN
      PERFORM p.id FROM products p WHERE p.id IN (SELECT product_id FROM sale_items WHERE sale_id=v_sale.id) ORDER BY p.id FOR UPDATE;
      FOR v_item IN SELECT product_id,SUM(quantity)::INTEGER AS quantity FROM sale_items WHERE sale_id=v_sale.id GROUP BY product_id ORDER BY product_id LOOP
        INSERT INTO inventory_movements(product_id,movement_type,quantity_delta,reason,reference_type,reference_id)
          VALUES(v_item.product_id,'ajuste',v_item.quantity,concat('Resolución de pedido: ',btrim(p_note)),'sale_reversal',v_sale.id::TEXT);
      END LOOP;
      UPDATE sales SET status='cancelled',cancelled_at=v_now,cancellation_reason=btrim(p_note) WHERE id=v_sale.id;
      SELECT * INTO v_income FROM cash_movements WHERE sale_id=v_sale.id AND movement_type='sale_income' FOR UPDATE;
      IF FOUND THEN
        INSERT INTO cash_movements(movement_type,amount,description,sale_id,account_id,period_id)
          VALUES('sale_reversal',-v_income.amount,concat('Reversión de venta ',v_sale.id),v_sale.id,v_income.account_id,v_income.period_id)
          ON CONFLICT(sale_id) WHERE movement_type='sale_reversal' DO NOTHING;
      END IF;
      UPDATE installations SET status='cancelled' WHERE sale_id=v_sale.id AND status='pending';
      UPDATE warranties SET status='void' WHERE sale_item_id IN (SELECT id FROM sale_items WHERE sale_id=v_sale.id) AND status='active';
      v_sale_id:=v_sale.id;
    END IF;
    UPDATE inventory_reservations SET status='released' WHERE order_id=p_order AND status='active';
    UPDATE payment_transactions SET status=CASE WHEN p_resolution='TRANSFER_APPROVAL_ERROR' THEN 'cancelled' ELSE 'refunded' END WHERE id=v_payment.id;
    IF p_resolution='REFUND_STOCK_UNAVAILABLE' AND v_payment.provider='transfer' THEN
      PERFORM post_financial_pending(id) FROM financial_pending_postings
        WHERE payment_transaction_id=v_payment.id AND status='pending';
    END IF;
    PERFORM set_config('dcl.operation_source','order_resolution',TRUE);
    PERFORM set_config('dcl.operation_note',btrim(p_note),TRUE);
    PERFORM set_config('dcl.order_resolution',p_order::TEXT,TRUE);
    UPDATE orders SET status=CASE WHEN p_resolution='TRANSFER_APPROVAL_ERROR' THEN 'cancelled' ELSE 'refunded' END,
      operational_status='cancelled' WHERE id=p_order;
    PERFORM set_config('dcl.order_resolution','',TRUE);
  END IF;
  PERFORM set_config('dcl.operation_source','',TRUE);
  PERFORM set_config('dcl.operation_note','',TRUE);

  INSERT INTO order_resolutions(order_id,payment_transaction_id,sale_id,resolution_type,external_reference,note,idempotency_key)
    VALUES(p_order,v_payment.id,COALESCE(v_sale_id,v_payment.sale_id),p_resolution,
      NULLIF(btrim(COALESCE(p_external_reference,'')),''),btrim(p_note),p_idempotency_key)
    RETURNING id INTO v_resolution;
  IF p_resolution='COMPLETE_STOCK_UNAVAILABLE' THEN PERFORM enqueue_commercial_analytics('purchase_completed',p_order,p_analytics_environment); END IF;
  RETURN (SELECT to_jsonb(r) FROM order_resolutions r WHERE r.id=v_resolution);
END $$;
REVOKE ALL ON FUNCTION public.resolve_order(UUID,TEXT,TEXT,TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_order(UUID,TEXT,TEXT,TEXT,UUID,TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
