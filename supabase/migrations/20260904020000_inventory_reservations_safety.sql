-- Corrective migration. PREPARED LOCALLY ONLY: do not apply without approval.
-- No backfill, DELETE, TRUNCATE or product data repair. Function drops are exact,
-- without CASCADE. All DDL is transactional; application requires this migration.
BEGIN;

REVOKE ALL ON public.inventory_reservations, public.order_notes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.inventory_reservations TO service_role;
GRANT SELECT, INSERT ON public.order_notes TO service_role;
ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;
-- Widen only: pending_manual_verification needs 27 characters. No data loss.
ALTER TABLE public.orders ALTER COLUMN status TYPE VARCHAR(32);

-- Remove obsolete implementations; calls using defaults resolve to the one
-- nine-argument implementation. No alternative physical-stock-only sale RPC.
DROP FUNCTION IF EXISTS public.create_sale_with_inventory(UUID,UUID,TEXT,JSONB,BOOLEAN);
DROP FUNCTION IF EXISTS public.create_sale_with_inventory(UUID,UUID,TEXT,JSONB,BOOLEAN,VARCHAR,UUID);

CREATE OR REPLACE FUNCTION public.normalize_inventory_items(p_items JSONB)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE v_item JSONB; v_result JSONB;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_item->'productId') IS DISTINCT FROM 'string'
       OR length(btrim(v_item->>'productId')) NOT BETWEEN 1 AND 64
       OR COALESCE(v_item->>'quantity','') !~ '^[1-9][0-9]{0,2}$' THEN
      RAISE EXCEPTION 'INVALID_QUANTITY';
    END IF;
    IF (v_item->>'quantity')::INTEGER > 100 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) i GROUP BY btrim(i->>'productId') HAVING SUM((i->>'quantity')::INTEGER)>100) THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('productId',id,'quantity',quantity) ORDER BY id)
    INTO v_result FROM (SELECT btrim(i->>'productId') AS id,SUM((i->>'quantity')::INTEGER) AS quantity FROM jsonb_array_elements(p_items) i GROUP BY btrim(i->>'productId')) n;
  RETURN v_result;
END $$;

-- Pure read, one MVCC snapshot; expiration does not depend on a cleanup job.
CREATE OR REPLACE FUNCTION public.get_available_product_stock(p_product_id VARCHAR)
RETURNS INTEGER LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT COALESCE((SELECT CASE WHEN p.active THEN GREATEST(p.stock-COALESCE((
    SELECT SUM(r.quantity) FROM inventory_reservations r
    WHERE r.product_id=p.id AND r.status='active' AND r.expires_at>statement_timestamp()
  ),0),0)::INTEGER ELSE 0 END FROM products p WHERE p.id=p_product_id),0);
$$;

CREATE OR REPLACE FUNCTION public.available_stock_for_admin_sale(p_product_id VARCHAR)
RETURNS INTEGER LANGUAGE sql STABLE SET search_path=public AS $$ SELECT get_available_product_stock(p_product_id); $$;

