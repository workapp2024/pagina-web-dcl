-- A2: no backfill. Provider verification is performed server-side before these RPCs.
BEGIN;
ALTER TABLE public.payment_transactions
  ADD COLUMN provider_recovery_version SMALLINT NOT NULL DEFAULT 1 CHECK (provider_recovery_version IN (1,2)),
  ADD COLUMN provider_request_started_at TIMESTAMPTZ,
  ADD COLUMN recovery_issue TEXT CHECK (recovery_issue IN
    ('awaiting_provider','verification_failed','binding_conflict','completion_failed'));
-- Existing rows may already have charged under A1. Never submit them again.
-- A constant column default labels legacy rows without a data UPDATE/backfill.
ALTER TABLE public.payment_transactions ALTER COLUMN provider_recovery_version SET DEFAULT 2;

-- Claim once before any Orders POST. An uncertain response must NEVER cause another POST.
CREATE FUNCTION public.begin_mercadopago_request(p_order UUID) RETURNS BOOLEAN
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_order orders%ROWTYPE; v_payment payment_transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id=p_order FOR UPDATE;
  IF NOT FOUND OR v_order.payment_method<>'card' THEN RETURN FALSE; END IF;
  SELECT * INTO STRICT v_payment FROM payment_transactions WHERE order_id=p_order AND provider='mercadopago' FOR UPDATE;
  IF v_payment.provider_recovery_version<>2 OR v_payment.provider_request_started_at IS NOT NULL OR v_payment.external_order_id IS NOT NULL
    OR v_payment.status<>'pending' OR v_order.status<>'pending_payment'
    OR get_order_payment_window(p_order) IS NULL THEN RETURN FALSE; END IF;
  UPDATE payment_transactions SET provider_request_started_at=clock_timestamp(),recovery_issue='awaiting_provider' WHERE id=v_payment.id;
  RETURN TRUE;
END $$;

-- This RPC accepts only facts fetched from MP by trusted server code, never browser assertions.
-- Lock order is identical to existing completion/resolution RPCs and A1.
CREATE FUNCTION public.reconcile_mercadopago_payment(
  p_order UUID,p_transaction UUID,p_reference TEXT,p_flow TEXT,p_external_order TEXT,
  p_payment TEXT,p_amount NUMERIC,p_currency TEXT,p_status TEXT,p_analytics_environment TEXT DEFAULT 'preview'
) RETURNS JSONB LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_order orders%ROWTYPE; v_payment payment_transactions%ROWTYPE; v_sale UUID;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id=p_order FOR UPDATE;
  SELECT * INTO v_payment FROM payment_transactions WHERE id=p_transaction AND order_id=p_order FOR UPDATE;
  IF v_order.id IS NULL OR v_payment.id IS NULL THEN RETURN jsonb_build_object('ok',false); END IF;
  IF v_payment.provider<>'mercadopago' OR p_flow IS NULL
    OR (p_flow='orders' AND v_order.payment_method<>'card')
    OR (p_flow='preference' AND v_order.payment_method<>'mercadopago')
    OR p_flow NOT IN ('orders','preference')
    OR p_reference IS NULL OR NOT (p_reference=v_payment.external_idempotency_key::TEXT
      OR ((v_payment.provider_recovery_version=1 OR p_flow='preference') AND p_reference=v_order.id::TEXT))
    OR (p_flow='orders' AND v_payment.provider_recovery_version=2 AND v_payment.provider_request_started_at IS NULL)
    OR p_amount IS NULL OR p_amount<=0 OR p_amount<>v_payment.amount OR p_amount<>v_order.total
    OR p_currency IS DISTINCT FROM v_payment.currency::TEXT OR p_currency IS DISTINCT FROM v_order.currency::TEXT
    OR p_status IS NULL OR p_status NOT IN ('processed','pending','rejected','cancelled')
    OR COALESCE(p_external_order,'')='' OR length(p_external_order)>160
    OR COALESCE(p_payment,'')='' OR length(p_payment)>160 THEN
    UPDATE payment_transactions SET recovery_issue='verification_failed' WHERE id=v_payment.id;
    RETURN jsonb_build_object('ok',false,'reason','verification_failed');
  END IF;
  IF (v_payment.external_order_id IS NOT NULL AND v_payment.external_order_id<>p_external_order)
    OR (v_payment.external_payment_id IS NOT NULL AND v_payment.external_payment_id<>p_payment)
    OR EXISTS(SELECT 1 FROM payment_transactions WHERE provider='mercadopago' AND id<>v_payment.id
      AND (external_order_id=p_external_order OR external_payment_id=p_payment)) THEN
    UPDATE payment_transactions SET recovery_issue='binding_conflict' WHERE id=v_payment.id;
    RETURN jsonb_build_object('ok',false,'reason','binding_conflict');
  END IF;
  BEGIN
    UPDATE payment_transactions SET external_order_id=p_external_order,external_payment_id=p_payment WHERE id=v_payment.id;
  EXCEPTION WHEN unique_violation THEN
    UPDATE payment_transactions SET recovery_issue='binding_conflict' WHERE id=v_payment.id;
    RETURN jsonb_build_object('ok',false,'reason','binding_conflict');
  END;
  -- Keep verified external IDs durable even if commercial completion fails.
  BEGIN
    v_sale:=complete_mercadopago_order(p_order,p_external_order,p_payment,p_amount,p_currency::CHAR(3),p_status::VARCHAR,p_analytics_environment);
  EXCEPTION WHEN OTHERS THEN
    UPDATE payment_transactions SET recovery_issue='completion_failed',
      status=CASE WHEN p_status='processed' AND status<>'refunded' THEN 'approved' ELSE status END,
      approved_at=CASE WHEN p_status='processed' AND status<>'refunded' THEN COALESCE(approved_at,clock_timestamp()) ELSE approved_at END
      WHERE id=v_payment.id;
    RETURN jsonb_build_object('ok',false,'reason','completion_failed');
  END;
  UPDATE payment_transactions SET recovery_issue=NULL WHERE id=v_payment.id;
  RETURN jsonb_build_object('ok',true,'sale_id',v_sale);
END $$;
REVOKE ALL ON FUNCTION public.begin_mercadopago_request(UUID),
  public.reconcile_mercadopago_payment(UUID,UUID,TEXT,TEXT,TEXT,TEXT,NUMERIC,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_mercadopago_request(UUID),
  public.reconcile_mercadopago_payment(UUID,UUID,TEXT,TEXT,TEXT,TEXT,NUMERIC,TEXT,TEXT,TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
