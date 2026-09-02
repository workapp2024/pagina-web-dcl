-- Activación financiera manual, operaciones idempotentes y lámpara combinada.
-- No convierte ventas ni movimientos históricos en saldo disponible.
-- IMPORTANTE: migración local pendiente de revisión. No se ejecuta automáticamente.

CREATE TABLE IF NOT EXISTS financial_accounts (
  id VARCHAR(40) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  account_type VARCHAR(24) NOT NULL DEFAULT 'wallet',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO financial_accounts(id,name,account_type,sort_order) VALUES
  ('cash','Efectivo','cash',10),('mercadopago','Mercado Pago','wallet',20)
ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,active=TRUE;

CREATE TABLE IF NOT EXISTS financial_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK(status IN('open','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS financial_periods_one_open ON financial_periods(status) WHERE status='open';

CREATE TABLE IF NOT EXISTS financial_activation (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  initial_period_id UUID NOT NULL UNIQUE REFERENCES financial_periods(id) ON DELETE RESTRICT,
  activation_key UUID NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS financial_operation_requests (
  idempotency_key UUID PRIMARY KEY,
  operation_type VARCHAR(32) NOT NULL CHECK(operation_type IN('manual_movement','transfer','period_close')),
  result_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS account_id VARCHAR(40) REFERENCES financial_accounts(id) ON DELETE RESTRICT;
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS period_id UUID REFERENCES financial_periods(id) ON DELETE RESTRICT;
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS transfer_id UUID;
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS idempotency_key UUID;

-- Se amplía el tipo del libro para identificar aperturas. El cambio de constraints
-- no elimina filas; permite importe cero exclusivamente para opening_balance.
ALTER TABLE cash_movements DROP CONSTRAINT IF EXISTS cash_movements_movement_type_check;
ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_movement_type_check CHECK(movement_type IN('sale_income','sale_reversal','income','expense','cash_withdrawal','cash_contribution','adjustment','refund','opening_balance'));
ALTER TABLE cash_movements DROP CONSTRAINT IF EXISTS cash_movements_amount_check;
ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_amount_check CHECK(amount<>0 OR movement_type='opening_balance');

CREATE INDEX IF NOT EXISTS idx_cash_movements_account_period ON cash_movements(account_id,period_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_movements_transfer ON cash_movements(transfer_id) WHERE transfer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cash_movements_manual_idempotency ON cash_movements(idempotency_key) WHERE idempotency_key IS NOT NULL AND transfer_id IS NULL;

CREATE OR REPLACE FUNCTION activate_finances(p_cash_balance NUMERIC,p_mercadopago_balance NUMERIC,p_idempotency_key UUID)
RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_period UUID; v_existing RECORD;
BEGIN
  IF p_idempotency_key IS NULL OR p_cash_balance<0 OR p_mercadopago_balance<0 OR p_cash_balance>100000000 OR p_mercadopago_balance>100000000 THEN RAISE EXCEPTION 'Saldos iniciales inválidos.' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('financial_activation'));
  SELECT * INTO v_existing FROM financial_activation WHERE singleton=TRUE;
  IF FOUND THEN RETURN v_existing.initial_period_id; END IF;
  v_period:=gen_random_uuid();
  INSERT INTO financial_periods(id,name,starts_at,status) VALUES(v_period,'Período inicial',NOW(),'open');
  INSERT INTO cash_movements(movement_type,amount,description,account_id,period_id,idempotency_key) VALUES
    ('opening_balance',p_cash_balance,'Saldo inicial informado al activar Finanzas','cash',v_period,gen_random_uuid()),
    ('opening_balance',p_mercadopago_balance,'Saldo inicial informado al activar Finanzas','mercadopago',v_period,gen_random_uuid());
  INSERT INTO financial_activation(singleton,initial_period_id,activation_key) VALUES(TRUE,v_period,p_idempotency_key);
  RETURN v_period;
END $$;

CREATE OR REPLACE FUNCTION record_financial_movement(p_type VARCHAR,p_amount NUMERIC,p_description TEXT,p_account_id VARCHAR,p_idempotency_key UUID)
RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_id UUID; v_period UUID; v_kind VARCHAR;
BEGIN
  IF p_idempotency_key IS NULL OR p_type NOT IN('income','expense','cash_withdrawal','cash_contribution','adjustment','refund') OR p_amount=0
    OR (p_type IN('income','cash_contribution') AND p_amount<0) OR (p_type IN('expense','cash_withdrawal','refund') AND p_amount>0) THEN RAISE EXCEPTION 'Movimiento financiero inválido.' USING ERRCODE='23514'; END IF;
  INSERT INTO financial_operation_requests(idempotency_key,operation_type) VALUES(p_idempotency_key,'manual_movement') ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN SELECT operation_type,result_id INTO v_kind,v_id FROM financial_operation_requests r WHERE r.idempotency_key=p_idempotency_key; IF v_kind<>'manual_movement' THEN RAISE EXCEPTION 'Clave de idempotencia reutilizada.' USING ERRCODE='23505'; END IF; RETURN v_id; END IF;
  SELECT id INTO v_period FROM financial_periods WHERE status='open' FOR UPDATE; IF v_period IS NULL THEN RAISE EXCEPTION 'Finanzas no está activado.' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM financial_accounts WHERE id=p_account_id AND active FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta inválida.' USING ERRCODE='23503'; END IF;
  INSERT INTO cash_movements(movement_type,amount,description,account_id,period_id,idempotency_key) VALUES(p_type,p_amount,COALESCE(p_description,''),p_account_id,v_period,p_idempotency_key) RETURNING id INTO v_id;
  UPDATE financial_operation_requests r SET result_id=v_id WHERE r.idempotency_key=p_idempotency_key; RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION transfer_financial_balance(p_from VARCHAR,p_to VARCHAR,p_amount NUMERIC,p_description TEXT,p_idempotency_key UUID)
RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_period UUID; v_balance NUMERIC; v_kind VARCHAR; v_result UUID;
BEGIN
  IF p_idempotency_key IS NULL OR p_from=p_to OR p_amount<=0 OR p_amount>100000000 THEN RAISE EXCEPTION 'Transferencia inválida.' USING ERRCODE='23514'; END IF;
  INSERT INTO financial_operation_requests(idempotency_key,operation_type) VALUES(p_idempotency_key,'transfer') ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN SELECT operation_type,result_id INTO v_kind,v_result FROM financial_operation_requests r WHERE r.idempotency_key=p_idempotency_key; IF v_kind<>'transfer' THEN RAISE EXCEPTION 'Clave de idempotencia reutilizada.' USING ERRCODE='23505'; END IF; RETURN v_result; END IF;
  SELECT id INTO v_period FROM financial_periods WHERE status='open' FOR UPDATE; IF v_period IS NULL THEN RAISE EXCEPTION 'Finanzas no está activado.' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM financial_accounts WHERE id IN(p_from,p_to) AND active ORDER BY id FOR UPDATE;
  IF (SELECT COUNT(*) FROM financial_accounts WHERE id IN(p_from,p_to) AND active)<>2 THEN RAISE EXCEPTION 'Cuenta inválida.' USING ERRCODE='23503'; END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_balance FROM cash_movements WHERE period_id=v_period AND account_id=p_from;
  IF v_balance<p_amount THEN RAISE EXCEPTION 'Saldo insuficiente.' USING ERRCODE='23514'; END IF;
  INSERT INTO cash_movements(movement_type,amount,description,account_id,period_id,transfer_id) VALUES
    ('adjustment',-p_amount,concat('Transferencia a ',p_to,CASE WHEN btrim(COALESCE(p_description,''))='' THEN '' ELSE ': '||btrim(p_description) END),p_from,v_period,p_idempotency_key),
    ('adjustment', p_amount,concat('Transferencia desde ',p_from,CASE WHEN btrim(COALESCE(p_description,''))='' THEN '' ELSE ': '||btrim(p_description) END),p_to,v_period,p_idempotency_key);
  UPDATE financial_operation_requests r SET result_id=p_idempotency_key WHERE r.idempotency_key=p_idempotency_key; RETURN p_idempotency_key;
END $$;

CREATE OR REPLACE FUNCTION close_financial_period(p_name VARCHAR,p_reset_to_zero BOOLEAN,p_idempotency_key UUID)
RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_old UUID; v_new UUID; v_account RECORD; v_balance NUMERIC; v_kind VARCHAR; v_result UUID;
BEGIN
  IF p_idempotency_key IS NULL OR btrim(COALESCE(p_name,''))='' THEN RAISE EXCEPTION 'Cierre inválido.' USING ERRCODE='23514'; END IF;
  INSERT INTO financial_operation_requests(idempotency_key,operation_type) VALUES(p_idempotency_key,'period_close') ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN SELECT operation_type,result_id INTO v_kind,v_result FROM financial_operation_requests r WHERE r.idempotency_key=p_idempotency_key; IF v_kind<>'period_close' THEN RAISE EXCEPTION 'Clave de idempotencia reutilizada.' USING ERRCODE='23505'; END IF; RETURN v_result; END IF;
  SELECT id INTO v_old FROM financial_periods WHERE status='open' FOR UPDATE; IF v_old IS NULL THEN RAISE EXCEPTION 'No existe un período abierto.' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM financial_accounts WHERE active ORDER BY id FOR UPDATE;
  UPDATE financial_periods SET status='closed',ends_at=NOW(),closed_at=NOW() WHERE id=v_old;
  v_new:=gen_random_uuid(); INSERT INTO financial_periods(id,name,starts_at,status) VALUES(v_new,p_name,NOW(),'open');
  FOR v_account IN SELECT id FROM financial_accounts WHERE active ORDER BY sort_order LOOP
    SELECT COALESCE(SUM(amount),0) INTO v_balance FROM cash_movements WHERE period_id=v_old AND account_id=v_account.id;
    INSERT INTO cash_movements(movement_type,amount,description,account_id,period_id,idempotency_key)
    VALUES('opening_balance',CASE WHEN p_reset_to_zero THEN 0 ELSE v_balance END,'Saldo de apertura del período',v_account.id,v_new,gen_random_uuid());
  END LOOP;
  UPDATE financial_operation_requests r SET result_id=v_new WHERE r.idempotency_key=p_idempotency_key; RETURN v_new;
END $$;

CREATE OR REPLACE FUNCTION record_cash_sale_income()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_account VARCHAR(40); v_period UUID;
BEGIN
  v_account:=CASE NEW.payment_method WHEN 'cash' THEN 'cash' WHEN 'mercadopago' THEN 'mercadopago' ELSE NULL END;
  SELECT id INTO v_period FROM financial_periods WHERE status='open' FOR SHARE;
  IF v_period IS NOT NULL AND NEW.status='completed' AND NEW.total>0 AND v_account IS NOT NULL THEN
    INSERT INTO cash_movements(movement_type,amount,description,sale_id,account_id,period_id) VALUES('sale_income',NEW.total,concat('Ingreso por venta ',NEW.id),NEW.id,v_account,v_period)
    ON CONFLICT(sale_id) WHERE movement_type='sale_income' DO NOTHING;
  END IF; RETURN NEW;
END $$;

-- Contrato legado: sigue operando sobre Efectivo, con UUID generado por llamada.
CREATE OR REPLACE FUNCTION record_cash_movement(p_type VARCHAR,p_amount NUMERIC,p_description TEXT DEFAULT '',p_occurred_at TIMESTAMPTZ DEFAULT NOW())
RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
BEGIN RETURN record_financial_movement(p_type,p_amount,p_description,'cash',gen_random_uuid()); END $$;

CREATE OR REPLACE FUNCTION cancel_sale_with_reversal(p_sale_id UUID,p_reason TEXT DEFAULT '')
RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_sale RECORD; v_item RECORD; v_period UUID;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id=p_sale_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada.' USING ERRCODE='23503'; END IF;
  IF v_sale.status='cancelled' THEN RETURN v_sale.id; END IF;
  IF v_sale.payment_method='mercadopago' THEN RAISE EXCEPTION 'La venta de Mercado Pago requiere confirmar el reintegro antes de anularla.' USING ERRCODE='23514'; END IF;
  FOR v_item IN SELECT * FROM sale_items WHERE sale_id=v_sale.id LOOP INSERT INTO inventory_movements(product_id,movement_type,quantity_delta,reason,reference_type,reference_id) VALUES(v_item.product_id,'ajuste',v_item.quantity,concat('Anulación de venta: ',COALESCE(NULLIF(btrim(p_reason),''),'sin detalle')),'sale_reversal',v_sale.id::TEXT); END LOOP;
  UPDATE sales SET status='cancelled',cancelled_at=NOW(),cancellation_reason=COALESCE(p_reason,'') WHERE id=v_sale.id;
  SELECT id INTO v_period FROM financial_periods WHERE status='open' FOR SHARE;
  IF v_period IS NOT NULL AND v_sale.payment_method='cash' THEN INSERT INTO cash_movements(movement_type,amount,description,sale_id,account_id,period_id) VALUES('sale_reversal',-v_sale.total,concat('Reversión de venta ',v_sale.id),'cash',v_period) ON CONFLICT(sale_id) WHERE movement_type='sale_reversal' DO NOTHING; END IF;
  UPDATE installations SET status='cancelled' WHERE sale_id=v_sale.id AND status='pending'; UPDATE warranties SET status='void' WHERE sale_item_id IN(SELECT id FROM sale_items WHERE sale_id=v_sale.id) AND status='active'; RETURN v_sale.id;
END $$;

ALTER TABLE financial_accounts ENABLE ROW LEVEL SECURITY; ALTER TABLE financial_periods ENABLE ROW LEVEL SECURITY; ALTER TABLE financial_activation ENABLE ROW LEVEL SECURITY; ALTER TABLE financial_operation_requests ENABLE ROW LEVEL SECURITY;
GRANT ALL ON financial_accounts,financial_periods,financial_activation,financial_operation_requests TO service_role;
REVOKE ALL ON FUNCTION activate_finances(NUMERIC,NUMERIC,UUID),record_financial_movement(VARCHAR,NUMERIC,TEXT,VARCHAR,UUID),transfer_financial_balance(VARCHAR,VARCHAR,NUMERIC,TEXT,UUID),close_financial_period(VARCHAR,BOOLEAN,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION activate_finances(NUMERIC,NUMERIC,UUID),record_financial_movement(VARCHAR,NUMERIC,TEXT,VARCHAR,UUID),transfer_financial_balance(VARCHAR,VARCHAR,NUMERIC,TEXT,UUID),close_financial_period(VARCHAR,BOOLEAN,UUID) TO service_role;

ALTER TABLE vehicle_compatibilities ADD COLUMN IF NOT EXISTS combined_high_low BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vehicle_compatibilities ADD CONSTRAINT vehicle_compat_combined_connector CHECK(NOT combined_high_low OR(connector_low IS NOT NULL AND connector_high IS NULL));