-- Product rows are always locked in the same order, BEFORE reservation rows.
CREATE OR REPLACE FUNCTION public.release_expired_inventory_reservations(p_product_id VARCHAR DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_count INTEGER; v_cutoff TIMESTAMPTZ:=clock_timestamp();
BEGIN
  PERFORM p.id FROM products p WHERE (p_product_id IS NULL OR p.id=p_product_id)
    AND EXISTS(SELECT 1 FROM inventory_reservations r WHERE r.product_id=p.id AND r.status='active' AND r.expires_at<=v_cutoff)
    ORDER BY p.id FOR UPDATE;
  UPDATE inventory_reservations SET status='expired' WHERE status='active' AND expires_at<=v_cutoff
    AND (p_product_id IS NULL OR product_id=p_product_id);
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END $$;

-- Protect adjustments, direct stock updates and ALL inventory movement paths.
-- Order fulfillment consumes its own reservations while holding product locks,
-- before creating movements; reservations of other orders stay protected.
CREATE OR REPLACE FUNCTION public.guard_product_reserved_stock()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_reserved BIGINT;
BEGIN
  IF NEW.stock < OLD.stock THEN
    SELECT COALESCE(SUM(quantity),0) INTO v_reserved FROM inventory_reservations
      WHERE product_id=OLD.id AND status='active' AND expires_at>clock_timestamp();
    IF NEW.stock<0 OR NEW.stock<v_reserved THEN
      RAISE EXCEPTION 'Stock comprometido por reservas vigentes.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER guard_product_reserved_stock BEFORE UPDATE OF stock ON public.products
FOR EACH ROW EXECUTE FUNCTION public.guard_product_reserved_stock();

CREATE OR REPLACE FUNCTION public.create_public_order(p_name TEXT,p_phone TEXT,p_email TEXT,p_fulfillment VARCHAR,p_address TEXT,p_notes TEXT,p_method VARCHAR,p_items JSONB,p_key UUID)
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
  SELECT id INTO v_customer FROM customers WHERE phone=btrim(p_phone) ORDER BY created_at,id LIMIT 1;
  IF v_customer IS NULL THEN INSERT INTO customers(full_name,phone,email) VALUES(btrim(p_name),btrim(p_phone),NULLIF(btrim(p_email),'')) RETURNING id INTO v_customer; END IF;
  INSERT INTO orders(id,customer_id,idempotency_key,request_fingerprint,fulfillment_method,shipping_address,notes,payment_method,status)
    VALUES(v_order,v_customer,p_key,v_fingerprint,p_fulfillment,CASE WHEN p_fulfillment='delivery' THEN btrim(p_address) END,
    COALESCE(btrim(p_notes),''),p_method,CASE WHEN p_method='transfer' THEN 'pending_manual_verification' ELSE 'pending_payment' END);
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
  RETURN v_order;
END $$;

-- A single source for the payment deadline, including legacy reservations.
-- The one-minute margin is subtracted from the REAL earliest reservation expiry.
CREATE OR REPLACE FUNCTION public.get_order_payment_window(p_order UUID)
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT MIN(r.expires_at)-INTERVAL '1 minute'
  FROM orders o JOIN order_items i ON i.order_id=o.id
  LEFT JOIN inventory_reservations r ON r.order_id=i.order_id AND r.product_id=i.product_id
  WHERE o.id=p_order AND o.status='pending_payment' AND o.payment_method IN ('mercadopago','card')
    AND EXISTS(SELECT 1 FROM payment_transactions t WHERE t.order_id=o.id AND t.provider='mercadopago' AND t.status='pending' AND t.sale_id IS NULL)
  HAVING count(*)>0 AND bool_and(r.id IS NOT NULL AND r.status='active' AND r.quantity=i.quantity
    AND r.expires_at>statement_timestamp()+INTERVAL '1 minute');
$$;

CREATE OR REPLACE FUNCTION public.cancel_public_order(p_order UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_order RECORD;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND OR v_order.status IN ('paid','completed') THEN RETURN FALSE; END IF;
  IF EXISTS(SELECT 1 FROM payment_transactions WHERE order_id=p_order AND status='approved') THEN RETURN FALSE; END IF;
  PERFORM p.id FROM products p WHERE p.id IN (SELECT product_id FROM inventory_reservations WHERE order_id=p_order) ORDER BY p.id FOR UPDATE;
  UPDATE orders SET status='cancelled' WHERE id=p_order;
  UPDATE payment_transactions SET status='cancelled' WHERE order_id=p_order AND status='pending';
  UPDATE inventory_reservations SET status='released' WHERE order_id=p_order AND status='active';
  RETURN TRUE;
END $$;

CREATE OR REPLACE FUNCTION public.declare_manual_transfer(p_order UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_order RECORD;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id=p_order AND payment_method='transfer' FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF v_order.status='completed' AND v_order.transfer_declared_at IS NOT NULL THEN RETURN TRUE; END IF;
  IF v_order.status<>'pending_manual_verification' OR NOT EXISTS(SELECT 1 FROM order_items WHERE order_id=p_order)
    OR EXISTS(SELECT 1 FROM order_items i LEFT JOIN inventory_reservations r ON r.order_id=i.order_id AND r.product_id=i.product_id
    WHERE i.order_id=p_order AND (r.id IS NULL OR r.status<>'active' OR r.quantity<>i.quantity OR r.expires_at<=clock_timestamp())) THEN RETURN FALSE; END IF;
  IF v_order.transfer_declared_at IS NOT NULL THEN RETURN TRUE; END IF;
  UPDATE orders SET transfer_declared_at=clock_timestamp() WHERE id=p_order;
  RETURN TRUE;
END $$;

CREATE OR REPLACE FUNCTION public.complete_manual_transfer(p_order UUID)
RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_order RECORD; v_transaction RECORD; v_item RECORD; v_product RECORD;
  v_sale UUID:=gen_random_uuid(); v_total NUMERIC(12,2):=0; v_now TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id=p_order AND payment_method='transfer' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido de transferencia no verificable.'; END IF;
  SELECT * INTO STRICT v_transaction FROM payment_transactions WHERE order_id=p_order AND provider='transfer' FOR UPDATE;
  IF v_transaction.sale_id IS NOT NULL THEN RETURN v_transaction.sale_id; END IF;
  IF v_order.status<>'pending_manual_verification' OR v_order.transfer_declared_at IS NULL THEN RAISE EXCEPTION 'Pedido de transferencia no verificable.'; END IF;
  PERFORM p.id FROM products p WHERE p.id IN (SELECT product_id FROM order_items WHERE order_id=p_order) ORDER BY p.id FOR UPDATE;
  v_now:=clock_timestamp();
  IF NOT EXISTS(SELECT 1 FROM order_items WHERE order_id=p_order) OR EXISTS (
    SELECT 1 FROM order_items i JOIN products p ON p.id=i.product_id
    LEFT JOIN inventory_reservations r ON r.order_id=i.order_id AND r.product_id=i.product_id
    WHERE i.order_id=p_order AND (r.id IS NULL OR r.status<>'active' OR r.expires_at<=v_now OR r.quantity<>i.quantity
      OR p.stock-i.quantity<COALESCE((SELECT SUM(other.quantity) FROM inventory_reservations other WHERE other.product_id=i.product_id AND other.order_id<>p_order AND other.status='active' AND other.expires_at>v_now),0))
  ) THEN RETURN NULL; END IF;
  INSERT INTO sales(id,customer_id,status,notes,subtotal,total,payment_method) VALUES(v_sale,v_order.customer_id,'completed',concat('Transferencia verificada. Pedido ',p_order),0,0,'transfer');
  UPDATE inventory_reservations SET status='consumed' WHERE order_id=p_order AND status='active';
  FOR v_item IN SELECT * FROM order_items WHERE order_id=p_order ORDER BY product_id LOOP
    SELECT * INTO v_product FROM products WHERE id=v_item.product_id;
    INSERT INTO sale_items(sale_id,product_id,product_name,quantity,unit_price,unit_cost,line_total) VALUES(v_sale,v_product.id,v_item.product_name,v_item.quantity,v_item.unit_price,v_product.cost_price,v_item.line_total);
    INSERT INTO inventory_movements(product_id,movement_type,quantity_delta,reason,reference_type,reference_id) VALUES(v_product.id,'venta',-v_item.quantity,'Venta por transferencia verificada','sale',v_sale::TEXT);
    v_total:=v_total+v_item.line_total;
  END LOOP;
  UPDATE sales SET subtotal=v_total,total=v_total WHERE id=v_sale;
  UPDATE orders SET status='completed' WHERE id=p_order;
  UPDATE payment_transactions SET sale_id=v_sale,status='approved',approved_at=COALESCE(approved_at,v_now) WHERE id=v_transaction.id;
  RETURN v_sale;
END $$;

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
  IF v_transaction.sale_id IS NOT NULL THEN RETURN v_transaction.sale_id; END IF;
  -- Never downgrade an already received payment, including paid-but-unfulfilled.
  IF v_transaction.status='approved' AND p_status<>'processed' THEN RETURN NULL; END IF;
  IF p_amount<>v_order.total OR p_currency<>v_order.currency THEN
    IF v_transaction.status<>'approved' THEN UPDATE payment_transactions SET status='error' WHERE id=v_transaction.id; END IF;
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



-- Filtering, counting and pagination share the same snapshot and predicates.
CREATE OR REPLACE FUNCTION public.list_admin_orders(p_q TEXT DEFAULT '',p_status TEXT DEFAULT 'all',p_since TIMESTAMPTZ DEFAULT NULL,p_page INTEGER DEFAULT 1,p_limit INTEGER DEFAULT 50)
RETURNS JSONB LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE v_result JSONB;
BEGIN
  IF p_page<1 OR p_limit NOT BETWEEN 1 AND 100 OR p_status NOT IN ('all','attention','pending','transfer','paid','delivery','completed','cancelled') THEN RAISE EXCEPTION 'Filtro invalido.'; END IF;
  WITH filtered AS MATERIALIZED (
    SELECT o.* FROM orders o WHERE (p_since IS NULL OR o.created_at>=p_since)
    AND CASE p_status
      WHEN 'attention' THEN o.status IN ('pending_manual_verification','stock_unavailable')
      WHEN 'pending' THEN o.status IN ('pending_payment','pending_manual_verification')
      WHEN 'transfer' THEN o.payment_method='transfer' AND o.status='pending_manual_verification'
      WHEN 'paid' THEN o.status IN ('paid','completed')
      WHEN 'delivery' THEN o.fulfillment_method='delivery' AND o.status IN ('paid','completed')
      WHEN 'completed' THEN o.status='completed'
      WHEN 'cancelled' THEN o.status IN ('cancelled','rejected') ELSE TRUE END
    AND (COALESCE(btrim(p_q),'')='' OR strpos(lower(o.id::TEXT),lower(btrim(p_q)))>0
      OR EXISTS(SELECT 1 FROM customers c WHERE c.id=o.customer_id AND (strpos(lower(c.full_name),lower(btrim(p_q)))>0 OR strpos(lower(COALESCE(c.phone,'')),lower(btrim(p_q)))>0))
      OR EXISTS(SELECT 1 FROM order_items i WHERE i.order_id=o.id AND strpos(lower(i.product_name),lower(btrim(p_q)))>0))
  ), page_rows AS (SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT p_limit OFFSET (p_page-1)::BIGINT*p_limit)
  SELECT jsonb_build_object('data',COALESCE((SELECT jsonb_agg(
    (to_jsonb(o)-'request_fingerprint'-'idempotency_key') || jsonb_build_object(
      'customer',(SELECT jsonb_build_object('full_name',c.full_name,'phone',c.phone,'email',c.email) FROM customers c WHERE c.id=o.customer_id),
      'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('product_name',i.product_name,'quantity',i.quantity,'line_total',i.line_total) ORDER BY i.product_id) FROM order_items i WHERE i.order_id=o.id),'[]'::JSONB),
      'payment',(SELECT jsonb_build_object('sale_id',t.sale_id,'status',t.status,'provider',t.provider,'external_order_id',t.external_order_id) FROM payment_transactions t WHERE t.order_id=o.id ORDER BY t.created_at DESC,t.id DESC LIMIT 1),
      'internalNotes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',n.id,'note',n.note,'created_at',n.created_at) ORDER BY n.created_at DESC,n.id DESC) FROM order_notes n WHERE n.order_id=o.id),'[]'::JSONB)
    ) ORDER BY o.created_at DESC,o.id DESC) FROM page_rows o),'[]'::JSONB),
    'pagination',jsonb_build_object('page',p_page,'limit',p_limit,'total',(SELECT count(*) FROM filtered))) INTO v_result;
  RETURN v_result;
