-- Pedidos/pagos públicos y Mercado Pago Checkout API (Orders).
-- Esta migración sólo crea estructuras nuevas y funciones; no altera tablas existentes ni elimina datos.

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  idempotency_key UUID NOT NULL UNIQUE, status VARCHAR(24) NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','paid','completed','stock_unavailable','cancelled')),
  fulfillment_method VARCHAR(16) NOT NULL CHECK (fulfillment_method IN ('pickup','delivery')), shipping_address TEXT, notes TEXT NOT NULL DEFAULT '', payment_method VARCHAR(20) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'ARS', subtotal NUMERIC(12,2) NOT NULL DEFAULT 0, total NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT, product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name VARCHAR(255) NOT NULL, quantity INTEGER NOT NULL CHECK (quantity > 0), unit_price NUMERIC(12,2) NOT NULL, line_total NUMERIC(12,2) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT, sale_id UUID REFERENCES sales(id) ON DELETE RESTRICT,
  provider VARCHAR(24) NOT NULL, status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled','refunded','error')),
  external_order_id VARCHAR(160), external_payment_id VARCHAR(160), external_idempotency_key UUID NOT NULL UNIQUE,
  amount NUMERIC(12,2) NOT NULL, currency CHAR(3) NOT NULL DEFAULT 'ARS', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), approved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_external_order_uq ON payment_transactions(provider, external_order_id) WHERE external_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_external_payment_uq ON payment_transactions(provider, external_payment_id) WHERE external_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);

-- update_updated_at_column() existe en el esquema base. No se reemplazan triggers existentes.
DO $$ BEGIN CREATE TRIGGER set_updated_at_orders BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TRIGGER set_updated_at_payment_transactions BEFORE UPDATE ON payment_transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE orders, order_items, payment_transactions TO service_role;

-- Crea snapshots de producto/precio y exactamente una transacción local por pedido idempotente.
CREATE OR REPLACE FUNCTION create_public_order(p_name TEXT,p_phone TEXT,p_email TEXT,p_fulfillment VARCHAR,p_address TEXT,p_notes TEXT,p_method VARCHAR,p_items JSONB,p_key UUID) RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_customer_id UUID; v_order_id UUID:=gen_random_uuid(); v_item JSONB; v_product RECORD; v_quantity INT; v_total NUMERIC(12,2):=0;
BEGIN
  SELECT id INTO v_customer_id FROM orders WHERE idempotency_key=p_key;
  IF v_customer_id IS NOT NULL THEN RETURN v_customer_id; END IF;
  IF btrim(p_name)='' OR btrim(p_phone)='' OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'Pedido inválido.'; END IF;
  SELECT id INTO v_customer_id FROM customers WHERE phone=btrim(p_phone) ORDER BY created_at LIMIT 1;
  IF v_customer_id IS NULL THEN INSERT INTO customers(full_name,phone,email) VALUES(btrim(p_name),btrim(p_phone),NULLIF(btrim(p_email),'')) RETURNING id INTO v_customer_id; END IF;
  INSERT INTO orders(id,customer_id,idempotency_key,fulfillment_method,shipping_address,notes,payment_method)
  VALUES(v_order_id,v_customer_id,p_key,p_fulfillment,CASE WHEN p_fulfillment='delivery' THEN NULLIF(btrim(p_address),'') END,COALESCE(p_notes,''),p_method) ON CONFLICT(idempotency_key) DO NOTHING;
  IF NOT FOUND THEN SELECT id INTO v_order_id FROM orders WHERE idempotency_key=p_key; RETURN v_order_id; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_quantity:=(v_item->>'quantity')::INT;
    SELECT id,name,price,stock INTO v_product FROM products WHERE id=v_item->>'productId' AND active FOR UPDATE;
    IF NOT FOUND OR v_quantity IS NULL OR v_quantity<1 OR v_product.stock<v_quantity THEN RAISE EXCEPTION 'Stock insuficiente.'; END IF;
    INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price,line_total) VALUES(v_order_id,v_product.id,v_product.name,v_quantity,v_product.price,ROUND(v_product.price*v_quantity,2));
    v_total:=v_total+ROUND(v_product.price*v_quantity,2);
  END LOOP;
  UPDATE orders SET subtotal=v_total,total=v_total WHERE id=v_order_id;
  INSERT INTO payment_transactions(order_id,provider,amount,currency,external_idempotency_key) VALUES(v_order_id,p_method,v_total,'ARS',gen_random_uuid());
  RETURN v_order_id;
