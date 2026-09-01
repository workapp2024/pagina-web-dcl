-- Cierre seguro del módulo de ventas. NO elimina ni recrea tablas ni datos.
-- Pendiente de aplicar manualmente en Supabase antes de desplegar esta versión.

ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) NOT NULL DEFAULT 'cash'
  CHECK (payment_method IN ('cash', 'transfer', 'mercadopago', 'debit', 'credit', 'other'));
ALTER TABLE sales ADD COLUMN IF NOT EXISTS idempotency_key UUID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_idempotency_key ON sales (idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,2)
  CHECK (unit_cost IS NULL OR unit_cost >= 0);

-- Se conserva el precio/costo de cada línea. Las ventas históricas no cambian
-- cuando luego se modifica products.price o products.cost_price.
CREATE OR REPLACE FUNCTION create_sale_with_inventory(
  p_customer_id UUID,
  p_customer_vehicle_id UUID,
  p_notes TEXT,
  p_items JSONB,
  p_create_installation BOOLEAN DEFAULT FALSE,
  p_payment_method VARCHAR DEFAULT 'cash',
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sale_id UUID := gen_random_uuid();
  v_existing_sale_id UUID;
  v_item JSONB;
  v_product RECORD;
  v_product_id VARCHAR(64);
  v_quantity INTEGER;
  v_line_total NUMERIC(12,2);
  v_subtotal NUMERIC(12,2) := 0;
BEGIN
  IF p_payment_method NOT IN ('cash', 'transfer', 'mercadopago', 'debit', 'credit', 'other') THEN
    RAISE EXCEPTION 'Forma de pago inválida.' USING ERRCODE = '23514';
  END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_sale_id FROM sales WHERE idempotency_key = p_idempotency_key;
    IF v_existing_sale_id IS NOT NULL THEN RETURN v_existing_sale_id; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id) THEN RAISE EXCEPTION 'El cliente seleccionado no existe.' USING ERRCODE = '23503'; END IF;
  IF p_customer_vehicle_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customer_vehicles WHERE id = p_customer_vehicle_id AND customer_id = p_customer_id) THEN RAISE EXCEPTION 'El vehículo no pertenece al cliente seleccionado.' USING ERRCODE = '23503'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'La venta debe incluir al menos un producto.' USING ERRCODE = '23514'; END IF;

  INSERT INTO sales (id, customer_id, customer_vehicle_id, notes, payment_method, idempotency_key)
  VALUES (v_sale_id, p_customer_id, p_customer_vehicle_id, COALESCE(p_notes, ''), p_payment_method, p_idempotency_key)
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_existing_sale_id;
  IF v_existing_sale_id IS NULL THEN
    SELECT id INTO v_existing_sale_id FROM sales WHERE idempotency_key = p_idempotency_key;
    RETURN v_existing_sale_id;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_product_id := NULLIF(TRIM(v_item ->> 'productId'), '');
    v_quantity := (v_item ->> 'quantity')::INTEGER;
    IF v_product_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN RAISE EXCEPTION 'Cada ítem debe incluir producto y cantidad positiva.' USING ERRCODE = '23514'; END IF;
    SELECT id, name, price, cost_price, stock INTO v_product FROM products WHERE id = v_product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No existe el producto %.', v_product_id USING ERRCODE = '23503'; END IF;
    IF v_product.stock < v_quantity THEN RAISE EXCEPTION 'Stock insuficiente para %.', v_product.name USING ERRCODE = '23514'; END IF;
    v_line_total := ROUND(v_product.price * v_quantity, 2);
    INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total)
    VALUES (v_sale_id, v_product.id, v_product.name, v_quantity, v_product.price, v_product.cost_price, v_line_total);
    INSERT INTO inventory_movements (product_id, movement_type, quantity_delta, reason, reference_type, reference_id)
    VALUES (v_product.id, 'venta', -v_quantity, 'Venta registrada', 'sale', v_sale_id::TEXT);
    v_subtotal := v_subtotal + v_line_total;
  END LOOP;
  UPDATE sales SET subtotal = v_subtotal, total = v_subtotal WHERE id = v_sale_id;
  IF p_create_installation THEN INSERT INTO installations (sale_id, customer_vehicle_id) VALUES (v_sale_id, p_customer_vehicle_id); END IF;
  RETURN v_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION create_sale_with_inventory(UUID, UUID, TEXT, JSONB, BOOLEAN, VARCHAR, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_sale_with_inventory(UUID, UUID, TEXT, JSONB, BOOLEAN, VARCHAR, UUID) TO service_role;
