-- Finanzas operativas: libro de caja, archivo visual y anulación trazable.
-- No borra datos ni recrea estructuras existentes. Aplicar sólo tras aprobación.

ALTER TABLE sales ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_archived_at ON sales(archived_at) WHERE archived_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS cash_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_type VARCHAR(24) NOT NULL CHECK (movement_type IN ('sale_income','sale_reversal','income','expense','cash_withdrawal','cash_contribution','adjustment','refund')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount <> 0),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  description TEXT NOT NULL DEFAULT '',
  sale_id UUID REFERENCES sales(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cash_movements_occurred_at ON cash_movements(occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS cash_movements_sale_income_once ON cash_movements(sale_id) WHERE movement_type='sale_income';
CREATE UNIQUE INDEX IF NOT EXISTS cash_movements_sale_reversal_once ON cash_movements(sale_id) WHERE movement_type='sale_reversal';

ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE cash_movements TO service_role;

-- La caja física se calcula únicamente desde este libro. Una venta en efectivo
-- genera su ingreso cuando su total definitivo queda registrado; no se asume
-- que una transferencia, tarjeta o Mercado Pago sea efectivo disponible.
CREATE OR REPLACE FUNCTION record_cash_sale_income()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.status='completed' AND NEW.payment_method='cash' AND NEW.total>0 THEN
    INSERT INTO cash_movements(movement_type,amount,description,sale_id)
    VALUES('sale_income',NEW.total,concat('Ingreso por venta ',NEW.id),NEW.id)
    ON CONFLICT (sale_id) WHERE movement_type='sale_income' DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  CREATE TRIGGER record_cash_sale_income_after_total
  AFTER INSERT OR UPDATE OF total,status,payment_method ON sales
  FOR EACH ROW EXECUTE FUNCTION record_cash_sale_income();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Incluye las ventas de efectivo ya existentes sin duplicar una ya registrada.
INSERT INTO cash_movements(movement_type,amount,description,sale_id)
SELECT 'sale_income',s.total,concat('Ingreso histórico por venta ',s.id),s.id
FROM sales s WHERE s.status='completed' AND s.payment_method='cash' AND s.total>0
ON CONFLICT (sale_id) WHERE movement_type='sale_income' DO NOTHING;

-- Anula una venta sin eliminarla y restituye exactamente los ítems vendidos.
CREATE OR REPLACE FUNCTION cancel_sale_with_reversal(p_sale_id UUID, p_reason TEXT DEFAULT '')
RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_sale RECORD; v_item RECORD;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id=p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada.' USING ERRCODE='23503'; END IF;
  IF v_sale.status='cancelled' THEN RETURN v_sale.id; END IF;
  IF v_sale.payment_method='mercadopago' THEN
    RAISE EXCEPTION 'La venta de Mercado Pago requiere confirmar el reintegro antes de anularla.' USING ERRCODE='23514';
  END IF;

  FOR v_item IN SELECT * FROM sale_items WHERE sale_id=v_sale.id LOOP
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

CREATE OR REPLACE FUNCTION archive_sale(p_sale_id UUID, p_archive BOOLEAN)
RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  UPDATE sales SET archived_at=CASE WHEN p_archive THEN NOW() ELSE NULL END WHERE id=p_sale_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada.' USING ERRCODE='23503'; END IF;
  RETURN p_sale_id;
END $$;

CREATE OR REPLACE FUNCTION record_cash_movement(p_type VARCHAR,p_amount NUMERIC,p_description TEXT DEFAULT '',p_occurred_at TIMESTAMPTZ DEFAULT NOW())
RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_id UUID;
BEGIN
  IF p_type NOT IN ('income','expense','cash_withdrawal','cash_contribution','adjustment','refund') OR p_amount=0
    OR (p_type IN ('income','cash_contribution') AND p_amount<0)
    OR (p_type IN ('expense','cash_withdrawal','refund') AND p_amount>0) THEN
    RAISE EXCEPTION 'Movimiento de caja inválido.' USING ERRCODE='23514';
  END IF;
  INSERT INTO cash_movements(movement_type,amount,description,occurred_at)
  VALUES(p_type,p_amount,COALESCE(p_description,''),COALESCE(p_occurred_at,NOW())) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION cancel_sale_with_reversal(UUID,TEXT),archive_sale(UUID,BOOLEAN),record_cash_movement(VARCHAR,NUMERIC,TEXT,TIMESTAMPTZ),record_cash_sale_income() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION cancel_sale_with_reversal(UUID,TEXT),archive_sale(UUID,BOOLEAN),record_cash_movement(VARCHAR,NUMERIC,TEXT,TIMESTAMPTZ),record_cash_sale_income() TO service_role;
