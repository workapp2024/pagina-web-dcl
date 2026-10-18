-- PROPOSAL ONLY. Do not apply without explicit authorization and installed-body comparison.
-- Additive notices, not receipts or money. No historical rows are rewritten.
BEGIN;
SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='20s';
CREATE TABLE public.wholesale_transfer_notices (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES public.wholesale_orders(id),
 customer_id uuid NOT NULL REFERENCES public.customers(id), amount numeric(12,2) NOT NULL CHECK(amount>0),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','withdrawn','not_received','verified')),
 payment_entry_id uuid UNIQUE REFERENCES public.wholesale_payment_entries(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), resolved_at timestamptz,
 CHECK ((status='verified')=(payment_entry_id IS NOT NULL))
);
CREATE UNIQUE INDEX wholesale_notice_one_pending ON public.wholesale_transfer_notices(order_id) WHERE status='pending';
CREATE TABLE public.wholesale_transfer_notice_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, notice_id uuid NOT NULL REFERENCES public.wholesale_transfer_notices(id),
 event text NOT NULL, actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.wholesale_transfer_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wholesale_transfer_notice_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wholesale_transfer_notices,public.wholesale_transfer_notice_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.wholesale_transfer_notices,public.wholesale_transfer_notice_events TO service_role;
CREATE TRIGGER wholesale_notice_events_immutable BEFORE UPDATE OR DELETE ON public.wholesale_transfer_notice_events
FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_checkout_audit();

