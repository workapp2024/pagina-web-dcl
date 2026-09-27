-- A1: local only. No backfill, commercial data updates or refund changes.
BEGIN;

-- Returns the current usable period, keeping its configuration stable until commit.
-- This is the single readiness rule for admission and automatic posting.
CREATE FUNCTION public.financial_ready_period() RETURNS UUID
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_period UUID;
BEGIN
  PERFORM 1 FROM financial_activation WHERE singleton AND activated_at<=clock_timestamp() FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM id FROM financial_periods WHERE status='open' ORDER BY id FOR SHARE;
  IF (SELECT count(*) FROM financial_periods WHERE status='open')<>1 THEN RETURN NULL; END IF;
  SELECT id INTO v_period FROM financial_periods WHERE status='open'
    AND starts_at<=clock_timestamp() AND ends_at IS NULL AND closed_at IS NULL;
  IF v_period IS NULL THEN RETURN NULL; END IF;
  PERFORM id FROM financial_accounts WHERE id IN ('cash','mercadopago') ORDER BY id FOR SHARE;
  IF (SELECT count(*) FROM financial_accounts WHERE id IN ('cash','mercadopago') AND active)<>2 THEN RETURN NULL; END IF;
  RETURN v_period;
END $$;

CREATE FUNCTION public.financial_income_account(p_method TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT CASE p_method WHEN 'cash' THEN 'cash' WHEN 'transfer' THEN 'mercadopago'
    WHEN 'mercadopago' THEN 'mercadopago' ELSE NULL END;
$$;

CREATE TABLE public.financial_pending_postings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_type TEXT NOT NULL CHECK(operation_type IN ('sale_income','payment_received')),
  sale_id UUID UNIQUE REFERENCES public.sales(id) ON DELETE RESTRICT,
  order_id UUID REFERENCES public.orders(id) ON DELETE RESTRICT,
  payment_transaction_id UUID UNIQUE REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
  -- Target identifier deliberately has no FK: a missing account must not erase a payment.
  account_id TEXT CHECK(account_id IN ('cash','mercadopago')),
  amount NUMERIC(12,2) NOT NULL CHECK(amount>0),
  currency TEXT NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  reason TEXT NOT NULL CHECK(reason IN ('awaiting_posting','finance_not_ready','account_unknown',
    'payment_without_sale','source_inconsistent','posting_failed','source_cancelled','posted')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','posted','cancelled')),
  reference_key TEXT NOT NULL UNIQUE,
  cash_movement_id UUID UNIQUE REFERENCES public.cash_movements(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  resolved_at TIMESTAMPTZ,
  CHECK(sale_id IS NOT NULL OR payment_transaction_id IS NOT NULL),
  CHECK((payment_transaction_id IS NULL AND order_id IS NULL AND reference_key='sale:'||sale_id::TEXT)
    OR (payment_transaction_id IS NOT NULL AND order_id IS NOT NULL AND reference_key='payment:'||payment_transaction_id::TEXT)),
  CHECK((status='pending' AND resolved_at IS NULL AND cash_movement_id IS NULL)
    OR (status='posted' AND resolved_at IS NOT NULL AND cash_movement_id IS NOT NULL AND sale_id IS NOT NULL)
    OR (status='cancelled' AND resolved_at IS NOT NULL AND cash_movement_id IS NULL))
);
CREATE INDEX financial_postings_pending_idx ON public.financial_pending_postings(created_at,id) WHERE status='pending';
CREATE INDEX financial_postings_order_idx ON public.financial_pending_postings(order_id) WHERE order_id IS NOT NULL;
ALTER TABLE public.financial_pending_postings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_pending_postings FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.financial_pending_postings TO service_role;

-- A1 protects new sale incomes, including direct service-role inserts.
-- Existing reversal/refund behavior is deliberately left for A4.
CREATE FUNCTION public.guard_sale_income_period() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_period UUID;
BEGIN
  v_period:=financial_ready_period();
  IF v_period IS NULL OR NEW.period_id IS DISTINCT FROM v_period THEN
    RAISE EXCEPTION 'FINANCIAL_CURRENT_PERIOD_REQUIRED';
  END IF;
  IF NEW.account_id IS NULL OR NOT EXISTS(SELECT 1 FROM financial_accounts WHERE id=NEW.account_id AND active) THEN
    RAISE EXCEPTION 'FINANCIAL_ACCOUNT_REQUIRED';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_sale_income_period BEFORE INSERT ON public.cash_movements
FOR EACH ROW WHEN (NEW.movement_type='sale_income') EXECUTE FUNCTION public.guard_sale_income_period();
REVOKE ALL ON FUNCTION public.guard_sale_income_period() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_sale_income_period() TO service_role;

-- Only an existing durable posting can be retried. This cannot backfill arbitrary sales.
CREATE FUNCTION public.post_financial_pending(p_posting UUID) RETURNS TEXT
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_entry RECORD; v_payment public.payment_transactions%ROWTYPE; v_sale public.sales%ROWTYPE; v_income RECORD;
  v_period UUID; v_movement UUID;
BEGIN
  SELECT * INTO v_entry FROM financial_pending_postings WHERE id=p_posting;
  IF NOT FOUND THEN RAISE EXCEPTION 'FINANCIAL_POSTING_NOT_FOUND'; END IF;
  -- Same commercial lock order as resolution RPCs; never hold a posting while
  -- waiting for its order/payment/sale to be resolved by another transaction.
  IF v_entry.order_id IS NOT NULL THEN PERFORM 1 FROM orders WHERE id=v_entry.order_id FOR UPDATE; END IF;
  IF v_entry.payment_transaction_id IS NOT NULL THEN
    SELECT * INTO v_payment FROM payment_transactions WHERE id=v_entry.payment_transaction_id FOR UPDATE;
    IF v_payment.sale_id IS NOT NULL THEN
      SELECT * INTO v_sale FROM sales WHERE id=v_payment.sale_id FOR UPDATE;
    END IF;
  ELSIF v_entry.sale_id IS NOT NULL THEN
    SELECT * INTO v_sale FROM sales WHERE id=v_entry.sale_id FOR UPDATE;
  END IF;
  SELECT * INTO v_entry FROM financial_pending_postings WHERE id=p_posting FOR UPDATE;
  IF v_entry.status<>'pending' THEN RETURN v_entry.status; END IF;
  IF v_entry.payment_transaction_id IS NOT NULL THEN
    IF v_payment.status IN ('cancelled','refunded') THEN
      UPDATE financial_pending_postings SET status='cancelled',reason='source_cancelled',resolved_at=clock_timestamp() WHERE id=p_posting;
      RETURN 'cancelled';
    END IF;
    IF v_payment.status<>'approved' OR v_payment.amount<>v_entry.amount OR v_payment.currency<>v_entry.currency
      OR v_payment.order_id<>v_entry.order_id THEN
      UPDATE financial_pending_postings SET reason='source_inconsistent' WHERE id=p_posting;
      RETURN 'pending';
    END IF;
    IF v_payment.sale_id IS NULL THEN
      UPDATE financial_pending_postings SET reason='payment_without_sale' WHERE id=p_posting;
      RETURN 'pending';
    END IF;
    UPDATE financial_pending_postings SET sale_id=v_payment.sale_id,operation_type='sale_income' WHERE id=p_posting;
  END IF;
  IF v_sale.status='cancelled' THEN
    UPDATE financial_pending_postings SET status='cancelled',reason='source_cancelled',resolved_at=clock_timestamp() WHERE id=p_posting;
    RETURN 'cancelled';
  END IF;
  IF v_sale.id IS NULL OR v_sale.status<>'completed' OR v_sale.total<>v_entry.amount OR v_entry.currency<>'ARS' THEN
    UPDATE financial_pending_postings SET reason='source_inconsistent' WHERE id=p_posting;
    RETURN 'pending';
  END IF;
  -- Never acknowledge or create a second income on retries.
  SELECT * INTO v_income FROM cash_movements WHERE sale_id=v_sale.id AND movement_type='sale_income';
  IF FOUND THEN
    IF v_income.amount<>v_entry.amount OR v_income.account_id IS DISTINCT FROM v_entry.account_id THEN
      UPDATE financial_pending_postings SET reason='source_inconsistent' WHERE id=p_posting;
      RETURN 'pending';
    END IF;
    UPDATE financial_pending_postings SET status='posted',reason='posted',cash_movement_id=v_income.id,resolved_at=clock_timestamp() WHERE id=p_posting;
    RETURN 'posted';
  END IF;
  IF v_entry.account_id IS NULL THEN
    UPDATE financial_pending_postings SET reason='account_unknown' WHERE id=p_posting;
    RETURN 'pending';
  END IF;
  -- Catch failures of accounting only. The durable pending row and the commercial
  -- evidence live outside this subtransaction. No provider or Analytics calls.
  BEGIN
    v_period:=financial_ready_period();
    IF v_period IS NULL THEN
      UPDATE financial_pending_postings SET reason='finance_not_ready' WHERE id=p_posting;
      RETURN 'pending';
    END IF;
    INSERT INTO cash_movements(movement_type,amount,description,sale_id,account_id,period_id)
      VALUES('sale_income',v_entry.amount,concat('Ingreso por venta ',v_sale.id),v_sale.id,v_entry.account_id,v_period)
      RETURNING id INTO v_movement;
    UPDATE financial_pending_postings SET status='posted',reason='posted',cash_movement_id=v_movement,resolved_at=clock_timestamp() WHERE id=p_posting;
  EXCEPTION WHEN OTHERS THEN
    UPDATE financial_pending_postings SET reason='posting_failed' WHERE id=p_posting;
    RETURN 'pending';
  END;
  RETURN 'posted';
END $$;

-- Runs after the entire commercial RPC, when sale/payment links are complete.
-- Both triggers converge on the same reference key for a public operation.
CREATE FUNCTION public.capture_financial_posting(p_sale UUID,p_payment UUID) RETURNS VOID
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_sale public.sales%ROWTYPE; v_payment public.payment_transactions%ROWTYPE; v_key TEXT; v_account TEXT; v_amount NUMERIC;
  v_currency TEXT:='ARS'; v_order UUID; v_id UUID; v_sale_id UUID:=p_sale;
BEGIN
  IF p_payment IS NOT NULL THEN
    SELECT * INTO v_payment FROM payment_transactions WHERE id=p_payment;
    IF NOT FOUND OR v_payment.status<>'approved' THEN RETURN; END IF;
    v_sale_id:=v_payment.sale_id;
  ELSIF p_sale IS NOT NULL THEN
    SELECT * INTO v_payment FROM payment_transactions WHERE sale_id=p_sale;
    IF FOUND THEN
      IF v_payment.status<>'approved' THEN RETURN; END IF;
      p_payment:=v_payment.id;
    END IF;
  END IF;
  IF v_sale_id IS NOT NULL THEN
    SELECT * INTO v_sale FROM sales WHERE id=v_sale_id;
    IF NOT FOUND OR v_sale.status<>'completed' OR v_sale.total<=0 THEN RETURN; END IF;
    v_amount:=v_sale.total; v_account:=financial_income_account(v_sale.payment_method);
  END IF;
  IF p_payment IS NOT NULL THEN
    v_key:='payment:'||p_payment::TEXT; v_order:=v_payment.order_id;
    v_amount:=v_payment.amount; v_currency:=v_payment.currency;
    IF v_sale_id IS NULL THEN
      SELECT financial_income_account(CASE WHEN payment_method='card' THEN 'mercadopago' ELSE payment_method END)
        INTO v_account FROM orders WHERE id=v_order;
    END IF;
  ELSE v_key:='sale:'||v_sale_id::TEXT; END IF;
  INSERT INTO financial_pending_postings(operation_type,sale_id,order_id,payment_transaction_id,account_id,amount,currency,reason,reference_key)
    VALUES(CASE WHEN v_sale_id IS NULL THEN 'payment_received' ELSE 'sale_income' END,
      v_sale_id,v_order,p_payment,v_account,v_amount,v_currency,'awaiting_posting',v_key)
    ON CONFLICT(reference_key) DO NOTHING;
  SELECT id INTO v_id FROM financial_pending_postings WHERE reference_key=v_key;
  PERFORM post_financial_pending(v_id);
END $$;

CREATE OR REPLACE FUNCTION public.record_cash_sale_income() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  -- Metadata-only updates must never backfill historical sales.
  IF TG_OP='UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.total IS NOT DISTINCT FROM OLD.total THEN RETURN NEW; END IF;
  END IF;
  PERFORM capture_financial_posting(NEW.id,NULL);
  RETURN NEW;
END $$;
DROP TRIGGER record_cash_sale_income_after_total ON public.sales;
CREATE CONSTRAINT TRIGGER record_cash_sale_income_after_total AFTER INSERT OR UPDATE ON public.sales
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
WHEN (NEW.status='completed' AND NEW.total>0) EXECUTE FUNCTION public.record_cash_sale_income();

CREATE FUNCTION public.record_approved_payment_finance() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.sale_id IS NOT DISTINCT FROM OLD.sale_id THEN RETURN NEW; END IF;
  END IF;
  PERFORM capture_financial_posting(NULL,NEW.id);
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER record_approved_payment_finance AFTER INSERT OR UPDATE ON public.payment_transactions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
WHEN (NEW.status='approved') EXECUTE FUNCTION public.record_approved_payment_finance();

REVOKE ALL ON FUNCTION public.financial_ready_period(),public.financial_income_account(TEXT),
  public.post_financial_pending(UUID),public.capture_financial_posting(UUID,UUID),
  public.record_cash_sale_income(),public.record_approved_payment_finance() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.financial_ready_period(),public.financial_income_account(TEXT),
  public.post_financial_pending(UUID),public.capture_financial_posting(UUID,UUID),
  public.record_cash_sale_income(),public.record_approved_payment_finance() TO service_role;

-- New-operation admission definitions follow. Only readiness/account guards are
-- added after existing-key recovery; reservation, stock and Analytics stay intact.

CREATE OR REPLACE FUNCTION public.create_sale_with_inventory(
  p_customer_id UUID,p_customer_vehicle_id UUID,p_notes TEXT,p_items JSONB,
  p_create_installation BOOLEAN DEFAULT FALSE,p_payment_method VARCHAR DEFAULT 'cash',
  p_idempotency_key UUID DEFAULT NULL,p_installation JSONB DEFAULT '{}'::JSONB,p_warranties JSONB DEFAULT '[]'::JSONB
) RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_sale_id UUID:=gen_random_uuid();v_existing UUID;v_item JSONB;v_product RECORD;v_product_id VARCHAR(64);v_quantity INTEGER;v_reserved INTEGER;v_line_total NUMERIC(12,2);v_subtotal NUMERIC(12,2):=0;v_sale_item_id UUID;v_warranty JSONB;v_days INTEGER;v_starts TIMESTAMPTZ;
BEGIN
  p_items:=normalize_inventory_items(p_items);
  IF p_idempotency_key IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::TEXT,1)); END IF;
  IF p_payment_method NOT IN ('cash','transfer','mercadopago','debit','credit','other') THEN RAISE EXCEPTION 'Forma de pago invalida.' USING ERRCODE='23514'; END IF;
  IF p_idempotency_key IS NOT NULL THEN SELECT id INTO v_existing FROM sales WHERE idempotency_key=p_idempotency_key; IF v_existing IS NOT NULL THEN RETURN v_existing; END IF; END IF;
  IF financial_ready_period() IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_READY'; END IF;
  IF financial_income_account(p_payment_method) IS NULL THEN RAISE EXCEPTION 'FINANCIAL_ACCOUNT_REQUIRED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM customers WHERE id=p_customer_id) THEN RAISE EXCEPTION 'El cliente no existe.' USING ERRCODE='23503'; END IF;
  IF p_customer_vehicle_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM customer_vehicles WHERE id=p_customer_vehicle_id AND customer_id=p_customer_id) THEN RAISE EXCEPTION 'El vehiculo no pertenece al cliente.' USING ERRCODE='23503'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'La venta debe incluir productos.' USING ERRCODE='23514'; END IF;
  PERFORM p.id FROM products p WHERE p.id IN (SELECT i->>'productId' FROM jsonb_array_elements(p_items) i) ORDER BY p.id FOR UPDATE;
  INSERT INTO sales(id,customer_id,customer_vehicle_id,notes,payment_method,idempotency_key) VALUES(v_sale_id,p_customer_id,p_customer_vehicle_id,COALESCE(p_notes,''),p_payment_method,p_idempotency_key) ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id INTO v_existing;
  IF v_existing IS NULL THEN SELECT id INTO v_existing FROM sales WHERE idempotency_key=p_idempotency_key; RETURN v_existing; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_product_id:=NULLIF(TRIM(v_item->>'productId'),'');v_quantity:=(v_item->>'quantity')::INTEGER;
    IF v_product_id IS NULL OR v_quantity IS NULL OR v_quantity<1 OR v_quantity>100 THEN RAISE EXCEPTION 'Item invalido.' USING ERRCODE='23514'; END IF;
    SELECT id,name,price,cost_price,stock,warranty_days,active INTO v_product FROM products WHERE id=v_product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Producto inexistente.' USING ERRCODE='23514'; END IF;
    IF NOT v_product.active THEN RAISE EXCEPTION 'PRODUCT_INACTIVE'; END IF;
    SELECT COALESCE(SUM(quantity),0)::INTEGER INTO v_reserved FROM inventory_reservations WHERE product_id=v_product.id AND status='active' AND expires_at>clock_timestamp();
    IF v_product.stock-v_reserved<v_quantity THEN RAISE EXCEPTION 'Producto sin stock disponible; existen unidades reservadas.' USING ERRCODE='23514'; END IF;
    v_line_total:=ROUND(v_product.price*v_quantity,2);
    INSERT INTO sale_items(sale_id,product_id,product_name,quantity,unit_price,unit_cost,line_total) VALUES(v_sale_id,v_product.id,v_product.name,v_quantity,v_product.price,v_product.cost_price,v_line_total) RETURNING id INTO v_sale_item_id;
    INSERT INTO inventory_movements(product_id,movement_type,quantity_delta,reason,reference_type,reference_id) VALUES(v_product.id,'venta',-v_quantity,'Venta registrada','sale',v_sale_id::TEXT);
    v_subtotal:=v_subtotal+v_line_total;v_warranty:=NULL;
    SELECT value INTO v_warranty FROM jsonb_array_elements(p_warranties) WHERE value->>'productId'=v_product.id LIMIT 1;
    IF v_warranty IS NOT NULL AND COALESCE((v_warranty->>'enabled')::BOOLEAN,FALSE) THEN v_days:=COALESCE(NULLIF(v_warranty->>'days','')::INTEGER,v_product.warranty_days);v_starts:=COALESCE(NULLIF(v_warranty->>'startsAt','')::TIMESTAMPTZ,NOW());IF v_days BETWEEN 1 AND 3650 THEN INSERT INTO warranties(sale_item_id,customer_id,customer_vehicle_id,starts_at,expires_at,notes) VALUES(v_sale_item_id,p_customer_id,p_customer_vehicle_id,v_starts,v_starts+make_interval(days=>v_days),LEFT(COALESCE(v_warranty->>'notes',''),500));END IF;END IF;
  END LOOP;
  UPDATE sales SET subtotal=v_subtotal,total=v_subtotal WHERE id=v_sale_id;
  IF p_create_installation THEN INSERT INTO installations(sale_id,customer_vehicle_id,status,scheduled_at,notes,location,contact_phone,work_type,estimated_difficulty,assigned_technician) VALUES(v_sale_id,p_customer_vehicle_id,'pending',NULLIF(p_installation->>'scheduledAt','')::TIMESTAMPTZ,LEFT(COALESCE(p_installation->>'notes',''),1000),NULLIF(LEFT(p_installation->>'location',300),''),NULLIF(LEFT(p_installation->>'contactPhone',50),''),NULLIF(LEFT(p_installation->>'workType',120),''),NULLIF(p_installation->>'difficulty',''),NULLIF(LEFT(p_installation->>'technician',120),''));END IF;
  RETURN v_sale_id;
