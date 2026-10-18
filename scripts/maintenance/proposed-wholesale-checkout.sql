-- PROPOSAL ONLY. Isolated rehearsal only until explicitly authorized.
BEGIN;
SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='20s';
CREATE TABLE public.wholesale_checkout_intents (
 id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES public.customers(id), order_id uuid NOT NULL REFERENCES public.wholesale_orders(id),
 revision_id uuid NOT NULL, amount numeric(12,2) NOT NULL CHECK(amount>0), requested_amount numeric(12,2), currency char(3) NOT NULL CHECK(currency='ARS'),
 state text NOT NULL DEFAULT 'creating' CHECK(state IN ('creating','ready','pending','posting','approved')),
 preference_id text UNIQUE, checkout_url text, provider_started_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 FOREIGN KEY(order_id,revision_id) REFERENCES public.wholesale_order_revisions(order_id,id)
);
CREATE UNIQUE INDEX wholesale_checkout_one_open ON public.wholesale_checkout_intents(order_id) WHERE state<>'approved';
CREATE TABLE public.wholesale_checkout_receipts (
 payment_id text PRIMARY KEY, intent_id uuid NOT NULL REFERENCES public.wholesale_checkout_intents(id),
 amount numeric NOT NULL, currency text NOT NULL, provider_status text NOT NULL, outcome text NOT NULL CHECK(outcome IN ('pending','approved','review','rejected')),
 approved_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.wholesale_checkout_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, intent_id uuid NOT NULL REFERENCES public.wholesale_checkout_intents(id),
 source text NOT NULL CHECK(source IN ('customer','provider','server')), actor_id uuid, event text NOT NULL, facts jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.wholesale_checkout_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wholesale_checkout_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wholesale_checkout_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wholesale_checkout_intents,public.wholesale_checkout_receipts,public.wholesale_checkout_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.wholesale_checkout_intents,public.wholesale_checkout_receipts,public.wholesale_checkout_events TO service_role;
CREATE FUNCTION public.guard_wholesale_checkout_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'WHOLESALE_CHECKOUT_AUDIT_IMMUTABLE'; END $$;
CREATE TRIGGER checkout_audit_immutable BEFORE UPDATE OR DELETE ON public.wholesale_checkout_events FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_checkout_audit();

CREATE FUNCTION public.begin_wholesale_checkout(p_customer uuid,p_order uuid,p_amount numeric,p_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='3s' AS $$
DECLARE o public.wholesale_orders%ROWTYPE; r public.wholesale_order_revisions%ROWTYPE; i public.wholesale_checkout_intents%ROWTYPE; paid numeric; due numeric;
BEGIN
 IF p_customer IS NULL OR p_key IS NULL OR p_order IS NULL OR (p_amount IS NOT NULL AND (p_amount<=0 OR p_amount<>round(p_amount,2) OR p_amount>9999999999.99 OR p_amount::text IN ('NaN','Infinity','-Infinity'))) THEN RAISE EXCEPTION 'WHOLESALE_CHECKOUT_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer AND wholesale_enabled AND wholesale_access_active AND archived_at IS NULL) THEN RAISE EXCEPTION 'WHOLESALE_CHECKOUT_CUSTOMER'; END IF;
 SELECT * INTO o FROM public.wholesale_orders WHERE id=p_order AND customer_id=p_customer FOR UPDATE;
 IF NOT FOUND OR o.status<>'confirmed' THEN RAISE EXCEPTION 'WHOLESALE_CHECKOUT_ORDER'; END IF;
 IF EXISTS(SELECT 1 FROM public.wholesale_checkout_receipts x JOIN public.wholesale_checkout_intents y ON y.id=x.intent_id WHERE y.order_id=o.id AND x.outcome='review') THEN RAISE EXCEPTION 'WHOLESALE_CHECKOUT_REVIEW'; END IF;
 SELECT * INTO i FROM public.wholesale_checkout_intents WHERE id=p_key;
 IF FOUND THEN
   IF i.customer_id<>p_customer OR i.order_id<>p_order OR i.requested_amount IS DISTINCT FROM p_amount OR i.revision_id<>o.confirmed_revision_id THEN RAISE EXCEPTION 'WHOLESALE_CHECKOUT_KEY_REUSED'; END IF;
   IF i.state='approved' OR i.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'WHOLESALE_CHECKOUT_REFRESH_OR_REVIEW'; END IF;
   RETURN to_jsonb(i);
 END IF;
 IF EXISTS(SELECT 1 FROM public.wholesale_checkout_intents WHERE order_id=o.id AND state<>'approved') THEN RAISE EXCEPTION 'WHOLESALE_CHECKOUT_IN_PROGRESS'; END IF;
 SELECT * INTO r FROM public.wholesale_order_revisions WHERE id=o.confirmed_revision_id AND order_id=o.id;
 IF r.currency<>'ARS' OR public.financial_ready_period() IS NULL OR NOT EXISTS(SELECT 1 FROM public.wholesale_financial_account_mappings WHERE payment_method='mercadopago' AND account_id='mercadopago') THEN RAISE EXCEPTION 'WHOLESALE_CHECKOUT_NOT_READY'; END IF;
 SELECT coalesce(sum(CASE WHEN entry_type='payment' THEN amount ELSE -amount END),0) INTO paid FROM public.wholesale_payment_entries WHERE order_id=o.id;
 due=r.total_amount-paid;
 IF due<=0 OR coalesce(p_amount,due)>due THEN RAISE EXCEPTION 'WHOLESALE_CHECKOUT_AMOUNT'; END IF;
 INSERT INTO public.wholesale_checkout_intents(id,customer_id,order_id,revision_id,amount,requested_amount,currency,expires_at)
 VALUES(p_key,p_customer,o.id,r.id,coalesce(p_amount,due),p_amount,r.currency,clock_timestamp()+interval '15 minutes') RETURNING * INTO i;
 INSERT INTO public.wholesale_checkout_events(intent_id,source,actor_id,event) VALUES(i.id,'customer',p_customer,'intent_created');
 RETURN to_jsonb(i);
END $$;
CREATE FUNCTION public.claim_wholesale_checkout(p_customer uuid,p_intent uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='3s' AS $$
DECLARE o public.wholesale_orders%ROWTYPE;
BEGIN
 SELECT * INTO o FROM public.wholesale_orders WHERE id=(SELECT order_id FROM public.wholesale_checkout_intents WHERE id=p_intent AND customer_id=p_customer) FOR UPDATE;
 IF NOT FOUND OR o.status<>'confirmed' OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer AND wholesale_enabled AND wholesale_access_active AND archived_at IS NULL) THEN RAISE EXCEPTION 'WHOLESALE_CHECKOUT_ORDER'; END IF;
 UPDATE public.wholesale_checkout_intents SET provider_started_at=clock_timestamp() WHERE id=p_intent AND customer_id=p_customer AND provider_started_at IS NULL AND state='creating' AND revision_id=o.confirmed_revision_id AND expires_at>clock_timestamp();
 RETURN FOUND;
END $$;
CREATE FUNCTION public.link_wholesale_checkout(p_customer uuid,p_intent uuid,p_preference text,p_url text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='3s' AS $$
DECLARE i public.wholesale_checkout_intents%ROWTYPE; o public.wholesale_orders%ROWTYPE;
BEGIN
 SELECT * INTO o FROM public.wholesale_orders WHERE id=(SELECT order_id FROM public.wholesale_checkout_intents WHERE id=p_intent) FOR UPDATE;
 SELECT * INTO i FROM public.wholesale_checkout_intents WHERE id=p_intent AND customer_id=p_customer FOR UPDATE;
 IF NOT FOUND OR o.status<>'confirmed' OR o.confirmed_revision_id<>i.revision_id OR i.expires_at<=clock_timestamp() OR i.state='approved' OR p_preference IS NULL OR length(p_preference) NOT BETWEEN 1 AND 200
  OR p_url IS NULL OR p_url!~'^https://(www\.|sandbox\.)?mercadopago\.com\.ar/' OR (i.preference_id IS NOT NULL AND i.preference_id<>p_preference) THEN RAISE EXCEPTION 'WHOLESALE_CHECKOUT_LINK'; END IF;
 UPDATE public.wholesale_checkout_intents SET preference_id=p_preference,checkout_url=p_url,state=CASE WHEN state='creating' THEN 'ready' ELSE state END WHERE id=i.id;
 IF i.preference_id IS NULL THEN INSERT INTO public.wholesale_checkout_events(intent_id,source,event,facts) VALUES(i.id,'server','preference_linked',jsonb_build_object('preference',p_preference)); END IF;
END $$;

CREATE FUNCTION public.guard_wholesale_checkout_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.entry_type<>'payment' THEN RETURN NEW; END IF;
 PERFORM id FROM public.wholesale_orders WHERE id=NEW.order_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.wholesale_checkout_receipts r JOIN public.wholesale_checkout_intents i ON i.id=r.intent_id WHERE r.payment_id=NEW.external_reference AND r.outcome='approved' AND i.id<>NEW.id) THEN RAISE EXCEPTION 'WHOLESALE_CHECKOUT_ALREADY_POSTED'; END IF;
 IF EXISTS(SELECT 1 FROM public.wholesale_checkout_receipts r JOIN public.wholesale_checkout_intents i ON i.id=r.intent_id WHERE i.order_id=NEW.order_id AND r.outcome='review') THEN RAISE EXCEPTION 'WHOLESALE_CHECKOUT_REVIEW'; END IF;
 IF EXISTS(SELECT 1 FROM public.wholesale_checkout_intents WHERE order_id=NEW.order_id AND state<>'approved')
 AND NOT EXISTS(SELECT 1 FROM public.wholesale_checkout_intents i JOIN public.wholesale_checkout_receipts r ON r.intent_id=i.id
   WHERE i.id=NEW.id AND i.order_id=NEW.order_id AND i.state='posting' AND r.outcome='approved' AND r.amount=NEW.amount AND r.currency=NEW.currency AND NEW.payment_method='mercadopago' AND NEW.external_reference=r.payment_id)
 THEN RAISE EXCEPTION 'WHOLESALE_CHECKOUT_IN_PROGRESS'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wholesale_checkout_payment_guard BEFORE INSERT ON public.wholesale_payment_entries FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_checkout_payment();

CREATE FUNCTION public.settle_wholesale_checkout(p_intent uuid,p_payment text,p_preference text,p_amount numeric,p_currency text,p_status text,p_approved_at timestamptz) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='3s' AS $$
DECLARE i public.wholesale_checkout_intents%ROWTYPE; o public.wholesale_orders%ROWTYPE; old public.wholesale_checkout_receipts%ROWTYPE; paid numeric; total numeric; outcome text;
BEGIN
 IF p_payment IS NULL OR p_payment!~'^[0-9]{1,100}$' OR p_amount IS NULL OR p_amount<=0 OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_currency IS NULL OR p_status NOT IN ('approved','pending','in_process','authorized','in_mediation','rejected','cancelled','refunded','charged_back') OR p_status IS NULL THEN RAISE EXCEPTION 'WHOLESALE_CHECKOUT_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('wholesale-checkout-payment:'||p_payment,0));
 SELECT * INTO o FROM public.wholesale_orders WHERE id=(SELECT order_id FROM public.wholesale_checkout_intents WHERE id=p_intent) FOR UPDATE;
 SELECT * INTO i FROM public.wholesale_checkout_intents WHERE id=p_intent FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_CHECKOUT_NOT_FOUND'; END IF;
 SELECT * INTO old FROM public.wholesale_checkout_receipts WHERE payment_id=p_payment;
 IF FOUND AND old.intent_id<>p_intent THEN RAISE EXCEPTION 'WHOLESALE_CHECKOUT_PROVIDER_ID_REUSED'; END IF;
 IF FOUND AND old.provider_status=p_status AND old.amount=p_amount AND old.currency=p_currency AND old.approved_at IS NOT DISTINCT FROM p_approved_at THEN RETURN old.outcome; END IF;
 IF old.outcome='approved' AND p_status IN ('pending','in_process','authorized') AND old.amount=p_amount AND old.currency=p_currency AND i.preference_id=p_preference THEN
   INSERT INTO public.wholesale_checkout_events(intent_id,source,event,facts) VALUES(i.id,'provider','stale_status_ignored',jsonb_build_object('payment',p_payment,'status',p_status));
   RETURN 'approved';
 END IF;
 outcome=CASE WHEN p_status IN ('rejected','cancelled') THEN 'rejected' ELSE 'pending' END;
 IF p_amount<>i.amount OR p_currency<>i.currency OR i.preference_id IS DISTINCT FROM p_preference OR p_status IN ('refunded','charged_back') OR old.outcome IN ('approved','review') THEN outcome='review';
 ELSIF p_status='approved' THEN
   SELECT total_amount INTO total FROM public.wholesale_order_revisions WHERE id=i.revision_id AND order_id=o.id;
   SELECT coalesce(sum(CASE WHEN entry_type='payment' THEN amount ELSE -amount END),0) INTO paid FROM public.wholesale_payment_entries WHERE order_id=o.id;
   IF i.state='approved' OR o.status<>'confirmed' OR o.confirmed_revision_id<>i.revision_id OR paid+p_amount>total OR p_approved_at IS NULL OR p_approved_at<i.created_at OR p_approved_at>clock_timestamp() OR p_approved_at>i.expires_at THEN outcome='review';
   ELSE outcome='approved'; END IF;
 END IF;
 INSERT INTO public.wholesale_checkout_receipts(payment_id,intent_id,amount,currency,provider_status,outcome,approved_at) VALUES(p_payment,i.id,p_amount,p_currency,p_status,outcome,p_approved_at)
 ON CONFLICT(payment_id) DO UPDATE SET provider_status=EXCLUDED.provider_status,outcome=EXCLUDED.outcome,approved_at=EXCLUDED.approved_at;
 INSERT INTO public.wholesale_checkout_events(intent_id,source,event,facts) VALUES(i.id,'provider',outcome,jsonb_build_object('payment',p_payment,'status',p_status,'amount',p_amount,'currency',p_currency));
 IF outcome='approved' THEN
   UPDATE public.wholesale_checkout_intents SET state='posting' WHERE id=i.id;
   -- Provider attribution is explicit: customer initiated; verified provider confirmed.
   -- Existing immutable entry, accounting and cash-posting triggers are reused; no retail sale or stock operation.
   INSERT INTO public.wholesale_payment_entries(id,order_id,revision_id,entry_type,amount,currency,payment_method,external_reference,occurred_at,idempotency_key,actor_id)
   VALUES(i.id,o.id,i.revision_id,'payment',p_amount,p_currency,'mercadopago',p_payment,p_approved_at,i.id,i.customer_id);
   IF NOT EXISTS(SELECT 1 FROM public.wholesale_financial_postings WHERE payment_entry_id=i.id AND status='posted' AND account_id='mercadopago') THEN RAISE EXCEPTION 'WHOLESALE_CHECKOUT_CASH_NOT_POSTED'; END IF;
   UPDATE public.wholesale_checkout_intents SET state='approved' WHERE id=i.id;
 ELSIF i.state<>'approved' THEN UPDATE public.wholesale_checkout_intents SET state='pending' WHERE id=i.id; END IF;
 RETURN outcome;
END $$;
REVOKE ALL ON FUNCTION public.guard_wholesale_checkout_audit(),public.guard_wholesale_checkout_payment(),public.begin_wholesale_checkout(uuid,uuid,numeric,uuid),public.claim_wholesale_checkout(uuid,uuid),public.link_wholesale_checkout(uuid,uuid,text,text),public.settle_wholesale_checkout(uuid,text,text,numeric,text,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.begin_wholesale_checkout(uuid,uuid,numeric,uuid),public.claim_wholesale_checkout(uuid,uuid),public.link_wholesale_checkout(uuid,uuid,text,text),public.settle_wholesale_checkout(uuid,text,text,numeric,text,text,timestamptz) TO service_role;
COMMIT;