END $$;

-- Sale reversal also updates multiple products through inventory triggers.
CREATE OR REPLACE FUNCTION public.cancel_sale_with_reversal(p_sale_id UUID, p_reason TEXT DEFAULT '')
RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_sale RECORD; v_item RECORD;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id=p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada.' USING ERRCODE='23503'; END IF;
  IF v_sale.status='cancelled' THEN RETURN v_sale.id; END IF;
  IF v_sale.payment_method='mercadopago' THEN
    RAISE EXCEPTION 'La venta de Mercado Pago requiere confirmar el reintegro antes de anularla.' USING ERRCODE='23514';
  END IF;

  PERFORM p.id FROM products p WHERE p.id IN (SELECT product_id FROM sale_items WHERE sale_id=v_sale.id) ORDER BY p.id FOR UPDATE;
  FOR v_item IN SELECT * FROM sale_items WHERE sale_id=v_sale.id ORDER BY product_id LOOP
    INSERT INTO inventory_movements(product_id,movement_type,quantity_delta,reason,reference_type,reference_id)
    VALUES(v_item.product_id,'ajuste',v_item.quantity,concat('Anulación de venta: ', COALESCE(NULLIF(btrim(p_reason),''),'sin detalle')),'sale_reversal',v_sale.id::TEXT);
  END LOOP;
  UPDATE sales SET status='cancelled',cancelled_at=NOW(),cancellation_reason=COALESCE(p_reason,'') WHERE id=v_sale.id;
  -- Sólo efectivo modifica el saldo físico de caja. La anulación de otros medios
  -- conserva su trazabilidad en ventas, sin simular un movimiento de efectivo.
  IF v_sale.payment_method='cash' THEN
    INSERT INTO cash_movements(movement_type,amount,description,sale_id)
    VALUES('sale_reversal',-v_sale.total,concat('Reversión de venta ',v_sale.id,CASE WHEN btrim(COALESCE(p_reason,''))='' THEN '' ELSE ': '||btrim(p_reason) END),v_sale.id)
    ON CONFLICT (sale_id) WHERE movement_type='sale_reversal' DO NOTHING;
  END IF;
  UPDATE installations SET status='cancelled' WHERE sale_id=v_sale.id AND status='pending';
  UPDATE warranties SET status='void' WHERE sale_item_id IN (SELECT id FROM sale_items WHERE sale_id=v_sale.id) AND status='active';
  RETURN v_sale.id;
