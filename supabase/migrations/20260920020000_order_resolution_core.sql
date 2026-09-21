BEGIN;

ALTER TABLE public.orders DROP CONSTRAINT orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK (status IN (
  'pending_payment','pending_manual_verification','paid','completed','rejected',
  'stock_unavailable','cancelled','refunded','refund_required'
));

CREATE TABLE public.order_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  payment_transaction_id UUID REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
  sale_id UUID REFERENCES public.sales(id) ON DELETE RESTRICT,
  resolution_type TEXT NOT NULL CHECK (resolution_type IN (
    'CANCEL_PENDING','REFUND_VERIFIED','TRANSFER_APPROVAL_ERROR',
    'COMPLETE_STOCK_UNAVAILABLE','REFUND_STOCK_UNAVAILABLE'
  )),
  external_reference TEXT,
  note TEXT NOT NULL,
  idempotency_key UUID NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'admin',
  actor TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(order_id,resolution_type)
);
CREATE UNIQUE INDEX order_resolutions_refund_reference_once ON public.order_resolutions(external_reference)
  WHERE resolution_type IN ('REFUND_VERIFIED','REFUND_STOCK_UNAVAILABLE');
CREATE INDEX order_resolutions_order_created_idx ON public.order_resolutions(order_id,created_at DESC);
ALTER TABLE public.order_resolutions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_resolutions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.order_resolutions TO service_role;

CREATE UNIQUE INDEX inventory_sale_reversal_product_once ON public.inventory_movements(reference_id,product_id)
  WHERE reference_type='sale_reversal';

-- A locally verified refund is terminal, including when an older payment webhook is retried.
CREATE OR REPLACE FUNCTION public.complete_mercadopago_order(p_order UUID,p_external_order TEXT,p_payment TEXT,p_amount NUMERIC,p_currency CHAR(3),p_status VARCHAR)
RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_order RECORD; v_transaction RECORD; v_item RECORD; v_product RECORD;
  v_sale UUID:=gen_random_uuid(); v_total NUMERIC(12,2):=0; v_now TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id=p_order AND payment_method IN ('mercadopago','card') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operacion externa invalida.'; END IF;
  SELECT * INTO STRICT v_transaction FROM payment_transactions WHERE order_id=p_order AND provider='mercadopago' FOR UPDATE;
  IF COALESCE(p_external_order,'')='' OR COALESCE(p_payment,'')='' OR p_amount IS NULL OR p_currency IS NULL OR p_status IS NULL
    OR v_transaction.external_order_id IS DISTINCT FROM p_external_order THEN RAISE EXCEPTION 'Operacion externa invalida.'; END IF;
  IF v_transaction.status='refunded' OR v_order.status='refunded' THEN RETURN v_transaction.sale_id; END IF;
  IF v_transaction.sale_id IS NOT NULL THEN RETURN v_transaction.sale_id; END IF;
  IF v_order.status='refund_required' THEN RETURN NULL; END IF;
  -- Never downgrade an already received payment, including paid-but-unfulfilled.
  IF v_transaction.status='approved' AND p_status<>'processed' THEN RETURN NULL; END IF;
  IF p_amount<>v_order.total OR p_currency<>v_order.currency THEN
    IF v_transaction.status<>'approved' THEN UPDATE payment_transactions SET status='error' WHERE id=v_transaction.id; END IF;
    RETURN NULL;
  END IF;
  IF p_status='processed' AND v_order.status='cancelled' AND v_order.operational_status='cancelled' THEN
    UPDATE payment_transactions SET status='approved',external_payment_id=p_payment,
      approved_at=COALESCE(approved_at,clock_timestamp()) WHERE id=v_transaction.id;
    UPDATE orders SET status='refund_required' WHERE id=p_order;
    INSERT INTO order_notes(order_id,note) VALUES(p_order,
      'Pago de Mercado Pago aprobado despues de cancelar el pedido. No se genero venta ni se desconto stock. Requiere devolucion externa verificada.');
    RETURN NULL;
  END IF;
  PERFORM p.id FROM products p WHERE p.id IN (SELECT product_id FROM order_items WHERE order_id=p_order) ORDER BY p.id FOR UPDATE;
  v_now:=clock_timestamp();
  IF p_status<>'processed' THEN
    IF p_status IN ('rejected','cancelled') THEN
      UPDATE payment_transactions SET status='rejected',external_payment_id=p_payment WHERE id=v_transaction.id;
      IF v_order.status NOT IN ('cancelled','stock_unavailable') THEN UPDATE orders SET status='rejected' WHERE id=p_order; END IF;
      UPDATE inventory_reservations SET status='released' WHERE order_id=p_order AND status='active';
    END IF;
    RETURN NULL;
  END IF;
  UPDATE payment_transactions SET status='approved',external_payment_id=p_payment,approved_at=COALESCE(approved_at,v_now) WHERE id=v_transaction.id;
  -- Strict late-payment policy: NO automatic re-reservation, even if stock is free.
  IF v_order.status<>'pending_payment' OR NOT EXISTS(SELECT 1 FROM order_items WHERE order_id=p_order) OR EXISTS (
    SELECT 1 FROM order_items i JOIN products p ON p.id=i.product_id
    LEFT JOIN inventory_reservations r ON r.order_id=i.order_id AND r.product_id=i.product_id
    WHERE i.order_id=p_order AND (r.id IS NULL OR r.status<>'active' OR r.expires_at<=v_now OR r.quantity<>i.quantity
      OR p.stock-i.quantity<COALESCE((SELECT SUM(other.quantity) FROM inventory_reservations other WHERE other.product_id=i.product_id AND other.order_id<>p_order AND other.status='active' AND other.expires_at>v_now),0))
  ) THEN
    UPDATE orders SET status='stock_unavailable' WHERE id=p_order;
    UPDATE inventory_reservations SET status='released' WHERE order_id=p_order AND status='active';
    IF v_order.status<>'stock_unavailable' OR v_transaction.status<>'approved' THEN
      INSERT INTO order_notes(order_id,note) VALUES(p_order,'Pago recibido sin reserva valida. No se genero venta ni se desconto stock. Requiere revision y eventual devolucion manual.');
    END IF;
    RETURN NULL;
  END IF;
  INSERT INTO sales(id,customer_id,status,notes,subtotal,total,payment_method) VALUES(v_sale,v_order.customer_id,'completed',concat('Pedido publico ',p_order),0,0,'mercadopago');
  UPDATE inventory_reservations SET status='consumed' WHERE order_id=p_order AND status='active';
  FOR v_item IN SELECT * FROM order_items WHERE order_id=p_order ORDER BY product_id LOOP
    SELECT * INTO v_product FROM products WHERE id=v_item.product_id;
    INSERT INTO sale_items(sale_id,product_id,product_name,quantity,unit_price,unit_cost,line_total) VALUES(v_sale,v_product.id,v_item.product_name,v_item.quantity,v_item.unit_price,v_product.cost_price,v_item.line_total);
    INSERT INTO inventory_movements(product_id,movement_type,quantity_delta,reason,reference_type,reference_id) VALUES(v_product.id,'venta',-v_item.quantity,'Venta de pedido publico','sale',v_sale::TEXT);
    v_total:=v_total+v_item.line_total;
  END LOOP;
  UPDATE sales SET subtotal=v_total,total=v_total WHERE id=v_sale;
  UPDATE orders SET status='completed' WHERE id=p_order;
  UPDATE payment_transactions SET sale_id=v_sale WHERE id=v_transaction.id;
  RETURN v_sale;
