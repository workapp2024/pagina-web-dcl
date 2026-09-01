-- =============================================================================
-- INVENTARIO: PREVENIR STOCK NEGATIVO - DCL CREE LED
-- Complementa 20260830010000_products_inventory.sql.
--
-- products.stock es un valor materializado. inventory_movements es el historial
-- auditable y cada INSERT aplica su delta mediante este trigger. El UPDATE con
-- condición es atómico: bajo concurrencia no permite que el stock resulte menor
-- que cero. Si la condición falla, la excepción revierte también el INSERT del
-- movimiento dentro de la misma transacción.
--
-- IMPORTANTE: aplicar manualmente en Supabase SQL Editor después de la migración
-- 20260830010000_products_inventory.sql. Este archivo no se ejecuta automáticamente.
-- =============================================================================

CREATE OR REPLACE FUNCTION apply_inventory_movement()
RETURNS TRIGGER AS $$
DECLARE
  next_stock INTEGER;
BEGIN
  UPDATE products
  SET stock = stock + NEW.quantity_delta
  WHERE id = NEW.product_id
    AND stock + NEW.quantity_delta >= 0
  RETURNING stock INTO next_stock;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id) THEN
      RAISE EXCEPTION 'El movimiento dejaría el stock del producto % en negativo.', NEW.product_id
        USING ERRCODE = '23514';
    END IF;

    RAISE EXCEPTION 'No existe el producto % para el movimiento de inventario.', NEW.product_id
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- El trigger creado por 20260830010000 ya usa esta función. Se recrea de forma
-- idempotente para garantizar el orden y el enlace correctos si fue alterado.
DROP TRIGGER IF EXISTS trg_apply_inventory_movement ON inventory_movements;
CREATE TRIGGER trg_apply_inventory_movement
AFTER INSERT ON inventory_movements
FOR EACH ROW
EXECUTE FUNCTION apply_inventory_movement();
