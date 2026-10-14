-- PREPARED ONLY. Apply only after approval and installed-function comparison.
BEGIN;
CREATE FUNCTION public.zero_confirmed_test_stock(p_actor UUID,p_key UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' SET statement_timeout='30s' AS $$
DECLARE v_stock INTEGER; v_existing public.inventory_movements%ROWTYPE;
BEGIN
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  IF p_key IS NULL THEN RAISE EXCEPTION 'TEST_INVALID_KEY'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('dcl_test_stock_zero'));
  -- NOWAIT: abort rather than interfere with an operation already running.
  LOCK TABLE public.inventory_reservations IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  SELECT stock INTO v_stock FROM public.products
    WHERE id='producto-1790288673630' FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEST_PRODUCT_MISSING'; END IF;
  IF EXISTS(SELECT 1 FROM public.inventory_reservations
    WHERE product_id='producto-1790288673630' AND status='active') THEN
    RAISE EXCEPTION 'TEST_ACTIVE_RESERVATIONS'; END IF;
  SELECT * INTO v_existing FROM public.inventory_movements WHERE id=p_key;
  IF FOUND THEN
    IF v_existing.product_id<>'producto-1790288673630' OR v_existing.quantity_delta<>-10
      OR v_existing.reference_type<>'initial_test_regularization' OR v_stock<>0 THEN
      RAISE EXCEPTION 'TEST_STOCK_REPLAY_CONFLICT'; END IF;
    RETURN;
  END IF;
  IF v_stock<>10 OR (SELECT count(*) FROM public.confirmed_test_reversals)<>5
    OR EXISTS(SELECT 1 FROM public.confirmed_test_reversals r
      JOIN public.sales s ON s.id=r.sale_id JOIN public.orders o ON o.id=r.order_id
      WHERE s.status<>'cancelled' OR o.operational_status<>'cancelled') THEN
    RAISE EXCEPTION 'TEST_STOCK_STATE_CHANGED'; END IF;
  INSERT INTO public.inventory_movements(id,product_id,movement_type,quantity_delta,reason,reference_type,reference_id)
  VALUES(p_key,'producto-1790288673630','ajuste',-10,
    'Regularización inicial de datos de prueba autorizada por administrador',
    'initial_test_regularization','producto-1790288673630');
  IF (SELECT stock FROM public.products WHERE id='producto-1790288673630')<>0 THEN
    RAISE EXCEPTION 'TEST_STOCK_NOT_ZERO'; END IF;
END $$;
CREATE FUNCTION public.map_confirmed_test_cash_safely(p_actor UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' SET statement_timeout='30s' AS $$
DECLARE v_payment UUID:='dc6124a6-d680-4edf-9384-777803e5ad03'; v_refund UUID;
BEGIN
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  PERFORM pg_advisory_xact_lock(hashtext('wholesale_financial_posting'));
  LOCK TABLE public.wholesale_payment_entries,public.wholesale_financial_postings,
    public.wholesale_financial_account_mappings,public.cash_movements
    IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  SELECT refund_id INTO v_refund FROM public.confirmed_test_wholesale_neutralizations WHERE payment_id=v_payment;
  IF NOT FOUND OR (SELECT count(*) FROM public.wholesale_financial_postings
    WHERE payment_entry_id IN(v_payment,v_refund) AND status='neutralized_test_pair'
    AND cash_movement_id IS NULL AND posted_at IS NULL)<>2 THEN
    RAISE EXCEPTION 'TEST_PAIR_NOT_NEUTRALIZED'; END IF;
  IF EXISTS(SELECT 1 FROM public.wholesale_payment_entries e
    LEFT JOIN public.wholesale_financial_postings p ON p.payment_entry_id=e.id
    WHERE e.payment_method='cash' AND e.id NOT IN(v_payment,v_refund)
      AND (p.status IS NULL OR p.status NOT IN('posted','included_in_opening_balance','neutralized_test_pair'))) THEN
    RAISE EXCEPTION 'TEST_OTHER_CASH_PENDING'; END IF;
  IF (SELECT COALESCE(sum(amount),0) FROM public.cash_movements)<>0 THEN
    RAISE EXCEPTION 'TEST_CASH_BALANCE_CHANGED'; END IF;
  IF (SELECT account_id FROM public.wholesale_financial_account_mappings WHERE payment_method='cash')='cash' THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM public.wholesale_financial_account_mappings
    WHERE payment_method='cash' AND account_id IS NOT NULL) THEN RAISE EXCEPTION 'TEST_MAPPING_CHANGED'; END IF;
  PERFORM public.set_wholesale_financial_account_mapping('cash','cash',p_actor);
  IF EXISTS(SELECT 1 FROM public.cash_movements WHERE wholesale_payment_entry_id IN(v_payment,v_refund)) THEN
    RAISE EXCEPTION 'TEST_PAIR_POSTED'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.zero_confirmed_test_stock(UUID,UUID),public.map_confirmed_test_cash_safely(UUID)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.zero_confirmed_test_stock(UUID,UUID),public.map_confirmed_test_cash_safely(UUID) TO service_role;
COMMIT;
