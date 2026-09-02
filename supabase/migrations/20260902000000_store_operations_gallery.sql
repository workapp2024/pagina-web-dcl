-- Catálogo, garantías, agenda de instalaciones y galería pública.
-- Migración local: debe revisarse y aplicarse manualmente. No se ejecuta automáticamente.

ALTER TABLE products ADD COLUMN IF NOT EXISTS show_in_catalog BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS warranty_days INTEGER CHECK (warranty_days IS NULL OR warranty_days BETWEEN 1 AND 3650);
CREATE INDEX IF NOT EXISTS idx_products_public_catalog ON products(sort_order) WHERE active AND show_in_catalog;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS document_number VARCHAR(40);
CREATE INDEX IF NOT EXISTS idx_customers_document_number ON customers(document_number) WHERE document_number IS NOT NULL;

ALTER TABLE installations ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE installations ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50);
ALTER TABLE installations ADD COLUMN IF NOT EXISTS work_type VARCHAR(120);
ALTER TABLE installations ADD COLUMN IF NOT EXISTS estimated_difficulty VARCHAR(20)
  CHECK (estimated_difficulty IS NULL OR estimated_difficulty IN ('low','medium','high'));
ALTER TABLE installations ADD COLUMN IF NOT EXISTS assigned_technician VARCHAR(120);

