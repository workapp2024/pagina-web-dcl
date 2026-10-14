-- PROPUESTA: NO APLICADA. Requiere autorización adicional del administrador.
-- Alcance cerrado a cinco pedidos entregados y una instalación de prueba.
-- No llama APIs de pago ni elimina historiales. Las escrituras son atómicas.
BEGIN;

CREATE TABLE public.confirmed_test_reversals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES public.orders(id),
  sale_id UUID NOT NULL UNIQUE REFERENCES public.sales(id),
  idempotency_key UUID NOT NULL UNIQUE,
  actor_id UUID NOT NULL,
  reason TEXT NOT NULL,
  original_order JSONB NOT NULL,
  original_payment JSONB NOT NULL,
  original_sale JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.confirmed_test_reversals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.confirmed_test_reversals FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.confirmed_test_reversals TO service_role;
CREATE TRIGGER confirmed_test_reversals_immutable BEFORE UPDATE OR DELETE ON public.confirmed_test_reversals
FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_event_immutable();

-- The ordinary guard remains intact except for the audited final transition.
-- It never makes a delivered order editable or payable again.
CREATE OR REPLACE FUNCTION public.guard_order_operations() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.operational_status IS DISTINCT FROM 'received' THEN RAISE EXCEPTION 'OPERATIONAL_INITIAL_STATE'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.order_number IS DISTINCT FROM OLD.order_number THEN RAISE EXCEPTION 'ORDER_NUMBER_IMMUTABLE'; END IF;
  IF NEW.operational_status IS NOT DISTINCT FROM OLD.operational_status THEN RETURN NEW; END IF;
  IF OLD.operational_status='delivered' AND NEW.operational_status='cancelled'
    AND NEW.status='cancelled' AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at
    AND EXISTS(SELECT 1 FROM public.confirmed_test_reversals r JOIN public.sales s ON s.id=r.sale_id
      JOIN public.payment_transactions t ON t.order_id=r.order_id AND t.sale_id=r.sale_id
      WHERE r.order_id=OLD.id AND r.id::TEXT=current_setting('dcl.confirmed_test_regularization',TRUE)
      AND s.status='cancelled' AND t.status='cancelled' AND s.total=1 AND t.amount=1)
    THEN RETURN NEW; END IF;
  IF OLD.operational_status IN ('delivered','cancelled') THEN RAISE EXCEPTION 'OPERATIONAL_INVALID_TRANSITION'; END IF;
  PERFORM id FROM payment_transactions WHERE order_id=OLD.id ORDER BY id FOR UPDATE;
  PERFORM s.id FROM sales s WHERE s.id IN
    (SELECT sale_id FROM payment_transactions WHERE order_id=OLD.id) ORDER BY s.id FOR SHARE;
  IF NEW.operational_status='cancelled' THEN
    IF current_setting('dcl.order_resolution',TRUE)=OLD.id::TEXT
       AND NEW.status IN ('cancelled','refunded')
       AND EXISTS(SELECT 1 FROM payment_transactions t WHERE t.order_id=OLD.id
         AND t.status=CASE WHEN NEW.status='refunded' THEN 'refunded' ELSE 'cancelled' END
         AND (t.sale_id IS NULL OR EXISTS(SELECT 1 FROM sales s WHERE s.id=t.sale_id AND s.status='cancelled')))
       AND NOT EXISTS(SELECT 1 FROM payment_transactions t WHERE t.order_id=OLD.id
         AND (t.status IN ('pending','approved','error') OR (t.sale_id IS NOT NULL
           AND NOT EXISTS(SELECT 1 FROM sales s WHERE s.id=t.sale_id AND s.status='cancelled'))))
    THEN RETURN NEW; END IF;
    IF NEW.status IN ('paid','completed') OR EXISTS(
      SELECT 1 FROM payment_transactions WHERE order_id=OLD.id
      AND (status IN ('approved','refunded') OR sale_id IS NOT NULL)
    ) THEN RAISE EXCEPTION 'OPERATIONAL_FINANCIAL_REVERSAL_REQUIRED'; END IF;
    IF NEW.status NOT IN ('cancelled','rejected')
      OR NOT EXISTS(SELECT 1 FROM payment_transactions WHERE order_id=OLD.id)
      OR EXISTS(SELECT 1 FROM payment_transactions WHERE order_id=OLD.id AND status NOT IN ('cancelled','rejected','error'))
    THEN RAISE EXCEPTION 'OPERATIONAL_CLOSE_PAYMENT_FIRST'; END IF;
  ELSE
    IF NOT ((OLD.operational_status='received' AND NEW.operational_status='preparing')
      OR (OLD.operational_status='preparing' AND NEW.operational_status='ready')
      OR (OLD.operational_status='ready' AND NEW.operational_status='delivered'))
    THEN RAISE EXCEPTION 'OPERATIONAL_INVALID_TRANSITION'; END IF;
    IF NEW.status NOT IN ('paid','completed') OR NOT EXISTS(
      SELECT 1 FROM payment_transactions t JOIN sales s ON s.id=t.sale_id
      WHERE t.order_id=OLD.id AND t.status='approved' AND s.status='completed'
    ) THEN RAISE EXCEPTION 'OPERATIONAL_PAYMENT_REQUIRED'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.regularize_confirmed_delivered_test(p_order UUID,p_actor UUID,p_key UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_expected UUID; v_expected_income UUID; v_order public.orders%ROWTYPE;
  v_sale public.sales%ROWTYPE; v_payment public.payment_transactions%ROWTYPE;
  v_income public.cash_movements%ROWTYPE; v_previous public.confirmed_test_reversals%ROWTYPE;
  v_id UUID:=gen_random_uuid(); v_reason TEXT:='Regularización inicial de datos de prueba autorizada por administrador';
BEGIN
  IF p_key IS NULL THEN RAISE EXCEPTION 'TEST_REVERSAL_INVALID_KEY'; END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  SELECT sale_id,income_id INTO v_expected,v_expected_income FROM (VALUES
    ('3b02118b-cc18-48fb-ae72-f05893a080db'::UUID,'8d505ad0-7d96-4d3f-923c-3652225285ef'::UUID,NULL::UUID),
    ('8d2bf8fe-8590-4a71-933e-e916eb87977e'::UUID,'441dda5d-f78b-43e1-b195-021a9d815963'::UUID,NULL::UUID),
    ('bfa2aad5-ca81-4873-8741-1e38284f44cb'::UUID,'ab65f6f8-5f0a-4aa7-9db0-71319b4b0dd8'::UUID,NULL::UUID),
    ('3622b1fa-899b-4a01-b275-cf4bfd920c6a'::UUID,'82111eb9-6472-4d00-8364-443819b65583'::UUID,'2f1e0f74-b9da-41ff-a6bc-2ec58d8e280f'::UUID),
    ('3fc59d89-b010-424f-bab6-aa786684f131'::UUID,'a78def9b-cdd2-49e7-ad1c-746ae035e278'::UUID,'e84df70e-74f6-4a62-923f-f5c2be5a6084'::UUID)
  ) targets(order_id,sale_id,income_id) WHERE order_id=p_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEST_REVERSAL_OUT_OF_SCOPE'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('confirmed-test-reversal:'||p_order::TEXT,0));
  SELECT * INTO v_previous FROM public.confirmed_test_reversals WHERE order_id=p_order OR idempotency_key=p_key;
  IF FOUND THEN
    IF v_previous.order_id<>p_order OR v_previous.idempotency_key<>p_key OR v_previous.actor_id<>p_actor THEN RAISE EXCEPTION 'TEST_REVERSAL_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN v_previous.id;
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND OR v_order.status<>'completed' OR v_order.operational_status<>'delivered' OR v_order.total<>1 OR v_order.payment_method<>'transfer' THEN RAISE EXCEPTION 'TEST_REVERSAL_ORDER_CHANGED'; END IF;
  IF (SELECT count(*) FROM public.payment_transactions WHERE order_id=p_order)<>1 THEN RAISE EXCEPTION 'TEST_REVERSAL_PAYMENT_AMBIGUOUS'; END IF;
  SELECT * INTO v_payment FROM public.payment_transactions WHERE order_id=p_order FOR UPDATE;
  IF v_payment.sale_id IS DISTINCT FROM v_expected OR v_payment.status<>'approved' OR v_payment.provider<>'transfer' OR v_payment.amount<>1 OR v_payment.currency<>'ARS' THEN RAISE EXCEPTION 'TEST_REVERSAL_PAYMENT_CHANGED'; END IF;
  SELECT * INTO v_sale FROM public.sales WHERE id=v_expected FOR UPDATE;
  IF NOT FOUND OR v_sale.status<>'completed' OR v_sale.total<>1 OR v_sale.customer_id<>v_order.customer_id OR v_sale.payment_method<>'transfer' THEN RAISE EXCEPTION 'TEST_REVERSAL_SALE_CHANGED'; END IF;
  IF (SELECT count(*) FROM public.sale_items WHERE sale_id=v_expected)<>1 OR NOT EXISTS(SELECT 1 FROM public.sale_items WHERE sale_id=v_expected AND product_id='producto-1790288673630' AND quantity=1 AND line_total=1)
    OR (SELECT count(*) FROM public.inventory_movements WHERE reference_type='sale' AND reference_id=v_expected::TEXT AND product_id='producto-1790288673630' AND quantity_delta=-1)<>1
    OR EXISTS(SELECT 1 FROM public.inventory_reservations WHERE product_id='producto-1790288673630' AND status='active')
    OR EXISTS(SELECT 1 FROM public.inventory_movements WHERE reference_type='sale_reversal' AND reference_id=v_expected::TEXT)
    OR EXISTS(SELECT 1 FROM public.cash_movements WHERE sale_id=v_expected AND movement_type='sale_reversal') THEN RAISE EXCEPTION 'TEST_REVERSAL_EFFECTS_CHANGED'; END IF;
  IF (SELECT count(*) FROM public.cash_movements WHERE sale_id=v_expected AND movement_type='sale_income')<>(CASE WHEN v_expected_income IS NULL THEN 0 ELSE 1 END) THEN RAISE EXCEPTION 'TEST_REVERSAL_INCOME_CHANGED'; END IF;
  IF v_expected_income IS NOT NULL THEN
    SELECT * INTO v_income FROM public.cash_movements WHERE id=v_expected_income AND sale_id=v_expected FOR UPDATE;
    IF NOT FOUND OR v_income.amount<>1 OR v_income.movement_type<>'sale_income' OR v_income.account_id<>'mercadopago' THEN RAISE EXCEPTION 'TEST_REVERSAL_INCOME_CHANGED'; END IF;
    PERFORM id FROM public.financial_periods WHERE id=v_income.period_id AND status='open' AND ends_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'TEST_REVERSAL_PERIOD_CLOSED'; END IF;
  END IF;
  PERFORM id FROM public.products WHERE id='producto-1790288673630' FOR UPDATE;
  INSERT INTO public.confirmed_test_reversals(id,order_id,sale_id,idempotency_key,actor_id,reason,original_order,original_payment,original_sale)
    VALUES(v_id,p_order,v_expected,p_key,p_actor,v_reason,to_jsonb(v_order),to_jsonb(v_payment),to_jsonb(v_sale));
  INSERT INTO public.inventory_movements(product_id,movement_type,quantity_delta,reason,reference_type,reference_id)
    VALUES('producto-1790288673630','ajuste',1,v_reason,'sale_reversal',v_expected::TEXT);
  IF v_expected_income IS NOT NULL THEN
    INSERT INTO public.cash_movements(movement_type,amount,description,sale_id,account_id,period_id,reversal_of_id)
      VALUES('sale_reversal',-v_income.amount,v_reason,v_expected,v_income.account_id,v_income.period_id,v_income.id);
  END IF;
  UPDATE public.sales SET status='cancelled',cancelled_at=clock_timestamp(),cancellation_reason=v_reason WHERE id=v_expected;
  UPDATE public.warranties SET status='void' WHERE status='active' AND sale_item_id IN(SELECT id FROM public.sale_items WHERE sale_id=v_expected);
  UPDATE public.payment_transactions SET status='cancelled' WHERE id=v_payment.id;
  PERFORM set_config('dcl.confirmed_test_regularization',v_id::TEXT,TRUE);
  UPDATE public.orders SET status='cancelled',operational_status='cancelled' WHERE id=p_order;
  PERFORM set_config('dcl.confirmed_test_regularization','',TRUE);
  INSERT INTO public.order_notes(order_id,note) VALUES(p_order,v_reason||' · registro '||v_id::TEXT||' · sin reembolso externo');
  RETURN v_id;
END $$;

CREATE TABLE public.confirmed_test_installation_invalidations (
  installation_id UUID PRIMARY KEY REFERENCES public.installations(id),
  idempotency_key UUID NOT NULL UNIQUE, actor_id UUID NOT NULL,
  original_installation JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.confirmed_test_installation_invalidations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.confirmed_test_installation_invalidations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.confirmed_test_installation_invalidations TO service_role;
CREATE TRIGGER confirmed_test_installation_invalidations_immutable BEFORE UPDATE OR DELETE ON public.confirmed_test_installation_invalidations
FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_event_immutable();
CREATE FUNCTION public.invalidate_confirmed_test_installation(p_actor UUID,p_key UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_install public.installations%ROWTYPE; v_previous public.confirmed_test_installation_invalidations%ROWTYPE;
BEGIN
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  IF p_key IS NULL THEN RAISE EXCEPTION 'TEST_REVERSAL_INVALID_KEY'; END IF;
  SELECT * INTO v_install FROM public.installations WHERE id='470a2110-0bfb-40ca-a002-5a841dc6dbb0' FOR UPDATE;
  IF NOT FOUND OR v_install.sale_id<>'49a5d8de-9ccb-4172-a54a-c3e2f1abb31e' OR NOT EXISTS(SELECT 1 FROM public.sales WHERE id=v_install.sale_id AND status='cancelled') THEN RAISE EXCEPTION 'TEST_INSTALLATION_CHANGED'; END IF;
  SELECT * INTO v_previous FROM public.confirmed_test_installation_invalidations WHERE installation_id=v_install.id;
  IF FOUND THEN
    IF v_previous.idempotency_key<>p_key OR v_previous.actor_id<>p_actor THEN RAISE EXCEPTION 'TEST_REVERSAL_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN v_install.id;
  END IF;
  IF v_install.status<>'completed' OR v_install.completed_at IS NULL THEN RAISE EXCEPTION 'TEST_INSTALLATION_CHANGED'; END IF;
  INSERT INTO public.confirmed_test_installation_invalidations(installation_id,idempotency_key,actor_id,original_installation)
    VALUES(v_install.id,p_key,p_actor,to_jsonb(v_install));
  UPDATE public.installations SET status='cancelled' WHERE id=v_install.id;
  RETURN v_install.id;
END $$;
REVOKE ALL ON FUNCTION public.regularize_confirmed_delivered_test(UUID,UUID,UUID),public.invalidate_confirmed_test_installation(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.regularize_confirmed_delivered_test(UUID,UUID,UUID),public.invalidate_confirmed_test_installation(UUID,UUID) TO service_role;
-- Preserve the installed definition exported with the verified backup; add only the scoped test exception.
CREATE OR REPLACE FUNCTION public.order_archive_block_reason(p_order uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN o.status='cancelled' AND o.operational_status='cancelled'
      AND EXISTS(SELECT 1 FROM public.confirmed_test_reversals r JOIN public.sales s ON s.id=r.sale_id
        JOIN public.payment_transactions t ON t.order_id=r.order_id AND t.sale_id=r.sale_id
        WHERE r.order_id=o.id AND s.status='cancelled' AND t.status='cancelled')
      AND NOT EXISTS(SELECT 1 FROM public.inventory_reservations WHERE order_id=o.id AND status='active') THEN NULL
    WHEN o.operational_status NOT IN ('delivered', 'cancelled')
      THEN 'ORDER_NOT_TERMINAL'

    WHEN o.status NOT IN ('paid', 'completed', 'cancelled', 'rejected', 'refunded')
      THEN 'ORDER_REQUIRES_ATTENTION'

    WHEN (
      SELECT count(*)
      FROM public.payment_transactions pt
      WHERE pt.order_id = o.id
    ) <> 1
      THEN 'PAYMENT_AMBIGUOUS'

    WHEN o.status = 'refunded' AND EXISTS (
      SELECT 1
      FROM public.payment_transactions pt
      WHERE pt.order_id = o.id
        AND pt.status <> 'refunded'
    )
      THEN 'PAYMENT_REQUIRES_ATTENTION'

    WHEN o.status <> 'refunded' AND EXISTS (
      SELECT 1
      FROM public.payment_transactions pt
      WHERE pt.order_id = o.id
        AND pt.status IN ('pending', 'error', 'refunded')
    )
      THEN 'PAYMENT_REQUIRES_ATTENTION'

    WHEN EXISTS (
      SELECT 1
      FROM public.inventory_reservations ir
      WHERE ir.order_id = o.id
        AND ir.status = 'active'
        AND ir.expires_at > statement_timestamp()
    )
      THEN 'RESERVATION_ACTIVE'

    WHEN EXISTS (
      SELECT 1
      FROM public.payment_transactions pt
      WHERE pt.order_id = o.id
        AND (pt.amount <> o.total OR pt.currency <> o.currency)
    )
      THEN 'PAYMENT_MISMATCH'

    WHEN o.status = 'refunded' AND (
      o.operational_status <> 'cancelled'
      OR EXISTS (
        SELECT 1
        FROM public.payment_transactions pt
        LEFT JOIN public.sales s ON s.id = pt.sale_id
        WHERE pt.order_id = o.id
          AND pt.sale_id IS NOT NULL
          AND (
            s.id IS NULL
            OR s.status <> 'cancelled'
            OR s.customer_id <> o.customer_id
            OR s.total <> o.total
          )
      )
    )
      THEN 'CANCELLATION_FINANCIAL_MISMATCH'

    WHEN o.operational_status = 'delivered' AND (
      o.status <> 'completed'
      OR NOT EXISTS (
        SELECT 1
        FROM public.payment_transactions pt
        JOIN public.sales s ON s.id = pt.sale_id
        WHERE pt.order_id = o.id
          AND pt.status = 'approved'
          AND s.status = 'completed'
          AND s.total = o.total
      )
    )
      THEN 'DELIVERY_FINANCIAL_MISMATCH'

    WHEN o.operational_status = 'cancelled'
      AND o.status <> 'refunded'
      AND (
        o.status NOT IN ('cancelled', 'rejected')
        OR EXISTS (
          SELECT 1
          FROM public.payment_transactions pt
          WHERE pt.order_id = o.id
            AND (
              pt.status NOT IN ('cancelled', 'rejected')
              OR pt.sale_id IS NOT NULL
            )
        )
      )
      THEN 'CANCELLATION_FINANCIAL_MISMATCH'

    ELSE NULL
  END
  FROM public.orders o
  WHERE o.id = p_order;
$function$
;
COMMIT;
