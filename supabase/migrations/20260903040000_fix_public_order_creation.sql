-- Corrige create_public_order aplicada en 20260903010000: SELECT INTO dejaba
-- v_order_id en NULL cuando no existía una orden idempotente previa.
CREATE OR REPLACE FUNCTION public.create_public_order(p_name TEXT,p_phone TEXT,p_email TEXT,p_fulfillment VARCHAR,p_address TEXT,p_notes TEXT,p_method VARCHAR,p_items JSONB,p_key UUID) RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_customer_id UUID; v_order_id UUID; v_existing_order_id UUID; v_item JSONB; v_product RECORD; v_quantity INT; v_total NUMERIC(12,2):=0; v_provider TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_key::text, 0));
  SELECT id INTO v_existing_order_id FROM orders WHERE idempotency_key=p_key;
  IF FOUND THEN RETURN v_existing_order_id; END IF;
  IF p_method NOT IN ('mercadopago','card','transfer') OR btrim(p_name)='' OR btrim(p_phone)='' OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ORDER_CREATION_ERROR'; END IF;
  v_order_id:=gen_random_uuid();
  SELECT id INTO v_customer_id FROM customers WHERE phone=btrim(p_phone) ORDER BY created_at LIMIT 1;
  IF v_customer_id IS NULL THEN INSERT INTO customers(full_name,phone,email) VALUES(btrim(p_name),btrim(p_phone),NULLIF(btrim(p_email),'')) RETURNING id INTO v_customer_id; END IF;
  INSERT INTO orders(id,customer_id,idempotency_key,fulfillment_method,shipping_address,notes,payment_method,status)
  VALUES(v_order_id,v_customer_id,p_key,p_fulfillment,CASE WHEN p_fulfillment='delivery' THEN NULLIF(btrim(p_address),'') END,COALESCE(p_notes,''),p_method,CASE WHEN p_method='transfer' THEN 'pending_manual_verification' ELSE 'pending_payment' END)
  ON CONFLICT (idempotency_key) DO NOTHING;
  IF NOT FOUND THEN SELECT id INTO v_existing_order_id FROM orders WHERE idempotency_key=p_key; IF v_existing_order_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ORDER_CREATION_ERROR'; END IF; RETURN v_existing_order_id; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF COALESCE(v_item->>'quantity','') !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_QUANTITY'; END IF;
    v_quantity:=(v_item->>'quantity')::INT;
    IF v_quantity<1 OR v_quantity>100 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_QUANTITY'; END IF;
    SELECT id,name,price,stock,active INTO v_product FROM products WHERE id=v_item->>'productId' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='PRODUCT_NOT_FOUND'; END IF;
    IF NOT v_product.active THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='PRODUCT_INACTIVE'; END IF;
    IF v_product.price IS NULL OR v_product.price<0 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='PRICE_ERROR'; END IF;
    IF v_product.stock<v_quantity THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='OUT_OF_STOCK'; END IF;
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