CREATE TABLE IF NOT EXISTS work_gallery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url TEXT NOT NULL,
  title VARCHAR(120),
  caption VARCHAR(280),
  item_type VARCHAR(20) NOT NULL DEFAULT 'installation'
    CHECK (item_type IN ('delivery','installation','customer','other')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_work_gallery_public ON work_gallery(sort_order, created_at DESC) WHERE active;
ALTER TABLE work_gallery ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read active work gallery" ON work_gallery;
CREATE POLICY "Public read active work gallery" ON work_gallery FOR SELECT TO anon, authenticated USING (active = TRUE);
GRANT SELECT ON work_gallery TO anon, authenticated;
GRANT ALL ON work_gallery TO service_role;

CREATE OR REPLACE FUNCTION create_sale_with_inventory(
  p_customer_id UUID,
  p_customer_vehicle_id UUID,
  p_notes TEXT,
  p_items JSONB,
  p_create_installation BOOLEAN DEFAULT FALSE,
  p_payment_method VARCHAR DEFAULT 'cash',
  p_idempotency_key UUID DEFAULT NULL,
  p_installation JSONB DEFAULT '{}'::JSONB,
  p_warranties JSONB DEFAULT '[]'::JSONB
) RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  v_sale_id UUID := gen_random_uuid(); v_existing UUID; v_item JSONB; v_product RECORD;
  v_product_id VARCHAR(64); v_quantity INTEGER; v_line_total NUMERIC(12,2); v_subtotal NUMERIC(12,2):=0;
  v_sale_item_id UUID; v_warranty JSONB; v_days INTEGER; v_starts TIMESTAMPTZ; v_product_ids TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF p_payment_method NOT IN ('cash','transfer','mercadopago','debit','credit','other') THEN RAISE EXCEPTION 'Forma de pago inválida.' USING ERRCODE='23514'; END IF;
  IF p_idempotency_key IS NOT NULL THEN SELECT id INTO v_existing FROM sales WHERE idempotency_key=p_idempotency_key; IF v_existing IS NOT NULL THEN RETURN v_existing; END IF; END IF;
  IF NOT EXISTS(SELECT 1 FROM customers WHERE id=p_customer_id) THEN RAISE EXCEPTION 'El cliente seleccionado no existe.' USING ERRCODE='23503'; END IF;
  IF p_customer_vehicle_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM customer_vehicles WHERE id=p_customer_vehicle_id AND customer_id=p_customer_id) THEN RAISE EXCEPTION 'El vehículo no pertenece al cliente.' USING ERRCODE='23503'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'La venta debe incluir productos.' USING ERRCODE='23514'; END IF;
  INSERT INTO sales(id,customer_id,customer_vehicle_id,notes,payment_method,idempotency_key) VALUES(v_sale_id,p_customer_id,p_customer_vehicle_id,COALESCE(p_notes,''),p_payment_method,p_idempotency_key)
  ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id INTO v_existing;
  IF v_existing IS NULL THEN SELECT id INTO v_existing FROM sales WHERE idempotency_key=p_idempotency_key; RETURN v_existing; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_product_id:=NULLIF(TRIM(v_item->>'productId'),''); v_quantity:=(v_item->>'quantity')::INTEGER;
    IF v_product_id IS NULL OR v_quantity IS NULL OR v_quantity<1 OR v_quantity>100 THEN RAISE EXCEPTION 'Ítem inválido.' USING ERRCODE='23514'; END IF;
    SELECT id,name,price,cost_price,stock,warranty_days INTO v_product FROM products WHERE id=v_product_id FOR UPDATE;
    IF NOT FOUND OR v_product.stock<v_quantity THEN RAISE EXCEPTION 'Producto inexistente o sin stock.' USING ERRCODE='23514'; END IF;
    v_line_total:=ROUND(v_product.price*v_quantity,2);
    INSERT INTO sale_items(sale_id,product_id,product_name,quantity,unit_price,unit_cost,line_total) VALUES(v_sale_id,v_product.id,v_product.name,v_quantity,v_product.price,v_product.cost_price,v_line_total) RETURNING id INTO v_sale_item_id;
    INSERT INTO inventory_movements(product_id,movement_type,quantity_delta,reason,reference_type,reference_id) VALUES(v_product.id,'venta',-v_quantity,'Venta registrada','sale',v_sale_id::TEXT);
    v_product_ids:=array_append(v_product_ids,v_product.id); v_subtotal:=v_subtotal+v_line_total;
    v_warranty:=NULL;
    SELECT value INTO v_warranty FROM jsonb_array_elements(p_warranties) WHERE value->>'productId'=v_product.id LIMIT 1;
    IF v_warranty IS NOT NULL AND COALESCE((v_warranty->>'enabled')::BOOLEAN,FALSE) THEN
      v_days:=COALESCE(NULLIF(v_warranty->>'days','')::INTEGER,v_product.warranty_days); v_starts:=COALESCE(NULLIF(v_warranty->>'startsAt','')::TIMESTAMPTZ,NOW());
      IF v_days BETWEEN 1 AND 3650 THEN INSERT INTO warranties(sale_item_id,customer_id,customer_vehicle_id,starts_at,expires_at,notes) VALUES(v_sale_item_id,p_customer_id,p_customer_vehicle_id,v_starts,v_starts+make_interval(days=>v_days),LEFT(COALESCE(v_warranty->>'notes',''),500)); END IF;
    END IF;
  END LOOP;
  UPDATE sales SET subtotal=v_subtotal,total=v_subtotal WHERE id=v_sale_id;
  IF p_create_installation THEN
    INSERT INTO installations(sale_id,customer_vehicle_id,status,scheduled_at,notes,location,contact_phone,work_type,estimated_difficulty,assigned_technician)
    VALUES(v_sale_id,p_customer_vehicle_id,'pending',NULLIF(p_installation->>'scheduledAt','')::TIMESTAMPTZ,LEFT(COALESCE(p_installation->>'notes',''),1000),NULLIF(LEFT(p_installation->>'location',300),''),NULLIF(LEFT(p_installation->>'contactPhone',50),''),NULLIF(LEFT(p_installation->>'workType',120),''),NULLIF(p_installation->>'difficulty',''),NULLIF(LEFT(p_installation->>'technician',120),''));
  END IF;
  RETURN v_sale_id;
END $$;

REVOKE ALL ON FUNCTION create_sale_with_inventory(UUID,UUID,TEXT,JSONB,BOOLEAN,VARCHAR,UUID,JSONB,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION create_sale_with_inventory(UUID,UUID,TEXT,JSONB,BOOLEAN,VARCHAR,UUID,JSONB,JSONB) TO service_role;
