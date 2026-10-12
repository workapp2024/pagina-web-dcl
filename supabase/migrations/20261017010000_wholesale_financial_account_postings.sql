-- Bridge wholesale cash receipts/refunds into DCL's existing operational cash ledger.
-- This never creates retail sales or journals and never rewrites a closed period.
BEGIN;

CREATE TABLE public.wholesale_financial_account_mappings (
  payment_method TEXT PRIMARY KEY CHECK (payment_method IN
    ('cash','bank_transfer','mercadopago','debit_card','credit_card','other')),
  account_id VARCHAR(40) REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
  configured_by UUID,
  configured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.wholesale_financial_account_mapping_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_method TEXT NOT NULL CHECK (payment_method IN
    ('cash','bank_transfer','mercadopago','debit_card','credit_card','other')),
  account_id VARCHAR(40) REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
  actor_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Cash and Mercado Pago are the only exact existing mappings. All other methods
-- require an explicit ADMIN choice; no bank/card destinations are guessed.
INSERT INTO public.wholesale_financial_account_mappings(payment_method,account_id)
SELECT method, method FROM (VALUES ('cash'),('mercadopago')) AS defaults(method)
JOIN public.financial_accounts a ON a.id=method AND a.active
ON CONFLICT (payment_method) DO NOTHING;

CREATE TABLE public.wholesale_financial_postings (
  payment_entry_id UUID PRIMARY KEY REFERENCES public.wholesale_payment_entries(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN
    ('pending_mapping','pending_period','unsupported_currency','posted','included_in_opening_balance')),
  account_id VARCHAR(40) REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
  period_id UUID REFERENCES public.financial_periods(id) ON DELETE RESTRICT,
  cash_movement_id UUID UNIQUE REFERENCES public.cash_movements(id) ON DELETE RESTRICT,
  posted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status='posted' AND account_id IS NOT NULL AND period_id IS NOT NULL AND cash_movement_id IS NOT NULL AND posted_at IS NOT NULL)
    OR (status<>'posted' AND cash_movement_id IS NULL AND posted_at IS NULL))
);
CREATE INDEX wholesale_financial_postings_pending_idx ON public.wholesale_financial_postings(status,payment_entry_id)
  WHERE status IN ('pending_mapping','pending_period','unsupported_currency');

ALTER TABLE public.cash_movements
  ADD COLUMN wholesale_payment_entry_id UUID REFERENCES public.wholesale_payment_entries(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX cash_movements_wholesale_entry_once
  ON public.cash_movements(wholesale_payment_entry_id) WHERE wholesale_payment_entry_id IS NOT NULL;
ALTER TABLE public.cash_movements ADD CONSTRAINT cash_movements_wholesale_shape CHECK (
  wholesale_payment_entry_id IS NULL OR (sale_id IS NULL AND transfer_id IS NULL
    AND ((movement_type='income' AND amount>0) OR (movement_type='refund' AND amount<0)))
);

CREATE FUNCTION public.guard_wholesale_cash_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_entry public.wholesale_payment_entries%ROWTYPE; v_expected_account VARCHAR(40);
BEGIN
  IF TG_OP<>'INSERT' AND OLD.wholesale_payment_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'WHOLESALE_FINANCIAL_MOVEMENT_IMMUTABLE';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.wholesale_payment_entry_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_entry FROM public.wholesale_payment_entries WHERE id=NEW.wholesale_payment_entry_id;
  SELECT account_id INTO v_expected_account FROM public.wholesale_financial_account_mappings WHERE payment_method=v_entry.payment_method;
  IF NOT FOUND OR v_entry.currency<>'ARS' OR v_expected_account IS DISTINCT FROM NEW.account_id
    OR NEW.occurred_at IS DISTINCT FROM v_entry.occurred_at
    OR (v_entry.entry_type='payment' AND (NEW.movement_type<>'income' OR NEW.amount<>v_entry.amount))
    OR (v_entry.entry_type='refund' AND (NEW.movement_type<>'refund' OR NEW.amount<>-v_entry.amount))
    OR NEW.sale_id IS NOT NULL OR NEW.transfer_id IS NOT NULL THEN
    RAISE EXCEPTION 'WHOLESALE_FINANCIAL_MOVEMENT_SOURCE_MISMATCH';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.financial_periods WHERE id=NEW.period_id AND status='open')
    OR NOT EXISTS(SELECT 1 FROM public.financial_accounts WHERE id=NEW.account_id AND active) THEN
    RAISE EXCEPTION 'WHOLESALE_FINANCIAL_DESTINATION_INVALID';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER wholesale_cash_movement_guard BEFORE INSERT OR UPDATE OR DELETE ON public.cash_movements
FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_cash_movement();

CREATE FUNCTION public.post_wholesale_financial_entry(p_entry UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_entry public.wholesale_payment_entries%ROWTYPE; v_account VARCHAR(40); v_period UUID;
  v_status TEXT; v_movement UUID; v_activation TIMESTAMPTZ;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('wholesale_financial_posting'));
  SELECT * INTO v_entry FROM public.wholesale_payment_entries WHERE id=p_entry FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_PAYMENT_NOT_FOUND'; END IF;
  INSERT INTO public.wholesale_financial_postings(payment_entry_id,status)
    VALUES(p_entry,'pending_mapping') ON CONFLICT(payment_entry_id) DO NOTHING;
  SELECT status,cash_movement_id INTO v_status,v_movement
    FROM public.wholesale_financial_postings WHERE payment_entry_id=p_entry FOR UPDATE;
  IF v_status IN ('posted','included_in_opening_balance') THEN RETURN v_status; END IF;
  IF v_entry.currency<>'ARS' THEN
    UPDATE public.wholesale_financial_postings SET status='unsupported_currency',account_id=NULL,period_id=NULL,updated_at=clock_timestamp()
      WHERE payment_entry_id=p_entry;
    RETURN 'unsupported_currency';
  END IF;
  SELECT account_id INTO v_account FROM public.wholesale_financial_account_mappings WHERE payment_method=v_entry.payment_method;
  IF v_account IS NULL OR NOT EXISTS(SELECT 1 FROM public.financial_accounts WHERE id=v_account AND active) THEN
    UPDATE public.wholesale_financial_postings SET status='pending_mapping',account_id=NULL,period_id=NULL,updated_at=clock_timestamp()
      WHERE payment_entry_id=p_entry;
    RETURN 'pending_mapping';
  END IF;
  SELECT activated_at INTO v_activation FROM public.financial_activation WHERE singleton FOR SHARE;
  IF v_activation IS NULL THEN
    UPDATE public.wholesale_financial_postings SET status='pending_period',account_id=v_account,period_id=NULL,updated_at=clock_timestamp()
      WHERE payment_entry_id=p_entry;
    RETURN 'pending_period';
  END IF;
  -- The opening balance is an operator-entered snapshot of current real money.
  -- Older wholesale entries are therefore retained as audit records, not replayed.
  IF v_entry.created_at<=v_activation THEN
    UPDATE public.wholesale_financial_postings SET status='included_in_opening_balance',account_id=v_account,period_id=NULL,updated_at=clock_timestamp()
      WHERE payment_entry_id=p_entry;
    RETURN 'included_in_opening_balance';
  END IF;
  PERFORM id FROM public.financial_periods WHERE status='open' ORDER BY id FOR SHARE;
  IF (SELECT count(*) FROM public.financial_periods WHERE status='open')<>1 THEN
    UPDATE public.wholesale_financial_postings SET status='pending_period',account_id=v_account,period_id=NULL,updated_at=clock_timestamp()
      WHERE payment_entry_id=p_entry;
    RETURN 'pending_period';
  END IF;
  SELECT id INTO v_period FROM public.financial_periods WHERE status='open' AND starts_at<=clock_timestamp()
    AND ends_at IS NULL AND closed_at IS NULL;
  IF v_period IS NULL THEN
    UPDATE public.wholesale_financial_postings SET status='pending_period',account_id=v_account,period_id=NULL,updated_at=clock_timestamp()
      WHERE payment_entry_id=p_entry;
    RETURN 'pending_period';
  END IF;
  INSERT INTO public.cash_movements(movement_type,amount,description,occurred_at,account_id,period_id,wholesale_payment_entry_id)
    VALUES(CASE WHEN v_entry.entry_type='payment' THEN 'income' ELSE 'refund' END,
      CASE WHEN v_entry.entry_type='payment' THEN v_entry.amount ELSE -v_entry.amount END,
      concat(CASE WHEN v_entry.entry_type='payment' THEN 'Cobro' ELSE 'Reembolso' END,
        ' mayorista · pedido ',v_entry.order_id,' · operación ',p_entry),
      v_entry.occurred_at,v_account,v_period,p_entry)
    ON CONFLICT(wholesale_payment_entry_id) WHERE wholesale_payment_entry_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_movement;
  IF v_movement IS NULL THEN SELECT id INTO v_movement FROM public.cash_movements WHERE wholesale_payment_entry_id=p_entry; END IF;
  UPDATE public.wholesale_financial_postings SET status='posted',account_id=v_account,period_id=v_period,
    cash_movement_id=v_movement,posted_at=COALESCE(posted_at,clock_timestamp()),updated_at=clock_timestamp()
    WHERE payment_entry_id=p_entry;
  RETURN 'posted';
