-- SUPERSEDES the previous reversal/replacement draft. PROPOSAL ONLY: no new cash movement.
-- Requires sector-finance proposal installed and specific authorization for this one classification.
-- Execute in a transaction with timeouts, SET LOCAL dcl.authorized_actor and fixed dcl.correction_at.
DO $reclassify$
DECLARE actor uuid:=nullif(current_setting('dcl.authorized_actor',true),'')::uuid;
  at_time timestamptz:=nullif(current_setting('dcl.correction_at',true),'')::timestamptz;
  target constant uuid:='5b87e40f-f4c8-4897-a83a-2e1b271dddc1';
  before_row jsonb; before_cash jsonb;
BEGIN
 IF actor IS NULL OR at_time IS NULL THEN RAISE EXCEPTION 'RECLASSIFY_AUTHORIZATION_REQUIRED'; END IF;
 PERFORM public.assert_wholesale_admin_actor(actor);
 IF NOT pg_try_advisory_xact_lock(hashtext('wholesale_financial_posting')) THEN RAISE EXCEPTION 'RECLASSIFY_BUSY'; END IF;
 LOCK TABLE public.cash_movements IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 SELECT to_jsonb(c) INTO before_row FROM public.cash_movements c WHERE id=target;
 IF before_row IS NULL OR (before_row->>'amount')::numeric<>-29998 OR before_row->>'account_id'<>'mercadopago'
   OR before_row->>'movement_type'<>'cash_withdrawal' OR before_row->>'occurred_at'<>'2026-10-18T02:07:37.679887+00:00' THEN RAISE EXCEPTION 'RECLASSIFY_ORIGINAL_CHANGED'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') INTO before_cash FROM public.cash_movements c;
 PERFORM public.record_sector_finance(p_action=>'reclassify',p_account=>NULL,p_amount=>NULL,p_from=>NULL,p_to=>'mayoristas',p_occurred_at=>at_time,
   p_party=>'Administrador DCL',p_reason=>'Atribucion autorizada del retiro de prueba 29998 a Mayoristas',p_actor=>actor,
   p_key=>'65f25491-8a90-4966-bcde-929ab2999801',p_reverse_movement=>target);
 IF before_cash IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM public.cash_movements c) THEN RAISE EXCEPTION 'RECLASSIFY_CASH_CHANGED'; END IF;
END $reclassify$;
