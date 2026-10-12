-- Double-entry wholesale journal, isolated from retail sales and cash movements.
-- Account references are deliberately unseeded: production must map these roles
-- to the approved company chart before journal entries can be released.
BEGIN;

CREATE TABLE public.wholesale_accounting_account_mappings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('accounts_receivable','sales_revenue','customer_advances','cash_clearing')),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('cash','bank_transfer','mercadopago','debit_card','credit_card','other')),
  account_reference TEXT NOT NULL CHECK (length(btrim(account_reference)) BETWEEN 1 AND 120),
  configured_by UUID NOT NULL,
  configured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE NULLS NOT DISTINCT (role,currency,payment_method)
);
CREATE TABLE public.wholesale_accounting_mapping_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mapping_id BIGINT NOT NULL REFERENCES public.wholesale_accounting_account_mappings(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('configured','changed')),
  account_reference TEXT NOT NULL,
  actor_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.wholesale_accounting_journals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.wholesale_orders(id) ON DELETE RESTRICT,
  revision_id UUID,
  recognition_id UUID REFERENCES public.wholesale_sale_recognitions(id) ON DELETE RESTRICT,
  payment_entry_id UUID REFERENCES public.wholesale_payment_entries(id) ON DELETE RESTRICT,
  source_event_id BIGINT REFERENCES public.wholesale_order_events(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL CHECK (source_type IN ('sale_recognition','sale_reversal','payment','refund')),
  source_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'awaiting_account_mapping' CHECK (status IN ('awaiting_account_mapping','ready')),
  actor_id UUID,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (source_type,source_id),
  FOREIGN KEY (order_id,revision_id) REFERENCES public.wholesale_order_revisions(order_id,id) ON DELETE RESTRICT
);
CREATE TABLE public.wholesale_accounting_journal_lines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journal_id UUID NOT NULL REFERENCES public.wholesale_accounting_journals(id) ON DELETE RESTRICT,
  line_number SMALLINT NOT NULL CHECK (line_number IN (1,2)),
  role TEXT NOT NULL CHECK (role IN ('accounts_receivable','sales_revenue','customer_advances','cash_clearing')),
  account_reference TEXT,
  debit NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  UNIQUE (journal_id,line_number),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
CREATE INDEX wholesale_accounting_journals_order_idx ON public.wholesale_accounting_journals(order_id,created_at,id);

