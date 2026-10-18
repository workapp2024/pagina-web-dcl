-- PROPOSAL ONLY. Never remove used checkout records or audit.
BEGIN;
SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='15s';
LOCK TABLE public.wholesale_checkout_intents,public.wholesale_checkout_receipts,public.wholesale_checkout_events IN ACCESS EXCLUSIVE MODE NOWAIT;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.wholesale_checkout_intents) OR EXISTS(SELECT 1 FROM public.wholesale_checkout_receipts) OR EXISTS(SELECT 1 FROM public.wholesale_checkout_events) THEN RAISE EXCEPTION 'WHOLESALE_CHECKOUT_ROLLBACK_HAS_HISTORY'; END IF; END $$;
DROP TRIGGER wholesale_checkout_payment_guard ON public.wholesale_payment_entries;
DROP FUNCTION public.guard_wholesale_checkout_payment();
DROP FUNCTION public.begin_wholesale_checkout(uuid,uuid,numeric,uuid);
DROP FUNCTION public.claim_wholesale_checkout(uuid,uuid);
DROP FUNCTION public.link_wholesale_checkout(uuid,uuid,text,text);
DROP FUNCTION public.settle_wholesale_checkout(uuid,text,text,numeric,text,text,timestamptz);
DROP TABLE public.wholesale_checkout_receipts,public.wholesale_checkout_events,public.wholesale_checkout_intents;
DROP FUNCTION public.guard_wholesale_checkout_audit();
COMMIT;