END $$;

-- Explicit ACLs, including helpers: no reliance on inherited/default grants.
REVOKE ALL ON FUNCTION public.normalize_inventory_items(JSONB),public.get_available_product_stock(VARCHAR),public.available_stock_for_admin_sale(VARCHAR),
  public.release_expired_inventory_reservations(VARCHAR),public.guard_product_reserved_stock(),
  public.create_public_order(TEXT,TEXT,TEXT,VARCHAR,TEXT,TEXT,VARCHAR,JSONB,UUID),public.get_order_payment_window(UUID),
  public.cancel_sale_with_reversal(UUID,TEXT),public.cancel_public_order(UUID),public.declare_manual_transfer(UUID),public.complete_manual_transfer(UUID),
  public.complete_mercadopago_order(UUID,TEXT,TEXT,NUMERIC,CHAR,VARCHAR),
  public.create_sale_with_inventory(UUID,UUID,TEXT,JSONB,BOOLEAN,VARCHAR,UUID,JSONB,JSONB),
  public.list_admin_orders(TEXT,TEXT,TIMESTAMPTZ,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.normalize_inventory_items(JSONB),public.get_available_product_stock(VARCHAR),public.available_stock_for_admin_sale(VARCHAR),
  public.release_expired_inventory_reservations(VARCHAR),public.create_public_order(TEXT,TEXT,TEXT,VARCHAR,TEXT,TEXT,VARCHAR,JSONB,UUID),
  public.get_order_payment_window(UUID),public.cancel_sale_with_reversal(UUID,TEXT),public.cancel_public_order(UUID),public.declare_manual_transfer(UUID),public.complete_manual_transfer(UUID),
  public.complete_mercadopago_order(UUID,TEXT,TEXT,NUMERIC,CHAR,VARCHAR),
  public.create_sale_with_inventory(UUID,UUID,TEXT,JSONB,BOOLEAN,VARCHAR,UUID,JSONB,JSONB),
  public.list_admin_orders(TEXT,TEXT,TIMESTAMPTZ,INTEGER,INTEGER) TO service_role;
COMMIT;
