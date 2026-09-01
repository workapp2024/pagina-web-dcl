-- =============================================================================
-- CLIENTES Y VENTAS - DCL CREE LED
-- Depende de:
--   20260830010000_products_inventory.sql
--   20260830020000_inventory_prevent_negative_stock.sql
--
-- Esta migración no modifica ni recrea productos, catálogo de vehículos ni
-- compatibilidades. Los vehículos concretos de clientes se guardan separados
-- del catálogo general y opcionalmente pueden referenciar vehicle_models.
-- =============================================================================

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(160) NOT NULL,
  phone VARCHAR(50),
  email VARCHAR(255),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_full_name ON customers (full_name);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers (email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS customer_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  vehicle_model_id VARCHAR(64) REFERENCES vehicle_models(id) ON DELETE SET NULL,
  brand_name VARCHAR(100) NOT NULL,
  model_name VARCHAR(100) NOT NULL,
  year INTEGER,
  plate VARCHAR(20),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_vehicles_customer ON customer_vehicles(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_vehicles_model ON customer_vehicles(vehicle_model_id) WHERE vehicle_model_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  customer_vehicle_id UUID REFERENCES customer_vehicles(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
  notes TEXT NOT NULL DEFAULT '',
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_customer_created ON sales(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_vehicle ON sales(customer_vehicle_id) WHERE customer_vehicle_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name VARCHAR(255) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(12,2) NOT NULL CHECK (line_total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);

-- Se preparan estas relaciones para el historial de cliente. No obligan a
-- implementar aún una pantalla independiente de instalaciones o garantías.
CREATE TABLE IF NOT EXISTS installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL UNIQUE REFERENCES sales(id) ON DELETE CASCADE,
  customer_vehicle_id UUID REFERENCES customer_vehicles(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  scheduled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS warranties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_item_id UUID NOT NULL REFERENCES sale_items(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  customer_vehicle_id UUID REFERENCES customer_vehicles(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'void')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_warranties_customer ON warranties(customer_id);
CREATE INDEX IF NOT EXISTS idx_warranties_sale_item ON warranties(sale_item_id);

CREATE TABLE IF NOT EXISTS warranty_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warranty_id UUID NOT NULL REFERENCES warranties(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'rejected')),
  description TEXT NOT NULL,
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_warranty_claims_warranty ON warranty_claims(warranty_id);

DROP TRIGGER IF EXISTS set_updated_at_customers ON customers;
CREATE TRIGGER set_updated_at_customers BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS set_updated_at_customer_vehicles ON customer_vehicles;
CREATE TRIGGER set_updated_at_customer_vehicles BEFORE UPDATE ON customer_vehicles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS set_updated_at_installations ON installations;
CREATE TRIGGER set_updated_at_installations BEFORE UPDATE ON installations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS set_updated_at_warranty_claims ON warranty_claims;
CREATE TRIGGER set_updated_at_warranty_claims BEFORE UPDATE ON warranty_claims FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranties ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranty_claims ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE customers, customer_vehicles, sales, sale_items, installations, warranties, warranty_claims TO service_role;

-- La operación de venta es atómica: guarda la venta, sus ítems y los
-- inventory_movements. El trigger de inventario mantiene products.stock y
-- rechaza stock negativo; cualquier error revierte toda la venta.
CREATE OR REPLACE FUNCTION create_sale_with_inventory(
  p_customer_id UUID,
  p_customer_vehicle_id UUID,
  p_notes TEXT,
  p_items JSONB,
  p_create_installation BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sale_id UUID := gen_random_uuid();
  v_item JSONB;
  v_product RECORD;
  v_product_id VARCHAR(64);
  v_quantity INTEGER;
  v_line_total NUMERIC(12,2);
  v_subtotal NUMERIC(12,2) := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id) THEN
    RAISE EXCEPTION 'El cliente seleccionado no existe.' USING ERRCODE = '23503';
  END IF;

  IF p_customer_vehicle_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM customer_vehicles WHERE id = p_customer_vehicle_id AND customer_id = p_customer_id
  ) THEN
    RAISE EXCEPTION 'El vehículo no pertenece al cliente seleccionado.' USING ERRCODE = '23503';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta debe incluir al menos un producto.' USING ERRCODE = '23514';
  END IF;

  INSERT INTO sales (id, customer_id, customer_vehicle_id, notes)
  VALUES (v_sale_id, p_customer_id, p_customer_vehicle_id, COALESCE(p_notes, ''));

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := NULLIF(TRIM(v_item ->> 'productId'), '');
    v_quantity := (v_item ->> 'quantity')::INTEGER;

    IF v_product_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Cada ítem debe incluir producto y cantidad positiva.' USING ERRCODE = '23514';
    END IF;

    SELECT id, name, price, stock INTO v_product
    FROM products
    WHERE id = v_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No existe el producto %.', v_product_id USING ERRCODE = '23503';
    END IF;

    IF v_product.stock < v_quantity THEN
      RAISE EXCEPTION 'Stock insuficiente para %.', v_product.name USING ERRCODE = '23514';
    END IF;

    v_line_total := ROUND(v_product.price * v_quantity, 2);
    INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, line_total)
    VALUES (v_sale_id, v_product.id, v_product.name, v_quantity, v_product.price, v_line_total);

    INSERT INTO inventory_movements (product_id, movement_type, quantity_delta, reason, reference_type, reference_id)
    VALUES (v_product.id, 'venta', -v_quantity, 'Venta registrada', 'sale', v_sale_id::TEXT);

    v_subtotal := v_subtotal + v_line_total;
  END LOOP;

  UPDATE sales SET subtotal = v_subtotal, total = v_subtotal WHERE id = v_sale_id;

  IF p_create_installation THEN
    INSERT INTO installations (sale_id, customer_vehicle_id)
    VALUES (v_sale_id, p_customer_vehicle_id);
  END IF;

  RETURN v_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION create_sale_with_inventory(UUID, UUID, TEXT, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_sale_with_inventory(UUID, UUID, TEXT, JSONB, BOOLEAN) TO service_role;
