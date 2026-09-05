-- Reservas de inventario, declaracion de transferencia y notas internas.
-- Migracion local aditiva: NO ejecutar automaticamente contra entornos remotos.

CREATE TABLE IF NOT EXISTS public.inventory_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  product_id VARCHAR(64) NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 100),
  status VARCHAR(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','consumed','released','expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(order_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_product_active
  ON public.inventory_reservations(product_id, expires_at) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_order ON public.inventory_reservations(order_id);
ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.inventory_reservations TO service_role;

CREATE TABLE IF NOT EXISTS public.order_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  note VARCHAR(1000) NOT NULL CHECK (btrim(note) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_notes_order_created ON public.order_notes(order_id, created_at DESC);
ALTER TABLE public.order_notes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.order_notes TO service_role;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS transfer_declared_at TIMESTAMPTZ;

-- Backfill conservador: reserva pedidos pendientes existentes desde el momento
-- de aplicar la migracion. Si ya no hay disponibilidad, los marca para revision.
DO $$
DECLARE v_order RECORD; v_item RECORD; v_product RECORD; v_reserved INTEGER; v_ok BOOLEAN;
BEGIN
  FOR v_order IN SELECT * FROM orders WHERE status IN ('pending_payment','pending_manual_verification') ORDER BY created_at LOOP
    v_ok:=TRUE;
    FOR v_item IN SELECT * FROM order_items WHERE order_id=v_order.id LOOP
      v_product:=NULL;
      SELECT * INTO v_product FROM products WHERE id=v_item.product_id FOR UPDATE;
      SELECT COALESCE(SUM(quantity),0)::INTEGER INTO v_reserved FROM inventory_reservations WHERE product_id=v_item.product_id AND status='active';
      IF v_product.id IS NULL OR v_product.stock-v_reserved<v_item.quantity THEN v_ok:=FALSE; EXIT; END IF;
    END LOOP;
    IF v_ok THEN
      INSERT INTO inventory_reservations(order_id,product_id,quantity,expires_at)
      SELECT v_order.id,oi.product_id,oi.quantity,NOW()+CASE WHEN v_order.payment_method='transfer' THEN INTERVAL '48 hours' ELSE INTERVAL '30 minutes' END FROM order_items oi WHERE oi.order_id=v_order.id
      ON CONFLICT(order_id,product_id) DO NOTHING;
    ELSE
      UPDATE orders SET status='stock_unavailable' WHERE id=v_order.id;
    END IF;
  END LOOP;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_inventory_reservations BEFORE UPDATE ON public.inventory_reservations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.release_expired_inventory_reservations(p_product_id VARCHAR DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE inventory_reservations
     SET status='expired'
   WHERE status='active' AND expires_at<=NOW()
     AND (p_product_id IS NULL OR product_id=p_product_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.get_available_product_stock(p_product_id VARCHAR)
RETURNS INTEGER LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_stock INTEGER; v_reserved INTEGER;
BEGIN
  SELECT stock INTO v_stock FROM products WHERE id=p_product_id AND active FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  PERFORM release_expired_inventory_reservations(p_product_id);
  SELECT COALESCE(SUM(quantity),0)::INTEGER INTO v_reserved FROM inventory_reservations WHERE product_id=p_product_id AND status='active';
  RETURN GREATEST(v_stock-v_reserved,0);
END $$;

CREATE OR REPLACE FUNCTION public.create_public_order(p_name TEXT,p_phone TEXT,p_email TEXT,p_fulfillment VARCHAR,p_address TEXT,p_notes TEXT,p_method VARCHAR,p_items JSONB,p_key UUID)
RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_customer_id UUID; v_order_id UUID; v_existing UUID; v_item JSONB; v_product RECORD; v_quantity INT; v_total NUMERIC(12,2):=0; v_provider TEXT; v_reserved INTEGER; v_expires TIMESTAMPTZ;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_key::text,0));
  SELECT id INTO v_existing FROM orders WHERE idempotency_key=p_key;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  IF p_method NOT IN ('mercadopago','card','transfer') OR btrim(p_name)='' OR btrim(p_phone)='' OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ORDER_CREATION_ERROR'; END IF;
  v_order_id:=gen_random_uuid();
  v_expires:=NOW()+CASE WHEN p_method='transfer' THEN INTERVAL '48 hours' ELSE INTERVAL '30 minutes' END;
  SELECT id INTO v_customer_id FROM customers WHERE phone=btrim(p_phone) ORDER BY created_at LIMIT 1;
  IF v_customer_id IS NULL THEN INSERT INTO customers(full_name,phone,email) VALUES(btrim(p_name),btrim(p_phone),NULLIF(btrim(p_email),'')) RETURNING id INTO v_customer_id; END IF;
  INSERT INTO orders(id,customer_id,idempotency_key,fulfillment_method,shipping_address,notes,payment_method,status)
  VALUES(v_order_id,v_customer_id,p_key,p_fulfillment,CASE WHEN p_fulfillment='delivery' THEN NULLIF(btrim(p_address),'') END,COALESCE(p_notes,''),p_method,CASE WHEN p_method='transfer' THEN 'pending_manual_verification' ELSE 'pending_payment' END);
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF COALESCE(v_item->>'quantity','') !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_QUANTITY'; END IF;
    v_quantity:=(v_item->>'quantity')::INT;
    IF v_quantity>100 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_QUANTITY'; END IF;
    SELECT id,name,price,stock,active INTO v_product FROM products WHERE id=v_item->>'productId' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='PRODUCT_NOT_FOUND'; END IF;
    IF NOT v_product.active THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='PRODUCT_INACTIVE'; END IF;
    PERFORM release_expired_inventory_reservations(v_product.id);
    SELECT COALESCE(SUM(quantity),0)::INTEGER INTO v_reserved FROM inventory_reservations WHERE product_id=v_product.id AND status='active';
    IF v_product.stock-v_reserved<v_quantity THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='OUT_OF_STOCK'; END IF;
    INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price,line_total) VALUES(v_order_id,v_product.id,v_product.name,v_quantity,v_product.price,ROUND(v_product.price*v_quantity,2));
    INSERT INTO inventory_reservations(order_id,product_id,quantity,expires_at) VALUES(v_order_id,v_product.id,v_quantity,v_expires);
    v_total:=v_total+ROUND(v_product.price*v_quantity,2);
  END LOOP;
  UPDATE orders SET subtotal=v_total,total=v_total WHERE id=v_order_id;
  v_provider:=CASE WHEN p_method IN ('mercadopago','card') THEN 'mercadopago' ELSE 'transfer' END;
  INSERT INTO payment_transactions(order_id,provider,amount,currency,external_idempotency_key) VALUES(v_order_id,v_provider,v_total,'ARS',gen_random_uuid());
  RETURN v_order_id;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_public_order(p_order UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_order RECORD;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND OR v_order.status='completed' THEN RETURN FALSE; END IF;
  IF EXISTS(SELECT 1 FROM payment_transactions WHERE order_id=p_order AND status='approved') THEN RETURN FALSE; END IF;
  UPDATE orders SET status='cancelled' WHERE id=p_order;
  UPDATE payment_transactions SET status='cancelled' WHERE order_id=p_order AND status='pending';
  UPDATE inventory_reservations SET status='released' WHERE order_id=p_order AND status='active';
  RETURN TRUE;
END $$;

CREATE OR REPLACE FUNCTION public.complete_manual_transfer(p_order UUID)
RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_order RECORD; v_transaction RECORD; v_item RECORD; v_product RECORD; v_sale_id UUID:=gen_random_uuid(); v_total NUMERIC(12,2):=0;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id=p_order AND payment_method='transfer' FOR UPDATE;
  IF NOT FOUND OR v_order.status<>'pending_manual_verification' THEN RAISE EXCEPTION 'Pedido de transferencia no verificable.'; END IF;
  SELECT * INTO v_transaction FROM payment_transactions WHERE order_id=p_order AND provider='transfer' FOR UPDATE;
  IF v_transaction.sale_id IS NOT NULL THEN RETURN v_transaction.sale_id; END IF;
  IF v_order.transfer_declared_at IS NULL THEN RAISE EXCEPTION 'El cliente todavia no declaro la transferencia.'; END IF;
  FOR v_item IN SELECT * FROM order_items WHERE order_id=p_order LOOP
    SELECT * INTO v_product FROM products WHERE id=v_item.product_id FOR UPDATE;
    IF NOT EXISTS(SELECT 1 FROM inventory_reservations WHERE order_id=p_order AND product_id=v_item.product_id AND status='active' AND expires_at>NOW()) OR v_product.stock<v_item.quantity THEN RETURN NULL; END IF;
  END LOOP;
  INSERT INTO sales(id,customer_id,status,notes,subtotal,total,payment_method) VALUES(v_sale_id,v_order.customer_id,'completed',concat('Transferencia verificada. Pedido publico ',v_order.id),0,0,'transfer');
  FOR v_item IN SELECT * FROM order_items WHERE order_id=p_order LOOP
    SELECT * INTO v_product FROM products WHERE id=v_item.product_id FOR UPDATE;
    INSERT INTO sale_items(sale_id,product_id,product_name,quantity,unit_price,unit_cost,line_total) VALUES(v_sale_id,v_product.id,v_item.product_name,v_item.quantity,v_item.unit_price,v_product.cost_price,v_item.line_total);
    INSERT INTO inventory_movements(product_id,movement_type,quantity_delta,reason,reference_type,reference_id) VALUES(v_product.id,'venta',-v_item.quantity,'Venta por transferencia verificada','sale',v_sale_id::TEXT);
    v_total:=v_total+v_item.line_total;
  END LOOP;
  UPDATE inventory_reservations SET status='consumed' WHERE order_id=p_order AND status='active';
  UPDATE sales SET subtotal=v_total,total=v_total WHERE id=v_sale_id;
  UPDATE orders SET status='completed' WHERE id=p_order;
  UPDATE payment_transactions SET sale_id=v_sale_id,approved_at=COALESCE(approved_at,NOW()),status='approved' WHERE id=v_transaction.id;
  RETURN v_sale_id;
END $$;

-- Reemplaza la finalizacion MP conservando la validacion previa del webhook.
CREATE OR REPLACE FUNCTION public.complete_mercadopago_order(p_order UUID,p_external_order TEXT,p_payment TEXT,p_amount NUMERIC,p_currency CHAR(3),p_status VARCHAR)
RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_order RECORD; v_transaction RECORD; v_item RECORD; v_product RECORD; v_sale_id UUID:=gen_random_uuid(); v_total NUMERIC(12,2):=0;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id=p_order FOR UPDATE;
  SELECT * INTO v_transaction FROM payment_transactions WHERE order_id=p_order AND provider='mercadopago' FOR UPDATE;
  IF NOT FOUND OR (v_transaction.external_order_id IS NOT NULL AND v_transaction.external_order_id<>p_external_order) THEN RAISE EXCEPTION 'Operacion externa invalida.'; END IF;
  IF v_transaction.sale_id IS NOT NULL THEN RETURN v_transaction.sale_id; END IF;
  IF p_amount<>v_order.total OR p_currency<>v_order.currency THEN UPDATE payment_transactions SET status='error',external_order_id=p_external_order,external_payment_id=p_payment WHERE id=v_transaction.id; RETURN NULL; END IF;
  UPDATE payment_transactions SET external_order_id=p_external_order,external_payment_id=p_payment,status=CASE WHEN p_status='processed' THEN 'approved' WHEN p_status='rejected' THEN 'rejected' ELSE 'pending' END,approved_at=CASE WHEN p_status='processed' THEN COALESCE(approved_at,NOW()) ELSE approved_at END WHERE id=v_transaction.id;
  IF p_status<>'processed' THEN IF p_status='rejected' THEN UPDATE orders SET status='rejected' WHERE id=p_order; UPDATE inventory_reservations SET status='released' WHERE order_id=p_order AND status='active'; END IF; RETURN NULL; END IF;
  FOR v_item IN SELECT * FROM order_items WHERE order_id=p_order LOOP SELECT * INTO v_product FROM products WHERE id=v_item.product_id FOR UPDATE; IF v_product.stock<v_item.quantity THEN UPDATE orders SET status='stock_unavailable' WHERE id=p_order; RETURN NULL; END IF; END LOOP;
  INSERT INTO sales(id,customer_id,status,notes,subtotal,total,payment_method) VALUES(v_sale_id,v_order.customer_id,'completed',concat('Pedido publico ',v_order.id),0,0,'mercadopago');
  FOR v_item IN SELECT * FROM order_items WHERE order_id=p_order LOOP SELECT * INTO v_product FROM products WHERE id=v_item.product_id FOR UPDATE; INSERT INTO sale_items(sale_id,product_id,product_name,quantity,unit_price,unit_cost,line_total) VALUES(v_sale_id,v_product.id,v_item.product_name,v_item.quantity,v_item.unit_price,v_product.cost_price,v_item.line_total); INSERT INTO inventory_movements(product_id,movement_type,quantity_delta,reason,reference_type,reference_id) VALUES(v_product.id,'venta',-v_item.quantity,'Venta de pedido publico','sale',v_sale_id::TEXT); v_total:=v_total+v_item.line_total; END LOOP;
  UPDATE inventory_reservations SET status='consumed' WHERE order_id=p_order AND status='active';
  UPDATE sales SET subtotal=v_total,total=v_total WHERE id=v_sale_id; UPDATE orders SET status='completed' WHERE id=p_order; UPDATE payment_transactions SET sale_id=v_sale_id,status='approved',approved_at=COALESCE(approved_at,NOW()) WHERE id=v_transaction.id;
  RETURN v_sale_id;
END $$;

-- Las ventas internas descuentan solamente stock no reservado. Se conserva la firma vigente.
CREATE OR REPLACE FUNCTION public.available_stock_for_admin_sale(p_product_id VARCHAR)
RETURNS INTEGER LANGUAGE plpgsql SET search_path=public AS $$ BEGIN RETURN get_available_product_stock(p_product_id); END $$;

CREATE OR REPLACE FUNCTION public.create_sale_with_inventory(
  p_customer_id UUID,p_customer_vehicle_id UUID,p_notes TEXT,p_items JSONB,
  p_create_installation BOOLEAN DEFAULT FALSE,p_payment_method VARCHAR DEFAULT 'cash',
  p_idempotency_key UUID DEFAULT NULL,p_installation JSONB DEFAULT '{}'::JSONB,p_warranties JSONB DEFAULT '[]'::JSONB
) RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_sale_id UUID:=gen_random_uuid();v_existing UUID;v_item JSONB;v_product RECORD;v_product_id VARCHAR(64);v_quantity INTEGER;v_reserved INTEGER;v_line_total NUMERIC(12,2);v_subtotal NUMERIC(12,2):=0;v_sale_item_id UUID;v_warranty JSONB;v_days INTEGER;v_starts TIMESTAMPTZ;
BEGIN
  IF p_payment_method NOT IN ('cash','transfer','mercadopago','debit','credit','other') THEN RAISE EXCEPTION 'Forma de pago invalida.' USING ERRCODE='23514'; END IF;
  IF p_idempotency_key IS NOT NULL THEN SELECT id INTO v_existing FROM sales WHERE idempotency_key=p_idempotency_key; IF v_existing IS NOT NULL THEN RETURN v_existing; END IF; END IF;
  IF NOT EXISTS(SELECT 1 FROM customers WHERE id=p_customer_id) THEN RAISE EXCEPTION 'El cliente no existe.' USING ERRCODE='23503'; END IF;
  IF p_customer_vehicle_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM customer_vehicles WHERE id=p_customer_vehicle_id AND customer_id=p_customer_id) THEN RAISE EXCEPTION 'El vehiculo no pertenece al cliente.' USING ERRCODE='23503'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'La venta debe incluir productos.' USING ERRCODE='23514'; END IF;
  INSERT INTO sales(id,customer_id,customer_vehicle_id,notes,payment_method,idempotency_key) VALUES(v_sale_id,p_customer_id,p_customer_vehicle_id,COALESCE(p_notes,''),p_payment_method,p_idempotency_key) ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id INTO v_existing;
  IF v_existing IS NULL THEN SELECT id INTO v_existing FROM sales WHERE idempotency_key=p_idempotency_key; RETURN v_existing; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_product_id:=NULLIF(TRIM(v_item->>'productId'),'');v_quantity:=(v_item->>'quantity')::INTEGER;
    IF v_product_id IS NULL OR v_quantity IS NULL OR v_quantity<1 OR v_quantity>100 THEN RAISE EXCEPTION 'Item invalido.' USING ERRCODE='23514'; END IF;
    SELECT id,name,price,cost_price,stock,warranty_days INTO v_product FROM products WHERE id=v_product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Producto inexistente.' USING ERRCODE='23514'; END IF;
    PERFORM release_expired_inventory_reservations(v_product.id);
    SELECT COALESCE(SUM(quantity),0)::INTEGER INTO v_reserved FROM inventory_reservations WHERE product_id=v_product.id AND status='active';
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

REVOKE ALL ON FUNCTION public.release_expired_inventory_reservations(VARCHAR) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_available_product_stock(VARCHAR) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_public_order(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.release_expired_inventory_reservations(VARCHAR),public.get_available_product_stock(VARCHAR),public.cancel_public_order(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.create_sale_with_inventory(UUID,UUID,TEXT,JSONB,BOOLEAN,VARCHAR,UUID,JSONB,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_sale_with_inventory(UUID,UUID,TEXT,JSONB,BOOLEAN,VARCHAR,UUID,JSONB,JSONB) TO service_role;