END $$;

-- Retain the normal operational guard; permit only a fully reconciled resolution transaction.
CREATE OR REPLACE FUNCTION public.guard_order_operations() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.operational_status IS DISTINCT FROM 'received' THEN RAISE EXCEPTION 'OPERATIONAL_INITIAL_STATE'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.order_number IS DISTINCT FROM OLD.order_number THEN RAISE EXCEPTION 'ORDER_NUMBER_IMMUTABLE'; END IF;
  IF NEW.operational_status IS NOT DISTINCT FROM OLD.operational_status THEN RETURN NEW; END IF;
  IF OLD.operational_status IN ('delivered','cancelled') THEN RAISE EXCEPTION 'OPERATIONAL_INVALID_TRANSITION'; END IF;
  PERFORM id FROM payment_transactions WHERE order_id=OLD.id ORDER BY id FOR UPDATE;
  PERFORM s.id FROM sales s WHERE s.id IN
    (SELECT sale_id FROM payment_transactions WHERE order_id=OLD.id) ORDER BY s.id FOR SHARE;
  IF NEW.operational_status='cancelled' THEN
    IF current_setting('dcl.order_resolution',TRUE)=OLD.id::TEXT
       AND NEW.status IN ('cancelled','refunded')
       AND EXISTS(SELECT 1 FROM payment_transactions t WHERE t.order_id=OLD.id
         AND t.status=CASE WHEN NEW.status='refunded' THEN 'refunded' ELSE 'cancelled' END
         AND (t.sale_id IS NULL OR EXISTS(SELECT 1 FROM sales s WHERE s.id=t.sale_id AND s.status='cancelled')))
       AND NOT EXISTS(SELECT 1 FROM payment_transactions t WHERE t.order_id=OLD.id
         AND (t.status IN ('pending','approved','error') OR (t.sale_id IS NOT NULL
           AND NOT EXISTS(SELECT 1 FROM sales s WHERE s.id=t.sale_id AND s.status='cancelled'))))
    THEN RETURN NEW; END IF;
    IF NEW.status IN ('paid','completed') OR EXISTS(
      SELECT 1 FROM payment_transactions WHERE order_id=OLD.id
      AND (status IN ('approved','refunded') OR sale_id IS NOT NULL)
    ) THEN RAISE EXCEPTION 'OPERATIONAL_FINANCIAL_REVERSAL_REQUIRED'; END IF;
    IF NEW.status NOT IN ('cancelled','rejected')
      OR NOT EXISTS(SELECT 1 FROM payment_transactions WHERE order_id=OLD.id)
      OR EXISTS(SELECT 1 FROM payment_transactions WHERE order_id=OLD.id AND status NOT IN ('cancelled','rejected','error'))
    THEN RAISE EXCEPTION 'OPERATIONAL_CLOSE_PAYMENT_FIRST'; END IF;
  ELSE
    IF NOT ((OLD.operational_status='received' AND NEW.operational_status='preparing')
      OR (OLD.operational_status='preparing' AND NEW.operational_status='ready')
      OR (OLD.operational_status='ready' AND NEW.operational_status='delivered'))
    THEN RAISE EXCEPTION 'OPERATIONAL_INVALID_TRANSITION'; END IF;
    IF NEW.status NOT IN ('paid','completed') OR NOT EXISTS(
      SELECT 1 FROM payment_transactions t JOIN sales s ON s.id=t.sale_id
      WHERE t.order_id=OLD.id AND t.status='approved' AND s.status='completed'
    ) THEN RAISE EXCEPTION 'OPERATIONAL_PAYMENT_REQUIRED'; END IF;
  END IF;
  RETURN NEW;
