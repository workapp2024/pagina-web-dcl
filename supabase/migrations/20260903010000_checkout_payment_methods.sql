-- Configuración pública de transferencia y estados de verificación manual.
-- Migración local: no ejecutar automáticamente contra ningún entorno remoto.
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS transfer_alias VARCHAR(120) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS transfer_cbu_cvu VARCHAR(40) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS transfer_holder VARCHAR(160) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS transfer_institution VARCHAR(160) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS transfer_instructions TEXT NOT NULL DEFAULT '';

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending_payment','pending_manual_verification','paid','completed','rejected','stock_unavailable','cancelled'));

CREATE OR REPLACE FUNCTION public.create_public_order(p_name TEXT,p_phone TEXT,p_email TEXT,p_fulfillment VARCHAR,p_address TEXT,p_notes TEXT,p_method VARCHAR,p_items JSONB,p_key UUID) RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_customer_id UUID; v_order_id UUID:=gen_random_uuid(); v_item JSONB; v_product RECORD; v_quantity INT; v_total NUMERIC(12,2):=0; v_provider TEXT;
BEGIN
  -- Serializa exclusivamente solicitudes con la misma clave. Esto evita que
  -- dos transacciones concurrentes creen clientes o pedidos paralelos antes
  -- de que la restricción UNIQUE de orders.idempotency_key sea visible.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_key::text, 0));
  SELECT id INTO v_order_id FROM orders WHERE idempotency_key=p_key;
  IF FOUND THEN RETURN v_order_id; END IF;
  IF p_method NOT IN ('mercadopago','card','transfer') OR btrim(p_name)='' OR btrim(p_phone)='' OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'Pedido inválido.'; END IF;
  SELECT id INTO v_customer_id FROM customers WHERE phone=btrim(p_phone) ORDER BY created_at LIMIT 1;
  IF v_customer_id IS NULL THEN INSERT INTO customers(full_name,phone,email) VALUES(btrim(p_name),btrim(p_phone),NULLIF(btrim(p_email),'')) RETURNING id INTO v_customer_id; END IF;
  INSERT INTO orders(id,customer_id,idempotency_key,fulfillment_method,shipping_address,notes,payment_method,status)
  VALUES(v_order_id,v_customer_id,p_key,p_fulfillment,CASE WHEN p_fulfillment='delivery' THEN NULLIF(btrim(p_address),'') END,COALESCE(p_notes,''),p_method,CASE WHEN p_method='transfer' THEN 'pending_manual_verification' ELSE 'pending_payment' END)
  ON CONFLICT (idempotency_key) DO NOTHING;
  IF NOT FOUND THEN
    SELECT id INTO v_order_id FROM orders WHERE idempotency_key=p_key;
    IF v_order_id IS NULL THEN RAISE EXCEPTION 'No se pudo recuperar el pedido idempotente.'; END IF;
    RETURN v_order_id;
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_quantity:=(v_item->>'quantity')::INT;
    SELECT id,name,price,stock INTO v_product FROM products WHERE id=v_item->>'productId' AND active FOR UPDATE;
    IF NOT FOUND OR v_quantity IS NULL OR v_quantity<1 OR v_product.stock<v_quantity THEN RAISE EXCEPTION 'Stock insuficiente.'; END IF;
    INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price,line_total) VALUES(v_order_id,v_product.id,v_product.name,v_quantity,v_product.price,ROUND(v_product.price*v_quantity,2));
    v_total:=v_total+ROUND(v_product.price*v_quantity,2);
  END LOOP;
  UPDATE orders SET subtotal=v_total,total=v_total WHERE id=v_order_id;
  v_provider:=CASE WHEN p_method IN ('mercadopago','card') THEN 'mercadopago' ELSE 'transfer' END;
  INSERT INTO payment_transactions(order_id,provider,amount,currency,external_idempotency_key) VALUES(v_order_id,v_provider,v_total,'ARS',gen_random_uuid());
  RETURN v_order_id;
END $$;
REVOKE ALL ON FUNCTION public.create_public_order(TEXT,TEXT,TEXT,VARCHAR,TEXT,TEXT,VARCHAR,JSONB,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_order(TEXT,TEXT,TEXT,VARCHAR,TEXT,TEXT,VARCHAR,JSONB,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_manual_transfer(p_order UUID) RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_order RECORD; v_transaction RECORD; v_item RECORD; v_product RECORD; v_sale_id UUID:=gen_random_uuid(); v_total NUMERIC(12,2):=0;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id=p_order AND payment_method='transfer' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido de transferencia inválido.'; END IF;
  SELECT * INTO v_transaction FROM payment_transactions WHERE order_id=p_order AND provider='transfer' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transacción inválida.'; END IF;
  IF v_order.status<>'pending_manual_verification' THEN RAISE EXCEPTION 'El pedido no está pendiente de verificación manual.'; END IF;
  IF v_transaction.sale_id IS NOT NULL THEN RETURN v_transaction.sale_id; END IF;
  FOR v_item IN SELECT * FROM order_items WHERE order_id=v_order.id LOOP SELECT * INTO v_product FROM products WHERE id=v_item.product_id FOR UPDATE; IF v_product.stock<v_item.quantity THEN UPDATE orders SET status='stock_unavailable' WHERE id=v_order.id; RETURN NULL; END IF; END LOOP;
  INSERT INTO sales(id,customer_id,status,notes,subtotal,total,payment_method) VALUES(v_sale_id,v_order.customer_id,'completed',concat('Transferencia verificada. Pedido público ',v_order.id),0,0,'transfer');
  FOR v_item IN SELECT * FROM order_items WHERE order_id=v_order.id LOOP SELECT * INTO v_product FROM products WHERE id=v_item.product_id FOR UPDATE; INSERT INTO sale_items(sale_id,product_id,product_name,quantity,unit_price,unit_cost,line_total) VALUES(v_sale_id,v_product.id,v_item.product_name,v_item.quantity,v_item.unit_price,v_product.cost_price,v_item.line_total); INSERT INTO inventory_movements(product_id,movement_type,quantity_delta,reason,reference_type,reference_id) VALUES(v_product.id,'venta',-v_item.quantity,'Venta por transferencia verificada','sale',v_sale_id::TEXT); v_total:=v_total+v_item.line_total; END LOOP;
  UPDATE sales SET subtotal=v_total,total=v_total WHERE id=v_sale_id;
  UPDATE orders SET status='completed' WHERE id=v_order.id;
  UPDATE payment_transactions SET sale_id=v_sale_id,approved_at=COALESCE(approved_at,NOW()),status='approved' WHERE id=v_transaction.id;
  RETURN v_sale_id;
END $$;
REVOKE ALL ON FUNCTION public.complete_manual_transfer(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_manual_transfer(UUID) TO service_role;