END $$;

-- El webhook consulta Orders API antes de llamar esta función. Los locks, sale_id y el trigger de inventario hacen idempotente la conversión a venta.
CREATE OR REPLACE FUNCTION complete_mercadopago_order(p_order UUID,p_external_order TEXT,p_payment TEXT,p_amount NUMERIC,p_currency CHAR(3),p_status VARCHAR) RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_order RECORD; v_transaction RECORD; v_item RECORD; v_product RECORD; v_sale_id UUID:=gen_random_uuid(); v_total NUMERIC(12,2):=0;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id=p_order FOR UPDATE;
  SELECT * INTO v_transaction FROM payment_transactions WHERE order_id=p_order AND provider='mercadopago' FOR UPDATE;
  IF NOT FOUND OR (v_transaction.external_order_id IS NOT NULL AND v_transaction.external_order_id<>p_external_order) THEN RAISE EXCEPTION 'Operación externa inválida.'; END IF;
  IF v_transaction.sale_id IS NOT NULL THEN RETURN v_transaction.sale_id; END IF;
  IF p_amount<>v_order.total OR p_currency<>v_order.currency THEN UPDATE payment_transactions SET status='error',external_order_id=p_external_order,external_payment_id=p_payment WHERE id=v_transaction.id; RETURN NULL; END IF;
  UPDATE payment_transactions SET external_order_id=p_external_order,external_payment_id=p_payment,status=CASE WHEN p_status='processed' THEN 'approved' WHEN p_status='rejected' THEN 'rejected' ELSE 'pending' END,approved_at=CASE WHEN p_status='processed' THEN COALESCE(approved_at,NOW()) ELSE approved_at END WHERE id=v_transaction.id;
  IF p_status<>'processed' THEN RETURN NULL; END IF;
  UPDATE orders SET status='paid' WHERE id=v_order.id;
  FOR v_item IN SELECT * FROM order_items WHERE order_id=v_order.id LOOP
    SELECT * INTO v_product FROM products WHERE id=v_item.product_id FOR UPDATE;
    IF v_product.stock<v_item.quantity THEN UPDATE orders SET status='stock_unavailable' WHERE id=v_order.id; RETURN NULL; END IF;
  END LOOP;
  INSERT INTO sales(id,customer_id,status,notes,subtotal,total,payment_method) VALUES(v_sale_id,v_order.customer_id,'completed',concat('Pedido público ',v_order.id),0,0,'mercadopago');
  FOR v_item IN SELECT * FROM order_items WHERE order_id=v_order.id LOOP
    SELECT * INTO v_product FROM products WHERE id=v_item.product_id FOR UPDATE;
    INSERT INTO sale_items(sale_id,product_id,product_name,quantity,unit_price,unit_cost,line_total) VALUES(v_sale_id,v_product.id,v_item.product_name,v_item.quantity,v_item.unit_price,v_product.cost_price,v_item.line_total);
    INSERT INTO inventory_movements(product_id,movement_type,quantity_delta,reason,reference_type,reference_id) VALUES(v_product.id,'venta',-v_item.quantity,'Venta de pedido público','sale',v_sale_id::TEXT);
    v_total:=v_total+v_item.line_total;
  END LOOP;
  UPDATE sales SET subtotal=v_total,total=v_total WHERE id=v_sale_id;
  UPDATE orders SET status='completed' WHERE id=v_order.id;
  UPDATE payment_transactions SET sale_id=v_sale_id,approved_at=COALESCE(approved_at,NOW()),status='approved' WHERE id=v_transaction.id;
  RETURN v_sale_id;
END $$;

REVOKE ALL ON FUNCTION create_public_order(TEXT,TEXT,TEXT,VARCHAR,TEXT,TEXT,VARCHAR,JSONB,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION complete_mercadopago_order(UUID,TEXT,TEXT,NUMERIC,CHAR(3),VARCHAR) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION create_public_order(TEXT,TEXT,TEXT,VARCHAR,TEXT,TEXT,VARCHAR,JSONB,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION complete_mercadopago_order(UUID,TEXT,TEXT,NUMERIC,CHAR(3),VARCHAR) TO service_role;