END $$;

-- Independent sales retain their existing cancellation route. Linked sales must use resolve_order.
CREATE OR REPLACE FUNCTION public.cancel_sale_with_reversal(p_sale_id UUID,p_reason TEXT DEFAULT '')
RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_sale RECORD; v_item RECORD; v_income RECORD;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id=p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada.' USING ERRCODE='23503'; END IF;
  IF EXISTS(SELECT 1 FROM payment_transactions WHERE sale_id=p_sale_id) THEN
    RAISE EXCEPTION 'ORDER_RESOLUTION_REQUIRED';
  END IF;
  IF v_sale.status='cancelled' THEN RETURN v_sale.id; END IF;
  IF v_sale.payment_method='mercadopago' THEN
    RAISE EXCEPTION 'La venta de Mercado Pago requiere confirmar el reintegro antes de anularla.' USING ERRCODE='23514';
  END IF;
  PERFORM p.id FROM products p WHERE p.id IN (SELECT product_id FROM sale_items WHERE sale_id=p_sale_id) ORDER BY p.id FOR UPDATE;
  FOR v_item IN SELECT product_id,SUM(quantity)::INTEGER AS quantity FROM sale_items WHERE sale_id=p_sale_id GROUP BY product_id ORDER BY product_id LOOP
    INSERT INTO inventory_movements(product_id,movement_type,quantity_delta,reason,reference_type,reference_id)
      VALUES(v_item.product_id,'ajuste',v_item.quantity,concat('Anulación de venta: ',COALESCE(NULLIF(btrim(p_reason),''),'sin detalle')),'sale_reversal',p_sale_id::TEXT);
  END LOOP;
  UPDATE sales SET status='cancelled',cancelled_at=clock_timestamp(),cancellation_reason=COALESCE(p_reason,'') WHERE id=p_sale_id;
  SELECT * INTO v_income FROM cash_movements WHERE sale_id=p_sale_id AND movement_type='sale_income' FOR UPDATE;
  IF FOUND THEN
    INSERT INTO cash_movements(movement_type,amount,description,sale_id,account_id,period_id)
      VALUES('sale_reversal',-v_income.amount,concat('Reversión de venta ',p_sale_id),p_sale_id,v_income.account_id,v_income.period_id)
      ON CONFLICT(sale_id) WHERE movement_type='sale_reversal' DO NOTHING;
  END IF;
  UPDATE installations SET status='cancelled' WHERE sale_id=p_sale_id AND status='pending';
  UPDATE warranties SET status='void' WHERE sale_item_id IN (SELECT id FROM sale_items WHERE sale_id=p_sale_id) AND status='active';
  RETURN p_sale_id;
END $$;

CREATE FUNCTION public.resolve_order(p_order UUID,p_resolution TEXT,p_external_reference TEXT,p_note TEXT,p_idempotency_key UUID)
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
      OR v_payment.provider<>'mercadopago' THEN RAISE EXCEPTION 'ORDER_RESOLUTION_INVALID_STATE'; END IF;
    PERFORM p.id FROM products p WHERE p.id IN (SELECT product_id FROM order_items WHERE order_id=p_order) ORDER BY p.id FOR UPDATE;
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
      VALUES(v_sale_id,v_order.customer_id,'completed',concat('Resolución de pedido ',p_order),0,0,'mercadopago');
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
        OR v_payment.provider<>'mercadopago' THEN
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
  RETURN (SELECT to_jsonb(r) FROM order_resolutions r WHERE r.id=v_resolution);
END $$;

REVOKE ALL ON FUNCTION public.resolve_order(UUID,TEXT,TEXT,TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_order(UUID,TEXT,TEXT,TEXT,UUID) TO service_role;

COMMIT;