CREATE FUNCTION public.create_wholesale_accounting_journal(
  p_order UUID,p_source_type TEXT,p_source_id UUID,p_key TEXT,p_currency CHAR(3),p_amount NUMERIC,
  p_debit_role TEXT,p_credit_role TEXT,p_method TEXT,p_actor UUID,p_occurred_at TIMESTAMPTZ
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id UUID; v_debit_ref TEXT; v_credit_ref TEXT; v_status TEXT;
  v_revision UUID; v_recognition UUID; v_payment UUID; v_event BIGINT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 OR p_currency !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'WHOLESALE_ACCOUNTING_INVALID_AMOUNT'; END IF;
  SELECT id INTO v_id FROM public.wholesale_accounting_journals WHERE source_type=p_source_type AND source_id=p_source_id;
  IF FOUND THEN RETURN v_id; END IF;
  SELECT account_reference INTO v_debit_ref FROM public.wholesale_accounting_account_mappings
   WHERE role=p_debit_role AND currency=p_currency
     AND ((p_debit_role='cash_clearing' AND payment_method=p_method) OR (p_debit_role<>'cash_clearing' AND payment_method IS NULL));
  SELECT account_reference INTO v_credit_ref FROM public.wholesale_accounting_account_mappings
   WHERE role=p_credit_role AND currency=p_currency
     AND ((p_credit_role='cash_clearing' AND payment_method=p_method) OR (p_credit_role<>'cash_clearing' AND payment_method IS NULL));
  IF p_source_type='sale_recognition' THEN
    SELECT revision_id,completion_event_id INTO v_revision,v_event FROM public.wholesale_sale_recognitions WHERE id=p_source_id;
    v_recognition:=p_source_id;
  ELSIF p_source_type='sale_reversal' THEN
    SELECT revision_id,recognition_id,reversal_event_id INTO v_revision,v_recognition,v_event FROM public.wholesale_sale_reversals WHERE id=p_source_id;
  ELSIF p_source_type='payment' THEN
    SELECT revision_id,id INTO v_revision,v_payment FROM public.wholesale_payment_entries WHERE id=p_source_id;
  ELSIF p_source_type='refund' THEN
    SELECT revision_id,refund_of INTO v_revision,v_payment FROM public.wholesale_payment_entries WHERE id=p_source_id;
  END IF;
  v_status := CASE WHEN v_debit_ref IS NULL OR v_credit_ref IS NULL THEN 'awaiting_account_mapping' ELSE 'ready' END;
  INSERT INTO public.wholesale_accounting_journals(order_id,revision_id,recognition_id,payment_entry_id,source_event_id,
    source_type,source_id,idempotency_key,currency,amount,status,actor_id,occurred_at)
    VALUES(p_order,v_revision,v_recognition,v_payment,v_event,p_source_type,p_source_id,p_key,p_currency,p_amount,v_status,p_actor,p_occurred_at)
    ON CONFLICT(source_type,source_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN SELECT id INTO v_id FROM public.wholesale_accounting_journals WHERE source_type=p_source_type AND source_id=p_source_id; RETURN v_id; END IF;
  INSERT INTO public.wholesale_accounting_journal_lines(journal_id,line_number,role,account_reference,debit,credit,currency)
    VALUES(v_id,1,p_debit_role,v_debit_ref,p_amount,0,p_currency),(v_id,2,p_credit_role,v_credit_ref,0,p_amount,p_currency);
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.capture_wholesale_recognition_journal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.create_wholesale_accounting_journal(NEW.order_id,'sale_recognition',NEW.id,'wholesale-recognition:'||NEW.id,
    NEW.currency,NEW.amount,'accounts_receivable','sales_revenue',NULL,NULL,NEW.recognized_at);
  RETURN NEW;
END; $$;
CREATE TRIGGER wholesale_recognition_accounting AFTER INSERT ON public.wholesale_sale_recognitions
FOR EACH ROW EXECUTE FUNCTION public.capture_wholesale_recognition_journal();

CREATE FUNCTION public.capture_wholesale_reversal_journal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.create_wholesale_accounting_journal(NEW.order_id,'sale_reversal',NEW.id,'wholesale-reversal:'||NEW.id,
    NEW.currency,NEW.amount,'sales_revenue','accounts_receivable',NULL,NEW.actor_id,NEW.reversed_at);
  RETURN NEW;
END; $$;
CREATE TRIGGER wholesale_reversal_accounting AFTER INSERT ON public.wholesale_sale_reversals
FOR EACH ROW EXECUTE FUNCTION public.capture_wholesale_reversal_journal();

CREATE FUNCTION public.capture_wholesale_payment_journal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_role TEXT; v_method TEXT;
BEGIN
  SELECT CASE WHEN entry_type='payment' THEN 'customer_advances' ELSE 'customer_advances' END,payment_method
    INTO v_role,v_method FROM public.wholesale_payment_entries WHERE id=NEW.refund_of;
  IF NEW.entry_type='payment' THEN v_role:='customer_advances'; v_method:=NEW.payment_method; END IF;
  IF NEW.entry_type='payment' THEN
    PERFORM public.create_wholesale_accounting_journal(NEW.order_id,'payment',NEW.id,'wholesale-payment:'||NEW.id,
      NEW.currency,NEW.amount,'cash_clearing',v_role,v_method,NEW.actor_id,NEW.occurred_at);
  ELSE
    PERFORM public.create_wholesale_accounting_journal(NEW.order_id,'refund',NEW.id,'wholesale-refund:'||NEW.id,
      NEW.currency,NEW.amount,'customer_advances','cash_clearing',NEW.payment_method,NEW.actor_id,NEW.occurred_at);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER wholesale_payment_accounting AFTER INSERT ON public.wholesale_payment_entries
FOR EACH ROW EXECUTE FUNCTION public.capture_wholesale_payment_journal();

CREATE FUNCTION public.set_wholesale_accounting_mapping(
  p_role TEXT,p_currency CHAR(3),p_method TEXT,p_account_reference TEXT,p_actor UUID
) RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id BIGINT; v_previous TEXT;
BEGIN
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  IF p_role NOT IN ('accounts_receivable','sales_revenue','customer_advances','cash_clearing')
    OR p_currency !~ '^[A-Z]{3}$' OR length(btrim(COALESCE(p_account_reference,''))) NOT BETWEEN 1 AND 120
    OR (p_role='cash_clearing' AND p_method NOT IN ('cash','bank_transfer','mercadopago','debit_card','credit_card','other'))
    OR (p_role<>'cash_clearing' AND p_method IS NOT NULL) THEN
    RAISE EXCEPTION 'WHOLESALE_ACCOUNTING_INVALID_MAPPING';
  END IF;
  SELECT id,account_reference INTO v_id,v_previous FROM public.wholesale_accounting_account_mappings
    WHERE role=p_role AND currency=p_currency AND payment_method IS NOT DISTINCT FROM p_method FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.wholesale_accounting_account_mappings(role,currency,payment_method,account_reference,configured_by)
      VALUES(p_role,p_currency,p_method,btrim(p_account_reference),p_actor) RETURNING id INTO v_id;
  ELSE
    UPDATE public.wholesale_accounting_account_mappings SET account_reference=btrim(p_account_reference),configured_by=p_actor,configured_at=clock_timestamp() WHERE id=v_id;
  END IF;
  INSERT INTO public.wholesale_accounting_mapping_events(mapping_id,event_type,account_reference,actor_id)
    VALUES(v_id,CASE WHEN v_previous IS NULL THEN 'configured' ELSE 'changed' END,btrim(p_account_reference),p_actor);
  UPDATE public.wholesale_accounting_journal_lines l SET account_reference=m.account_reference
    FROM public.wholesale_accounting_journals j,public.wholesale_accounting_account_mappings m
    WHERE l.journal_id=j.id AND l.role=p_role AND j.currency=p_currency AND m.id=v_id
      AND j.status='awaiting_account_mapping'
      AND (p_role<>'cash_clearing' OR EXISTS (
        SELECT 1 FROM public.wholesale_payment_entries pe WHERE pe.id=j.source_id AND pe.payment_method=p_method
      ));
  UPDATE public.wholesale_accounting_journals j SET status='ready'
    WHERE j.status='awaiting_account_mapping' AND NOT EXISTS (
      SELECT 1 FROM public.wholesale_accounting_journal_lines l WHERE l.journal_id=j.id AND l.account_reference IS NULL
    );
  RETURN v_id;
END; $$;

ALTER TABLE public.wholesale_accounting_account_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wholesale_accounting_journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wholesale_accounting_journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wholesale_accounting_mapping_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wholesale_accounting_account_mappings,public.wholesale_accounting_journals,
  public.wholesale_accounting_journal_lines,public.wholesale_accounting_mapping_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.wholesale_accounting_account_mappings,public.wholesale_accounting_journals,
  public.wholesale_accounting_journal_lines,public.wholesale_accounting_mapping_events TO service_role;
REVOKE ALL ON FUNCTION public.create_wholesale_accounting_journal(UUID,TEXT,UUID,TEXT,CHAR,NUMERIC,TEXT,TEXT,TEXT,UUID,TIMESTAMPTZ),
  public.capture_wholesale_recognition_journal(),public.capture_wholesale_reversal_journal(),public.capture_wholesale_payment_journal(),
  public.set_wholesale_accounting_mapping(TEXT,CHAR,TEXT,TEXT,UUID)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_wholesale_accounting_mapping(TEXT,CHAR,TEXT,TEXT,UUID) TO service_role;

COMMIT;