CREATE FUNCTION public.record_wholesale_transfer_notice(p_customer uuid,p_order uuid,p_amount numeric,p_key uuid,p_action text,p_notice uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='3s' AS $$
DECLARE o public.wholesale_orders%ROWTYPE; n public.wholesale_transfer_notices%ROWTYPE; due numeric; reserved numeric;
BEGIN
 IF p_key IS NULL OR p_customer IS NULL OR p_action IS NULL OR p_action NOT IN ('inform','withdraw') THEN RAISE EXCEPTION 'NOTICE_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer AND wholesale_enabled AND wholesale_access_active AND archived_at IS NULL) THEN RAISE EXCEPTION 'NOTICE_CUSTOMER'; END IF;
 SELECT * INTO o FROM public.wholesale_orders WHERE id=p_order AND customer_id=p_customer FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOTICE_OWNER'; END IF;
 IF p_action='withdraw' THEN
  SELECT * INTO n FROM public.wholesale_transfer_notices WHERE id=p_notice AND order_id=o.id AND customer_id=p_customer FOR UPDATE;
  IF NOT FOUND OR n.status NOT IN ('pending','withdrawn') THEN RAISE EXCEPTION 'NOTICE_STATE'; END IF;
  IF n.status='pending' THEN
   UPDATE public.wholesale_transfer_notices SET status='withdrawn',resolved_at=clock_timestamp() WHERE id=n.id;
   INSERT INTO public.wholesale_transfer_notice_events(notice_id,event,actor_id) VALUES(n.id,'customer_says_not_sent',p_customer);
  END IF;
  RETURN to_jsonb(n)||jsonb_build_object('status','withdrawn');
 END IF;
 IF p_amount IS NULL OR p_amount<=0 OR p_amount<>round(p_amount,2) OR p_amount::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'NOTICE_AMOUNT'; END IF;
 SELECT * INTO n FROM public.wholesale_transfer_notices WHERE id=p_key;
 IF FOUND THEN
  IF n.customer_id<>p_customer OR n.order_id<>p_order OR n.amount<>p_amount THEN RAISE EXCEPTION 'NOTICE_KEY_REUSED'; END IF;
  RETURN to_jsonb(n);
 END IF;
 SELECT * INTO n FROM public.wholesale_transfer_notices WHERE order_id=o.id AND status='pending';
 IF FOUND THEN
  IF n.amount<>p_amount THEN RAISE EXCEPTION 'NOTICE_ALREADY_PENDING'; END IF;
  RETURN to_jsonb(n);
 END IF;
 IF o.status<>'confirmed' THEN RAISE EXCEPTION 'NOTICE_UNCONFIRMED'; END IF;
 SELECT r.total_amount-coalesce((SELECT sum(CASE WHEN entry_type='payment' THEN amount ELSE -amount END) FROM public.wholesale_payment_entries WHERE order_id=o.id),0)
 INTO due FROM public.wholesale_order_revisions r WHERE r.id=o.confirmed_revision_id AND r.currency='ARS';
 SELECT coalesce(sum(amount),0) INTO reserved FROM public.wholesale_checkout_intents WHERE order_id=o.id AND state NOT IN ('approved','closed');
 IF due IS NULL OR p_amount>due-reserved THEN RAISE EXCEPTION 'NOTICE_AMOUNT_RESERVED'; END IF;
 INSERT INTO public.wholesale_transfer_notices(id,order_id,customer_id,amount) VALUES(p_key,o.id,p_customer,p_amount) RETURNING * INTO n;
 INSERT INTO public.wholesale_transfer_notice_events(notice_id,event,actor_id) VALUES(n.id,'customer_intends_to_report',p_customer);
 RETURN to_jsonb(n);
END $$;

CREATE FUNCTION public.resolve_wholesale_transfer_notice(p_order uuid,p_notice uuid,p_status text,p_payment uuid,p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='3s' AS $$
DECLARE n public.wholesale_transfer_notices%ROWTYPE;
BEGIN
 PERFORM public.assert_wholesale_admin_actor(p_actor);
 PERFORM id FROM public.wholesale_orders WHERE id=p_order FOR UPDATE;
 SELECT * INTO n FROM public.wholesale_transfer_notices WHERE id=p_notice AND order_id=p_order FOR UPDATE;
 IF NOT FOUND OR p_status IS NULL OR p_status NOT IN ('verified','not_received') THEN RAISE EXCEPTION 'NOTICE_STATE'; END IF;
 IF n.status=p_status AND n.payment_entry_id IS NOT DISTINCT FROM p_payment THEN RETURN; END IF;
 IF n.status<>'pending' THEN RAISE EXCEPTION 'NOTICE_RESOLVED'; END IF;
 IF p_status='verified' AND NOT EXISTS(SELECT 1 FROM public.wholesale_payment_entries p WHERE p.id=p_payment AND p.order_id=p_order AND p.entry_type='payment' AND p.currency='ARS' AND p.payment_method IN ('bank_transfer','mercadopago') AND p.amount=n.amount AND EXISTS(SELECT 1 FROM public.wholesale_financial_postings f WHERE f.payment_entry_id=p.id AND f.account_id='mercadopago' AND f.status IN ('posted','included_in_opening_balance')) AND NOT EXISTS(SELECT 1 FROM public.wholesale_payment_entries r WHERE r.refund_of=p.id)) THEN RAISE EXCEPTION 'NOTICE_PAYMENT_PROOF'; END IF;
 IF p_status='not_received' AND p_payment IS NOT NULL THEN RAISE EXCEPTION 'NOTICE_PAYMENT_PROOF'; END IF;
 UPDATE public.wholesale_transfer_notices SET status=p_status,payment_entry_id=p_payment,resolved_at=clock_timestamp() WHERE id=n.id;
 INSERT INTO public.wholesale_transfer_notice_events(notice_id,event,actor_id) VALUES(n.id,p_status,p_actor);
END $$;

-- Reserve only unpaid amounts; use the same order lock taken by checkout and payments.
CREATE FUNCTION public.guard_wholesale_notice_checkout() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE due numeric; reserved numeric;
BEGIN
 PERFORM id FROM public.wholesale_orders WHERE id=NEW.order_id FOR UPDATE;
 SELECT r.total_amount-coalesce((SELECT sum(CASE WHEN entry_type='payment' THEN amount ELSE -amount END) FROM public.wholesale_payment_entries WHERE order_id=NEW.order_id),0)
 INTO due FROM public.wholesale_order_revisions r WHERE r.id=NEW.revision_id;
 SELECT coalesce(sum(amount),0) INTO reserved FROM public.wholesale_transfer_notices WHERE order_id=NEW.order_id AND status='pending';
 IF NEW.amount>due-reserved THEN RAISE EXCEPTION 'NOTICE_AMOUNT_RESERVED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wholesale_notice_checkout_guard BEFORE INSERT ON public.wholesale_checkout_intents FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_notice_checkout();

-- Explicit recovery keeps the original intent for late notifications and audit.
ALTER TABLE public.wholesale_checkout_intents DROP CONSTRAINT wholesale_checkout_intents_state_check;
ALTER TABLE public.wholesale_checkout_intents ADD CONSTRAINT wholesale_checkout_intents_state_check CHECK(state IN ('creating','ready','pending','posting','approved','closed'));
DROP INDEX public.wholesale_checkout_one_open;
CREATE UNIQUE INDEX wholesale_checkout_one_open ON public.wholesale_checkout_intents(order_id) WHERE state NOT IN ('approved','closed');
DO $$
DECLARE body text; signature text;
BEGIN
 FOREACH signature IN ARRAY ARRAY['public.begin_wholesale_checkout(uuid,uuid,numeric,uuid)','public.guard_wholesale_checkout_payment()','public.settle_wholesale_checkout(uuid,text,text,numeric,text,text,timestamptz)'] LOOP
  body=pg_get_functiondef(signature::regprocedure);
  IF body NOT LIKE '%state<>''approved''%' THEN RAISE EXCEPTION 'INSTALLED_BODY_DIFFERS: %',signature; END IF;
  body=replace(body,'state<>''approved''','state NOT IN (''approved'',''closed'')');
  IF signature='public.settle_wholesale_checkout(uuid,text,text,numeric,text,text,timestamptz)' THEN
   -- A recovered intent must never compete with a newer live preference. Retain
   -- the provider receipt as review on its ORIGINAL intent, without posting money.
   -- An existing review also prevents another receipt from reaching the payment
   -- guard and rolling back the notification instead of preserving it.
   IF (length(body)-length(replace(body,'IF i.state=''approved'' OR o.status','')))/length('IF i.state=''approved'' OR o.status')<>1 THEN
    RAISE EXCEPTION 'INSTALLED_SETTLEMENT_BODY_DIFFERS';
   END IF;
   body=replace(body,'IF i.state=''approved'' OR o.status',
    'IF i.state IN (''approved'',''closed'') OR EXISTS(SELECT 1 FROM public.wholesale_checkout_receipts receipt JOIN public.wholesale_checkout_intents intent ON intent.id=receipt.intent_id WHERE intent.order_id=o.id AND receipt.outcome=''review'') OR o.status');
  END IF;
  EXECUTE body;
 END LOOP;
END $$;
CREATE FUNCTION public.close_verified_wholesale_checkout(p_customer uuid,p_order uuid,p_intent uuid,p_preference text,p_provider_checked boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='3s' AS $$
DECLARE i public.wholesale_checkout_intents%ROWTYPE;
BEGIN
 PERFORM id FROM public.wholesale_orders WHERE id=p_order AND customer_id=p_customer FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CHECKOUT_OWNER'; END IF;
 SELECT * INTO i FROM public.wholesale_checkout_intents WHERE id=p_intent AND order_id=p_order AND customer_id=p_customer FOR UPDATE;
 IF NOT FOUND OR p_provider_checked IS DISTINCT FROM TRUE OR i.preference_id IS DISTINCT FROM p_preference OR i.expires_at>clock_timestamp() OR i.state IN ('approved','posting') THEN RAISE EXCEPTION 'CHECKOUT_NOT_SAFE_TO_CLOSE'; END IF;
 IF EXISTS(SELECT 1 FROM public.wholesale_checkout_receipts WHERE intent_id=i.id AND outcome IN ('pending','approved','review')) THEN RAISE EXCEPTION 'CHECKOUT_RECEIPT_REVIEW'; END IF;
 IF i.state='closed' THEN RETURN; END IF;
 UPDATE public.wholesale_checkout_intents SET state='closed' WHERE id=i.id;
 INSERT INTO public.wholesale_checkout_events(intent_id,source,event) VALUES(i.id,'customer','expired_intent_closed_after_provider_check');
END $$;
REVOKE ALL ON FUNCTION public.record_wholesale_transfer_notice(uuid,uuid,numeric,uuid,text,uuid),public.resolve_wholesale_transfer_notice(uuid,uuid,text,uuid,uuid),public.guard_wholesale_notice_checkout(),public.close_verified_wholesale_checkout(uuid,uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_wholesale_transfer_notice(uuid,uuid,numeric,uuid,text,uuid),public.resolve_wholesale_transfer_notice(uuid,uuid,text,uuid,uuid),public.close_verified_wholesale_checkout(uuid,uuid,uuid,text,boolean) TO service_role;
COMMIT;
