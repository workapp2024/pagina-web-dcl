BEGIN;

-- Financial accounts are administered without rewriting existing cash movements.
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS payment_presentation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS payment_presentation_title VARCHAR(120) NOT NULL DEFAULT 'Pagá como más te convenga',
  ADD COLUMN IF NOT EXISTS payment_presentation_description VARCHAR(240) NOT NULL DEFAULT 'Aceptamos tarjetas, transferencias bancarias y medios de pago digitales.',
  ADD COLUMN IF NOT EXISTS payment_presentation_methods JSONB NOT NULL DEFAULT '[{"id":"mercadopago","name":"Mercado Pago","logoUrl":"","enabled":true,"showHome":true,"showWholesale":true,"showCheckout":true,"sortOrder":10},{"id":"card","name":"Tarjetas · Mercado Pago","logoUrl":"","enabled":true,"showHome":true,"showWholesale":true,"showCheckout":true,"sortOrder":20},{"id":"transfer","name":"Transferencia bancaria","logoUrl":"","enabled":false,"showHome":true,"showWholesale":true,"showCheckout":true,"sortOrder":30}]'::JSONB,
  ADD COLUMN IF NOT EXISTS payment_presentation_home BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS payment_presentation_wholesale BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS payment_presentation_checkout BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.financial_accounts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp();
CREATE UNIQUE INDEX IF NOT EXISTS financial_accounts_name_casefold_unique
  ON public.financial_accounts(lower(btrim(name)));

CREATE TABLE public.financial_account_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id VARCHAR(40) NOT NULL REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
  actor_id UUID NOT NULL REFERENCES public.admin_profiles(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('created','updated','deactivated')),
  before_state JSONB,
  after_state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX financial_account_events_account_created_idx
  ON public.financial_account_events(account_id, created_at DESC, id DESC);
