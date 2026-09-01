-- =============================================================================
-- PRODUCTOS: COSTO / MARGEN / STOCK + INVENTARIO REAL - DCL CREE LED
-- Archivo: supabase/migrations/20260830010000_products_inventory.sql
-- Descripción:
--   1) Amplía la tabla existente `products` (NO la reemplaza) con columnas
--      privadas de gestión: cost_price, margin_percentage, stock, stock_min.
--   2) Crea `inventory_movements`: historial normalizado e inmutable de
--      entradas/salidas/ajustes de stock por producto (nunca un simple
--      número editable). Un trigger mantiene `products.stock` sincronizado
--      automáticamente al insertar un movimiento.
--   3) Restringe el acceso público de columnas en `products`: anon/authenticated
--      dejan de poder leer cost_price, margin_percentage, stock y stock_min
--      (antes tenían SELECT sobre toda la tabla). `inventory_movements` no se
--      otorga a anon/authenticated en absoluto: es exclusivamente administrativa.
--
-- IMPORTANTE: Este archivo NO se ejecuta automáticamente. Debe aplicarse
-- manualmente desde el SQL Editor de Supabase. No borra productos ni datos
-- existentes; todas las columnas nuevas son opcionales o tienen default.
-- =============================================================================

-- 1. NUEVAS COLUMNAS EN PRODUCTS (privadas de administración)
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS margin_percentage NUMERIC(6,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_min INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_products_stock ON products(stock);

-- 2. TABLA INVENTORY_MOVEMENTS (historial normalizado, nunca se edita ni se borra)
CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,

  movement_type VARCHAR(20) NOT NULL CHECK (movement_type IN ('entrada', 'salida', 'ajuste', 'venta')),
  -- Delta con signo aplicado directamente sobre el stock (positivo suma, negativo resta).
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
  reason TEXT NOT NULL DEFAULT '',

  -- Referencia polimórfica opcional, preparada para que una futura venta
  -- (u otro módulo) genere movimientos automáticamente sin necesitar todavía
  -- una tabla `sales` real ni una FK prematura.
  reference_type VARCHAR(30),
  reference_id VARCHAR(64),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_created_at ON inventory_movements(created_at);

-- 3. TRIGGER: aplica el delta al stock del producto al insertar un movimiento.
-- El stock de `products` queda como valor derivado y sincronizado; el historial
-- de `inventory_movements` es la fuente de verdad auditable.
CREATE OR REPLACE FUNCTION apply_inventory_movement()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE products SET stock = stock + NEW.quantity_delta WHERE id = NEW.product_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_apply_inventory_movement ON inventory_movements;
CREATE TRIGGER trg_apply_inventory_movement
AFTER INSERT ON inventory_movements
FOR EACH ROW
EXECUTE FUNCTION apply_inventory_movement();

-- 4. SEGURIDAD: inventory_movements es EXCLUSIVAMENTE administrativa.
-- RLS habilitada sin políticas para anon/authenticated: quedan sin acceso.
-- Solo la service role key (que bypassea RLS) puede leer/escribir, igual que
-- el resto de las escrituras administrativas del proyecto.
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE inventory_movements TO service_role;

-- 5. SEGURIDAD: restringir columnas privadas de PRODUCTS para anon/authenticated.
-- El GRANT anterior (20260827_initial_schema.sql) otorgaba SELECT sobre TODA la
-- tabla; se revoca y se vuelve a otorgar solo sobre las columnas públicas para
-- que costo, margen y stock nunca puedan leerse desde el navegador del cliente,
-- sin importar qué columnas pida el código de la web pública.
REVOKE SELECT ON TABLE products FROM anon, authenticated;

GRANT SELECT (
  id, name, slug, description, price, previous_price, category, image_url,
  cta_text, featured, active, sort_order, watts, lumens, voltage,
  color_temperature, connector_type, canbus, chip_type, warranty,
  created_at, updated_at
) ON products TO anon, authenticated;

-- service_role conserva acceso total (ya lo tenía desde la configuración inicial;
-- se deja explícito para que quede documentado en un solo lugar).
GRANT ALL ON TABLE products TO service_role;

-- NOTA DE SEGURIDAD:
-- cost_price, margin_percentage, stock y stock_min quedan fuera del GRANT de
-- anon/authenticated: ni la Home, ni /productos, ni /productos/[slug], ni el
-- buscador de vehículos pueden leerlos, se pida lo que se pida desde el cliente.
-- Solo son visibles/editables desde /api/admin/products y /api/admin/inventory,
-- que usan exclusivamente la service role key en el servidor.