END; $$;

CREATE FUNCTION public.capture_wholesale_financial_entry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN PERFORM public.post_wholesale_financial_entry(NEW.id); RETURN NEW; END; $$;
CREATE TRIGGER wholesale_payment_financial_posting AFTER INSERT ON public.wholesale_payment_entries
FOR EACH ROW EXECUTE FUNCTION public.capture_wholesale_financial_entry();

CREATE FUNCTION public.set_wholesale_financial_account_mapping(p_method TEXT,p_account_id VARCHAR,p_actor UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_old VARCHAR(40); v_entry UUID; v_result TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('wholesale_financial_posting'));
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  IF p_method NOT IN ('cash','bank_transfer','mercadopago','debit_card','credit_card','other') THEN
    RAISE EXCEPTION 'WHOLESALE_FINANCE_INVALID_METHOD';
  END IF;
  IF p_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.financial_accounts WHERE id=p_account_id AND active) THEN
    RAISE EXCEPTION 'WHOLESALE_FINANCE_ACCOUNT_INVALID';
  END IF;
  SELECT account_id INTO v_old FROM public.wholesale_financial_account_mappings WHERE payment_method=p_method FOR UPDATE;
  INSERT INTO public.wholesale_financial_account_mappings(payment_method,account_id,configured_by,configured_at)
    VALUES(p_method,p_account_id,p_actor,clock_timestamp())
    ON CONFLICT(payment_method) DO UPDATE SET account_id=EXCLUDED.account_id,configured_by=p_actor,configured_at=clock_timestamp();
  INSERT INTO public.wholesale_financial_account_mapping_events(payment_method,account_id,actor_id)
    VALUES(p_method,p_account_id,p_actor);
  -- Already-posted entries keep their original account and period. Only pending
  -- entries are considered, and they enter the currently open period.
  FOR v_entry IN SELECT payment_entry_id FROM public.wholesale_financial_postings
    WHERE status IN ('pending_mapping','pending_period','unsupported_currency')
      AND EXISTS(SELECT 1 FROM public.wholesale_payment_entries pe WHERE pe.id=payment_entry_id AND pe.payment_method=p_method)
    ORDER BY payment_entry_id FOR UPDATE
  LOOP
    SELECT public.post_wholesale_financial_entry(v_entry) INTO v_result;
  END LOOP;
  RETURN COALESCE(p_account_id,'unmapped');
END; $$;

CREATE FUNCTION public.retry_wholesale_financial_postings(p_actor UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_entry UUID; v_status TEXT; v_count INTEGER:=0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('wholesale_financial_posting'));
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  FOR v_entry IN SELECT payment_entry_id FROM public.wholesale_financial_postings
    WHERE status IN ('pending_mapping','pending_period','unsupported_currency') ORDER BY payment_entry_id FOR UPDATE
  LOOP
    SELECT public.post_wholesale_financial_entry(v_entry) INTO v_status;
    IF v_status='posted' OR v_status='included_in_opening_balance' THEN v_count:=v_count+1; END IF;
  END LOOP;
  RETURN v_count;
END; $$;

