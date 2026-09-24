-- Local migration only. Apply separately after review, before publishing the receipt UI.
-- No backfill: unexpected historical orders keep NULL snapshots.
BEGIN;

ALTER TABLE public.orders
  ADD COLUMN customer_name_snapshot VARCHAR(160),
  ADD COLUMN customer_phone_snapshot VARCHAR(50);

CREATE FUNCTION public.guard_order_customer_snapshots() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.customer_name_snapshot IS DISTINCT FROM OLD.customer_name_snapshot
    OR NEW.customer_phone_snapshot IS DISTINCT FROM OLD.customer_phone_snapshot THEN
    RAISE EXCEPTION 'ORDER_CUSTOMER_SNAPSHOT_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_order_customer_snapshots
  BEFORE UPDATE OF customer_name_snapshot,customer_phone_snapshot ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_customer_snapshots();
REVOKE ALL ON FUNCTION public.guard_order_customer_snapshots() FROM PUBLIC,anon,authenticated;

-- Exact latest 3A definition; only the orders INSERT gains the two snapshots.
-- Retry returns above that INSERT. Fingerprint, reservations and outbox unchanged.
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
REVOKE ALL ON FUNCTION public.create_public_order(TEXT,TEXT,TEXT,VARCHAR,TEXT,TEXT,VARCHAR,JSONB,UUID,JSONB,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_order(TEXT,TEXT,TEXT,VARCHAR,TEXT,TEXT,VARCHAR,JSONB,UUID,JSONB,TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