CREATE TABLE public.financial_account_requests (
  idempotency_key UUID PRIMARY KEY,
  actor_id UUID NOT NULL REFERENCES public.admin_profiles(id) ON DELETE RESTRICT,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  account_id VARCHAR(40) NOT NULL REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION public.manage_financial_account(
  p_action TEXT, p_id VARCHAR(40), p_name VARCHAR(100), p_account_type VARCHAR(24),
  p_sort_order INTEGER, p_actor UUID, p_idempotency_key UUID, p_opening_balance NUMERIC DEFAULT 0
) RETURNS public.financial_accounts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_account public.financial_accounts%ROWTYPE; v_before JSONB; v_after JSONB;
  v_fingerprint TEXT; v_existing_fingerprint TEXT;
BEGIN
  IF p_actor IS NULL OR p_idempotency_key IS NULL OR p_action IS NULL OR p_action NOT IN ('create','update','deactivate')
    OR p_id IS NULL OR p_id !~ '^[a-z][a-z0-9_-]{1,39}$'
    OR (p_action <> 'deactivate' AND (p_name IS NULL OR btrim(p_name) = '' OR p_account_type IS NULL OR p_account_type NOT IN ('cash','wallet','bank','card','other') OR p_sort_order IS NULL OR p_sort_order < 0 OR p_sort_order > 10000 OR p_opening_balance IS NULL OR p_opening_balance < 0 OR p_opening_balance > 100000000)) THEN
    RAISE EXCEPTION 'FINANCIAL_ACCOUNT_INVALID_REQUEST';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_profiles WHERE id=p_actor AND role='ADMIN' AND active IS TRUE) THEN
    RAISE EXCEPTION 'FINANCIAL_ADMIN_REQUIRED';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('financial_account:'||p_idempotency_key::TEXT,0));
  v_fingerprint := encode(sha256(convert_to(jsonb_build_object('action',p_action,'id',p_id,'name',p_name,'type',p_account_type,'sort',p_sort_order,'opening_balance',p_opening_balance)::TEXT,'UTF8')),'hex');
  SELECT request_fingerprint INTO v_existing_fingerprint FROM public.financial_account_requests WHERE idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing_fingerprint <> v_fingerprint THEN RAISE EXCEPTION 'FINANCIAL_ACCOUNT_IDEMPOTENCY_CONFLICT'; END IF;
    SELECT * INTO v_account FROM public.financial_accounts WHERE id=p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'FINANCIAL_ACCOUNT_REQUEST_RESULT_MISSING'; END IF;
    RETURN v_account;
  END IF;
  IF p_action='create' THEN
    IF EXISTS (SELECT 1 FROM public.financial_accounts WHERE lower(name)=lower(btrim(p_name))) THEN
      RAISE EXCEPTION 'FINANCIAL_ACCOUNT_DUPLICATE_NAME';
    END IF;
    PERFORM 1 FROM public.financial_periods WHERE status='open' FOR UPDATE;
    IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.financial_activation WHERE singleton IS TRUE) THEN
      RAISE EXCEPTION 'FINANCIAL_ACCOUNT_FINANCE_NOT_ACTIVE';
    END IF;
    INSERT INTO public.financial_accounts(id,name,account_type,active,sort_order)
      VALUES(p_id,btrim(p_name),p_account_type,TRUE,p_sort_order) RETURNING * INTO v_account;
    INSERT INTO public.cash_movements(movement_type,amount,description,account_id,period_id,idempotency_key)
      SELECT 'opening_balance',p_opening_balance,'Saldo de apertura informado al crear la cuenta',p_id,id,p_idempotency_key
      FROM public.financial_periods WHERE status='open';
    v_after := to_jsonb(v_account);
    v_after := to_jsonb(v_account);
    INSERT INTO public.financial_account_events(account_id,actor_id,event_type,after_state)
      VALUES(v_account.id,p_actor,'created',v_after);
    INSERT INTO public.financial_account_requests(idempotency_key,actor_id,request_fingerprint,account_id)
      VALUES(p_idempotency_key,p_actor,v_fingerprint,v_account.id);
    RETURN v_account;
  END IF;

  SELECT * INTO v_account FROM public.financial_accounts WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FINANCIAL_ACCOUNT_NOT_FOUND'; END IF;
  v_before := to_jsonb(v_account);
  IF p_action='deactivate' THEN
    IF p_id IN ('cash','mercadopago') THEN RAISE EXCEPTION 'FINANCIAL_CORE_ACCOUNT_REQUIRED'; END IF;
    IF EXISTS (SELECT 1 FROM public.wholesale_financial_account_mappings WHERE account_id=p_id) THEN
      RAISE EXCEPTION 'FINANCIAL_ACCOUNT_MAPPING_IN_USE';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.financial_periods fp
      WHERE fp.status='open' AND (SELECT COALESCE(sum(cm.amount),0) FROM public.cash_movements cm WHERE cm.period_id=fp.id AND cm.account_id=p_id) <> 0
    ) THEN RAISE EXCEPTION 'FINANCIAL_ACCOUNT_NONZERO_BALANCE'; END IF;
    UPDATE public.financial_accounts SET active=FALSE,updated_at=clock_timestamp()
      WHERE id=p_id RETURNING * INTO v_account;
    INSERT INTO public.financial_account_events(account_id,actor_id,event_type,before_state,after_state)
      VALUES(p_id,p_actor,'deactivated',v_before,to_jsonb(v_account));
    INSERT INTO public.financial_account_requests(idempotency_key,actor_id,request_fingerprint,account_id)
      VALUES(p_idempotency_key,p_actor,v_fingerprint,v_account.id);
    RETURN v_account;
  END IF;

  IF p_id IN ('cash','mercadopago')
    AND (v_account.name IS DISTINCT FROM btrim(p_name) OR v_account.account_type IS DISTINCT FROM p_account_type) THEN
    RAISE EXCEPTION 'FINANCIAL_CORE_ACCOUNT_IMMUTABLE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cash_movements WHERE account_id=p_id)
    AND (v_account.name IS DISTINCT FROM btrim(p_name) OR v_account.account_type IS DISTINCT FROM p_account_type) THEN
    RAISE EXCEPTION 'FINANCIAL_ACCOUNT_HISTORY_IMMUTABLE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.financial_accounts WHERE id<>p_id AND lower(name)=lower(btrim(p_name))) THEN
    RAISE EXCEPTION 'FINANCIAL_ACCOUNT_DUPLICATE_NAME';
  END IF;
  UPDATE public.financial_accounts SET name=btrim(p_name),account_type=p_account_type,
    sort_order=p_sort_order,active=TRUE,updated_at=clock_timestamp()
    WHERE id=p_id RETURNING * INTO v_account;
  INSERT INTO public.financial_account_events(account_id,actor_id,event_type,before_state,after_state)
    VALUES(p_id,p_actor,'updated',v_before,to_jsonb(v_account));
  INSERT INTO public.financial_account_requests(idempotency_key,actor_id,request_fingerprint,account_id)
    VALUES(p_idempotency_key,p_actor,v_fingerprint,v_account.id);
  RETURN v_account;
END;
$$;

CREATE FUNCTION public.guard_financial_account_event_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'FINANCIAL_ACCOUNT_EVENT_IMMUTABLE'; END;
$$;
CREATE TRIGGER financial_account_events_immutable
BEFORE UPDATE OR DELETE ON public.financial_account_events
FOR EACH ROW EXECUTE FUNCTION public.guard_financial_account_event_immutable();

ALTER TABLE public.financial_account_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_account_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_account_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.financial_account_events TO service_role;
REVOKE ALL ON public.financial_account_requests FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.financial_account_requests TO service_role;
REVOKE ALL ON FUNCTION public.manage_financial_account(TEXT,VARCHAR,VARCHAR,VARCHAR,INTEGER,UUID,UUID,NUMERIC),
  public.guard_financial_account_event_immutable() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.manage_financial_account(TEXT,VARCHAR,VARCHAR,VARCHAR,INTEGER,UUID,UUID,NUMERIC) TO service_role;

COMMIT;