-- A period cannot be sealed while real money entries from it are absent from its
-- account balances. Unsupported currencies also block closure until the ledger
-- can represent them safely. The existing close function's carry-forward remains.
CREATE OR REPLACE FUNCTION public.close_financial_period(p_name VARCHAR,p_reset_to_zero BOOLEAN,p_idempotency_key UUID)
RETURNS UUID LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_old UUID; v_new UUID; v_account RECORD; v_balance NUMERIC; v_kind VARCHAR; v_result UUID;
BEGIN
  IF p_idempotency_key IS NULL OR btrim(COALESCE(p_name,''))='' THEN RAISE EXCEPTION 'Cierre inválido.' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('wholesale_financial_posting'));
  INSERT INTO financial_operation_requests(idempotency_key,operation_type) VALUES(p_idempotency_key,'period_close') ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN SELECT operation_type,result_id INTO v_kind,v_result FROM financial_operation_requests r WHERE r.idempotency_key=p_idempotency_key; IF v_kind<>'period_close' THEN RAISE EXCEPTION 'Clave de idempotencia reutilizada.' USING ERRCODE='23505'; END IF; RETURN v_result; END IF;
  SELECT id INTO v_old FROM financial_periods WHERE status='open' FOR UPDATE; IF v_old IS NULL THEN RAISE EXCEPTION 'No existe un período abierto.' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM wholesale_financial_postings p JOIN wholesale_payment_entries e ON e.id=p.payment_entry_id
    -- Include unresolved history from earlier periods, but not entries already
    -- covered by the activation snapshot. Other ledgers are outside this guard.
    WHERE p.status IN ('pending_mapping','pending_period','unsupported_currency')
      AND e.created_at>(SELECT activated_at FROM financial_activation WHERE singleton)
      AND e.created_at<=clock_timestamp()) THEN
    RAISE EXCEPTION 'WHOLESALE_FINANCIAL_POSTINGS_PENDING' USING ERRCODE='23514';
  END IF;
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

-- Finance activation snapshots current balances; do not replay pre-activation
-- wholesale history into that opening balance later.
CREATE FUNCTION public.mark_wholesale_entries_in_opening_balance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('wholesale_financial_posting'));
  UPDATE public.wholesale_financial_postings p SET status='included_in_opening_balance',period_id=NULL,
    cash_movement_id=NULL,posted_at=NULL,updated_at=clock_timestamp()
  FROM public.wholesale_payment_entries e
  WHERE e.id=p.payment_entry_id AND e.created_at<=NEW.activated_at
    AND p.status IN ('pending_mapping','pending_period','unsupported_currency');
  RETURN NEW;
END; $$;
CREATE TRIGGER financial_activation_wholesale_snapshot AFTER INSERT ON public.financial_activation
FOR EACH ROW EXECUTE FUNCTION public.mark_wholesale_entries_in_opening_balance();

-- Import existing ledger entries into the active period only when their method
-- has a mapping. Pre-activation history is covered by the operator's opening snapshot.
DO $$ DECLARE v_entry UUID; BEGIN
  FOR v_entry IN SELECT id FROM public.wholesale_payment_entries ORDER BY occurred_at,id LOOP
    PERFORM public.post_wholesale_financial_entry(v_entry);
  END LOOP;
END; $$;

ALTER TABLE public.wholesale_financial_account_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wholesale_financial_account_mapping_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wholesale_financial_postings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wholesale_financial_account_mappings,public.wholesale_financial_account_mapping_events,
  public.wholesale_financial_postings FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.wholesale_financial_account_mappings,public.wholesale_financial_account_mapping_events,
  public.wholesale_financial_postings TO service_role;
REVOKE ALL ON FUNCTION public.post_wholesale_financial_entry(UUID),public.capture_wholesale_financial_entry(),
  public.mark_wholesale_entries_in_opening_balance(),public.guard_wholesale_cash_movement(),
  public.set_wholesale_financial_account_mapping(TEXT,VARCHAR,UUID),public.retry_wholesale_financial_postings(UUID)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_wholesale_financial_account_mapping(TEXT,VARCHAR,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_wholesale_financial_postings(UUID) TO service_role;

COMMIT;
