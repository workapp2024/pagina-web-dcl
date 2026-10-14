-- PROPUESTA: NO APLICADA. Autorización adicional requerida.
-- Neutraliza solo el par confirmado de MW-000004, sin crear ingresos de caja.
BEGIN;
ALTER TABLE public.wholesale_financial_postings DROP CONSTRAINT wholesale_financial_postings_status_check;
ALTER TABLE public.wholesale_financial_postings ADD CONSTRAINT wholesale_financial_postings_status_check
CHECK(status IN('pending_mapping','pending_period','unsupported_currency','posted','included_in_opening_balance','neutralized_test_pair'));
CREATE TABLE public.confirmed_test_wholesale_neutralizations (
  payment_id UUID PRIMARY KEY REFERENCES public.wholesale_payment_entries(id),
  refund_id UUID NOT NULL UNIQUE REFERENCES public.wholesale_payment_entries(id),
  idempotency_key UUID NOT NULL UNIQUE,actor_id UUID NOT NULL,
  original_postings JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.confirmed_test_wholesale_neutralizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.confirmed_test_wholesale_neutralizations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.confirmed_test_wholesale_neutralizations TO service_role;
CREATE TRIGGER confirmed_test_wholesale_neutralizations_immutable BEFORE UPDATE OR DELETE ON public.confirmed_test_wholesale_neutralizations
FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_event_immutable();
CREATE OR REPLACE FUNCTION public.post_wholesale_financial_entry(p_entry UUID)
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
  IF v_status IN ('posted','included_in_opening_balance','neutralized_test_pair') THEN RETURN v_status; END IF;
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

CREATE FUNCTION public.neutralize_confirmed_test_wholesale_pair(p_actor UUID,p_key UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_payment UUID:='dc6124a6-d680-4edf-9384-777803e5ad03';v_refund UUID;v_before JSONB;
  v_previous public.confirmed_test_wholesale_neutralizations%ROWTYPE;
BEGIN
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  IF p_key IS NULL THEN RAISE EXCEPTION 'TEST_REVERSAL_INVALID_KEY'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('wholesale_financial_posting'));
  SELECT * INTO v_previous FROM public.confirmed_test_wholesale_neutralizations WHERE payment_id=v_payment;
  IF FOUND THEN
    IF v_previous.idempotency_key<>p_key OR v_previous.actor_id<>p_actor THEN RAISE EXCEPTION 'TEST_REVERSAL_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN v_payment;
  END IF;
  PERFORM id FROM public.wholesale_orders WHERE id='bd6ddd6a-b8df-4402-96f9-b039dca0aa93' AND status='cancelled' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEST_WHOLESALE_NOT_CANCELLED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.wholesale_payment_entries WHERE id=v_payment AND order_id='bd6ddd6a-b8df-4402-96f9-b039dca0aa93' AND entry_type='payment' AND amount=78446 AND currency='ARS' AND payment_method='cash')
    OR (SELECT count(*) FROM public.wholesale_payment_entries WHERE refund_of=v_payment)<>1 THEN RAISE EXCEPTION 'TEST_WHOLESALE_PAIR_CHANGED'; END IF;
  SELECT id INTO v_refund FROM public.wholesale_payment_entries WHERE refund_of=v_payment AND entry_type='refund' AND amount=78446 AND currency='ARS' AND payment_method='cash' AND external_reference='DCL-TEST-REGULARIZATION-MW-000004';
  IF NOT FOUND THEN RAISE EXCEPTION 'TEST_WHOLESALE_PAIR_CHANGED'; END IF;
  IF (SELECT COALESCE(sum(amount),0) FROM public.wholesale_sale_recognitions WHERE order_id='bd6ddd6a-b8df-4402-96f9-b039dca0aa93')
    <> (SELECT COALESCE(sum(amount),0) FROM public.wholesale_sale_reversals WHERE order_id='bd6ddd6a-b8df-4402-96f9-b039dca0aa93') THEN RAISE EXCEPTION 'TEST_WHOLESALE_RECOGNITION_NOT_REVERSED'; END IF;
  PERFORM payment_entry_id FROM public.wholesale_financial_postings WHERE payment_entry_id IN(v_payment,v_refund) ORDER BY payment_entry_id FOR UPDATE;
  IF (SELECT count(*) FROM public.wholesale_financial_postings WHERE payment_entry_id IN(v_payment,v_refund))<>2
    OR EXISTS(SELECT 1 FROM public.wholesale_financial_postings WHERE payment_entry_id IN(v_payment,v_refund) AND (status<>'pending_mapping' OR cash_movement_id IS NOT NULL OR posted_at IS NOT NULL))
    OR EXISTS(SELECT 1 FROM public.cash_movements WHERE wholesale_payment_entry_id IN(v_payment,v_refund)) THEN RAISE EXCEPTION 'TEST_WHOLESALE_ALREADY_POSTED'; END IF;
  SELECT jsonb_agg(to_jsonb(p)) INTO v_before FROM public.wholesale_financial_postings p WHERE payment_entry_id IN(v_payment,v_refund);
  INSERT INTO public.confirmed_test_wholesale_neutralizations(payment_id,refund_id,idempotency_key,actor_id,original_postings)
    VALUES(v_payment,v_refund,p_key,p_actor,v_before);
  UPDATE public.wholesale_financial_postings SET status='neutralized_test_pair',updated_at=clock_timestamp() WHERE payment_entry_id IN(v_payment,v_refund);
  RETURN v_payment;
END $$;
REVOKE ALL ON FUNCTION public.neutralize_confirmed_test_wholesale_pair(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.neutralize_confirmed_test_wholesale_pair(UUID,UUID) TO service_role;
COMMIT;