END $$;

CREATE OR REPLACE FUNCTION public.create_public_order(p_name TEXT,p_phone TEXT,p_email TEXT,p_fulfillment VARCHAR,p_address TEXT,p_notes TEXT,p_method VARCHAR,p_items JSONB,p_key UUID,p_analytics_context JSONB DEFAULT NULL,p_analytics_environment TEXT DEFAULT 'preview')
RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_customer UUID; v_order UUID:=gen_random_uuid(); v_existing RECORD;
  v_item JSONB; v_product RECORD; v_quantity INTEGER; v_total NUMERIC(12,2):=0;
  v_reserved BIGINT; v_expires TIMESTAMPTZ; v_items JSONB; v_fingerprint TEXT;
BEGIN
  v_items:=normalize_inventory_items(p_items);
  IF p_key IS NULL OR p_method IS NULL OR p_method NOT IN ('mercadopago','card','transfer')
     OR COALESCE(btrim(p_name),'')='' OR COALESCE(btrim(p_phone),'')=''
     OR p_fulfillment IS NULL OR p_fulfillment NOT IN ('pickup','delivery')
     OR (p_fulfillment='delivery' AND COALESCE(btrim(p_address),'')='') THEN RAISE EXCEPTION 'ORDER_CREATION_ERROR'; END IF;
  v_fingerprint:=encode(sha256(convert_to(jsonb_build_object('items',v_items,'method',p_method,
    'name',btrim(p_name),'phone',btrim(p_phone),'email',COALESCE(btrim(p_email),''),
    'fulfillment',p_fulfillment,'address',CASE WHEN p_fulfillment='delivery' THEN btrim(p_address) ELSE '' END,
    'notes',COALESCE(btrim(p_notes),''))::TEXT,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_key::TEXT,0));
  SELECT * INTO v_existing FROM orders WHERE idempotency_key=p_key;
  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    IF v_existing.status NOT IN ('pending_payment','pending_manual_verification') OR EXISTS (
      SELECT 1 FROM order_items i LEFT JOIN inventory_reservations r ON r.order_id=i.order_id AND r.product_id=i.product_id
      WHERE i.order_id=v_existing.id AND (r.id IS NULL OR r.status<>'active' OR r.expires_at<=clock_timestamp() OR r.quantity<>i.quantity)
    ) THEN RAISE EXCEPTION 'RESERVATION_EXPIRED'; END IF;
    RETURN v_existing.id;
  END IF;
  IF financial_ready_period() IS NULL THEN RAISE EXCEPTION 'FINANCE_NOT_READY'; END IF;
  IF p_method='transfer' AND NOT EXISTS(SELECT 1 FROM site_settings WHERE id=1
    AND (COALESCE(btrim(transfer_alias),'')<>'' OR COALESCE(btrim(transfer_cbu_cvu),'')<>'')
    AND COALESCE(btrim(transfer_holder),'')<>'' AND COALESCE(btrim(transfer_institution),'')<>'') THEN
    RAISE EXCEPTION 'TRANSFER_NOT_CONFIGURED';
  END IF;
  PERFORM p.id FROM products p WHERE p.id IN (SELECT i->>'productId' FROM jsonb_array_elements(v_items) i) ORDER BY p.id FOR UPDATE;
  v_expires:=clock_timestamp()+CASE WHEN p_method='transfer' THEN INTERVAL '48 hours' ELSE INTERVAL '30 minutes' END;
  SELECT id INTO v_customer FROM customers WHERE phone=btrim(p_phone) ORDER BY created_at,id LIMIT 1 FOR UPDATE;
  IF v_customer IS NULL THEN
    INSERT INTO customers(full_name,phone,email) VALUES(btrim(p_name),btrim(p_phone),NULLIF(btrim(p_email),'')) RETURNING id INTO v_customer;
  ELSE
    UPDATE customers SET archived_at=NULL WHERE id=v_customer AND archived_at IS NOT NULL;
  END IF;
  INSERT INTO orders(id,customer_id,idempotency_key,request_fingerprint,fulfillment_method,shipping_address,notes,payment_method,status,customer_name_snapshot,customer_phone_snapshot)
    VALUES(v_order,v_customer,p_key,v_fingerprint,p_fulfillment,CASE WHEN p_fulfillment='delivery' THEN btrim(p_address) END,
    COALESCE(btrim(p_notes),''),p_method,CASE WHEN p_method='transfer' THEN 'pending_manual_verification' ELSE 'pending_payment' END,btrim(p_name),btrim(p_phone));
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_quantity:=(v_item->>'quantity')::INTEGER;
    SELECT * INTO v_product FROM products WHERE id=v_item->>'productId';
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
    IF NOT v_product.active THEN RAISE EXCEPTION 'PRODUCT_INACTIVE'; END IF;
    IF v_product.price IS NULL OR v_product.price<=0 THEN RAISE EXCEPTION 'PRICE_ERROR'; END IF;
    SELECT COALESCE(SUM(quantity),0) INTO v_reserved FROM inventory_reservations
      WHERE product_id=v_product.id AND status='active' AND expires_at>clock_timestamp();
    IF v_product.stock-v_reserved<v_quantity THEN RAISE EXCEPTION 'OUT_OF_STOCK'; END IF;
    INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price,line_total)
      VALUES(v_order,v_product.id,v_product.name,v_quantity,v_product.price,ROUND(v_product.price*v_quantity,2));
    INSERT INTO inventory_reservations(order_id,product_id,quantity,expires_at) VALUES(v_order,v_product.id,v_quantity,v_expires);
    v_total:=v_total+ROUND(v_product.price*v_quantity,2);
  END LOOP;
  UPDATE orders SET subtotal=v_total,total=v_total WHERE id=v_order;
  INSERT INTO payment_transactions(order_id,provider,amount,currency,external_idempotency_key)
    VALUES(v_order,CASE WHEN p_method='transfer' THEN 'transfer' ELSE 'mercadopago' END,v_total,'ARS',gen_random_uuid());
  PERFORM enqueue_commercial_analytics('order_created',v_order,p_analytics_environment,p_analytics_context);
  RETURN v_order;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
