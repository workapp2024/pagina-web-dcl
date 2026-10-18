-- PROPUESTA. NO APLICADA. Requiere revisión contra Supabase y autorización explícita.
-- Nuevas operaciones; no clasifica ni modifica registros históricos.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';

CREATE TABLE public.financial_sector_operations (
  id uuid PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('income','withdrawal','transfer','reverse','reclassify')),
  actor_id uuid NOT NULL REFERENCES public.admin_profiles(id),
  period_id uuid NOT NULL REFERENCES public.financial_periods(id),
  request jsonb NOT NULL,
  reverse_of uuid UNIQUE REFERENCES public.financial_sector_operations(id),
  legacy_movement_id uuid UNIQUE REFERENCES public.cash_movements(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((action='reverse' AND num_nonnulls(reverse_of,legacy_movement_id)=1) OR (action='reclassify' AND reverse_of IS NULL AND legacy_movement_id IS NOT NULL) OR (action NOT IN ('reverse','reclassify') AND num_nonnulls(reverse_of,legacy_movement_id)=0))
);
CREATE TABLE public.financial_sector_allocations (
  cash_movement_id uuid PRIMARY KEY REFERENCES public.cash_movements(id),
  operation_id uuid NOT NULL REFERENCES public.financial_sector_operations(id),
  sector text NOT NULL CHECK (sector IN ('minoristas','mayoristas','unassigned'))
);
CREATE INDEX financial_sector_allocations_operation ON public.financial_sector_allocations(operation_id);
ALTER TABLE public.financial_sector_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_sector_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_sector_operations,public.financial_sector_allocations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.financial_sector_operations,public.financial_sector_allocations TO service_role;

CREATE FUNCTION public.guard_sector_finance_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'SECTOR_FINANCE_HISTORY_IMMUTABLE'; END $$;
CREATE TRIGGER sector_operations_immutable BEFORE UPDATE OR DELETE ON public.financial_sector_operations FOR EACH ROW EXECUTE FUNCTION public.guard_sector_finance_history();
CREATE TRIGGER sector_allocations_immutable BEFORE UPDATE OR DELETE ON public.financial_sector_allocations FOR EACH ROW EXECUTE FUNCTION public.guard_sector_finance_history();

CREATE FUNCTION public.guard_sector_cash_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.financial_sector_allocations WHERE cash_movement_id=OLD.id)
    OR EXISTS(SELECT 1 FROM public.financial_sector_operations WHERE legacy_movement_id=OLD.id) THEN RAISE EXCEPTION 'SECTOR_FINANCE_HISTORY_IMMUTABLE'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sector_cash_immutable BEFORE UPDATE OR DELETE ON public.cash_movements FOR EACH ROW EXECUTE FUNCTION public.guard_sector_cash_history();

CREATE FUNCTION public.sector_financial_balance(p_period uuid,p_account varchar,p_sector text)
RETURNS numeric LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
  SELECT coalesce(sum(m.amount),0) FROM public.cash_movements m
  LEFT JOIN public.financial_sector_allocations a ON a.cash_movement_id=m.id
  WHERE m.period_id=p_period AND m.account_id=p_account AND p_sector = CASE
    WHEN m.wholesale_payment_entry_id IS NOT NULL AND m.sale_id IS NULL THEN 'mayoristas'
    WHEN m.sale_id IS NOT NULL AND m.wholesale_payment_entry_id IS NULL AND m.movement_type IN ('sale_income','sale_reversal') THEN 'minoristas'
    WHEN m.sale_id IS NULL AND m.wholesale_payment_entry_id IS NULL AND m.movement_type<>'opening_balance' THEN coalesce(a.sector,'unassigned')
    ELSE 'unassigned' END
$$;

-- Un débito con fecha anterior no puede consumir un cobro posterior ni dejar saldos intermedios negativos.
CREATE FUNCTION public.assert_sector_finance_debit(p_period uuid,p_account varchar,p_sector text,p_amount numeric,p_at timestamptz)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_sector_min numeric; v_account_min numeric;
BEGIN
  WITH dated AS (
    SELECT m.occurred_at,sum(m.amount) total,sum(CASE WHEN p_sector = CASE
      WHEN m.wholesale_payment_entry_id IS NOT NULL AND m.sale_id IS NULL THEN 'mayoristas'
      WHEN m.sale_id IS NOT NULL AND m.wholesale_payment_entry_id IS NULL AND m.movement_type IN ('sale_income','sale_reversal') THEN 'minoristas'
      WHEN m.sale_id IS NULL AND m.wholesale_payment_entry_id IS NULL AND m.movement_type<>'opening_balance' THEN coalesce(a.sector,'unassigned')
      ELSE 'unassigned' END THEN m.amount ELSE 0 END) sector
    FROM public.cash_movements m LEFT JOIN public.financial_sector_allocations a ON a.cash_movement_id=m.id
    WHERE m.period_id=p_period AND m.account_id=p_account GROUP BY m.occurred_at
    UNION ALL SELECT p_at,0,0
  ), balances AS (
    SELECT occurred_at,sum(sum(total)) OVER (ORDER BY occurred_at) total,sum(sum(sector)) OVER (ORDER BY occurred_at) sector
    FROM dated GROUP BY occurred_at
  ) SELECT min(total),min(sector) INTO v_account_min,v_sector_min FROM balances WHERE occurred_at>=p_at;
  IF v_account_min<p_amount OR v_sector_min<p_amount THEN RAISE EXCEPTION 'SECTOR_FINANCE_INSUFFICIENT'; END IF;
END $$;

CREATE FUNCTION public.record_sector_finance(
  p_action text,p_account varchar,p_amount numeric,p_from text,p_to text,
  p_occurred_at timestamptz,p_party text,p_reason text,p_actor uuid,p_key uuid,p_reverse_of uuid DEFAULT NULL,p_kind text DEFAULT NULL,p_reverse_movement uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='3s' AS $$
DECLARE v_period public.financial_periods%ROWTYPE; v_request jsonb; v_previous jsonb;
  v_min numeric;
  v_id uuid; v_original public.financial_sector_operations%ROWTYPE; v_row record; v_kind text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.admin_profiles WHERE id=p_actor AND role='ADMIN' AND active) THEN RAISE EXCEPTION 'SECTOR_FINANCE_ADMIN_REQUIRED'; END IF;
  IF p_key IS NULL OR p_action IS NULL OR p_action NOT IN ('income','withdrawal','transfer','reverse','reclassify')
    OR p_occurred_at IS NULL OR p_occurred_at>clock_timestamp()
    OR coalesce(btrim(p_reason),'')='' OR length(p_reason)>300
    OR coalesce(btrim(p_party),'')='' OR length(p_party)>120 THEN RAISE EXCEPTION 'SECTOR_FINANCE_INVALID'; END IF;
  IF p_action NOT IN ('reverse','reclassify') AND (p_account IS NULL OR p_amount IS NULL OR p_amount<=0 OR p_amount>100000000 OR p_amount<>round(p_amount,2)
    OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_reverse_of IS NOT NULL OR p_reverse_movement IS NOT NULL) THEN RAISE EXCEPTION 'SECTOR_FINANCE_INVALID'; END IF;
  IF p_action='income' AND (p_from IS NOT NULL OR p_to IS NULL OR p_to NOT IN ('minoristas','mayoristas')) THEN RAISE EXCEPTION 'SECTOR_FINANCE_INVALID'; END IF;
  IF p_action='withdrawal' AND (p_to IS NOT NULL OR p_from IS NULL OR p_from NOT IN ('minoristas','mayoristas')) THEN RAISE EXCEPTION 'SECTOR_FINANCE_INVALID'; END IF;
  IF p_action='transfer' AND (p_from IS NULL OR p_to IS NULL OR p_from=p_to OR p_from NOT IN ('minoristas','mayoristas','unassigned') OR p_to NOT IN ('minoristas','mayoristas','unassigned')) THEN RAISE EXCEPTION 'SECTOR_FINANCE_INVALID'; END IF;
  IF p_action='reverse' AND (num_nonnulls(p_reverse_of,p_reverse_movement)<>1 OR p_account IS NOT NULL OR p_amount IS NOT NULL OR p_from IS NOT NULL OR p_to IS NOT NULL) THEN RAISE EXCEPTION 'SECTOR_FINANCE_INVALID'; END IF;
  v_kind:=coalesce(p_kind,CASE p_action WHEN 'income' THEN 'cash_contribution' WHEN 'withdrawal' THEN 'cash_withdrawal' ELSE 'adjustment' END);
  IF (p_action='income' AND v_kind NOT IN ('income','cash_contribution')) OR (p_action='withdrawal' AND v_kind NOT IN ('expense','cash_withdrawal')) OR (p_action IN ('transfer','reverse','reclassify') AND v_kind<>'adjustment') THEN RAISE EXCEPTION 'SECTOR_FINANCE_INVALID'; END IF;
  v_request:=jsonb_build_object('action',p_action,'kind',v_kind,'account',p_account,'amount',p_amount,'from',p_from,'to',p_to,'date',p_occurred_at,'party',p_party,'reason',p_reason,'actor',p_actor,'reverse',p_reverse_of,'reverse_movement',p_reverse_movement);
  -- Mismo bloqueo que el puente mayorista y el cierre; no se modifican esas funciones.
  PERFORM pg_advisory_xact_lock(hashtext('wholesale_financial_posting'));
  SELECT request INTO v_previous FROM public.financial_sector_operations WHERE id=p_key;
  IF FOUND THEN
    IF v_previous IS DISTINCT FROM v_request THEN RAISE EXCEPTION 'SECTOR_FINANCE_KEY_REUSED'; END IF;
    RETURN p_key;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.financial_activation WHERE singleton) THEN RAISE EXCEPTION 'SECTOR_FINANCE_NOT_READY'; END IF;
  SELECT * INTO v_period FROM public.financial_periods WHERE status='open' FOR UPDATE;
  IF NOT FOUND OR p_occurred_at<v_period.starts_at OR (v_period.ends_at IS NOT NULL AND p_occurred_at>v_period.ends_at) THEN RAISE EXCEPTION 'SECTOR_FINANCE_PERIOD'; END IF;
  -- Evita que cualquier escritor del libro cambie el saldo durante la comprobación.
  LOCK TABLE public.cash_movements IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  IF p_action='reclassify' THEN
    IF p_account IS NOT NULL OR p_amount IS NOT NULL OR p_from IS NOT NULL OR p_to IS NULL OR p_to NOT IN ('minoristas','mayoristas') OR p_reverse_of IS NOT NULL OR p_reverse_movement IS NULL THEN RAISE EXCEPTION 'SECTOR_FINANCE_INVALID'; END IF;
    SELECT * INTO v_row FROM public.cash_movements WHERE id=p_reverse_movement FOR UPDATE;
    IF NOT FOUND OR v_row.period_id<>v_period.id OR v_row.sale_id IS NOT NULL OR v_row.wholesale_payment_entry_id IS NOT NULL OR v_row.transfer_id IS NOT NULL OR v_row.reversal_of_id IS NOT NULL
      OR v_row.movement_type NOT IN ('cash_withdrawal','expense') OR v_row.amount>=0
      OR EXISTS(SELECT 1 FROM public.financial_sector_allocations WHERE cash_movement_id=v_row.id)
      OR EXISTS(SELECT 1 FROM public.cash_movements WHERE reversal_of_id=v_row.id)
      OR NOT EXISTS(SELECT 1 FROM public.financial_operation_requests r WHERE r.operation_type='manual_movement' AND r.result_id=v_row.id AND r.idempotency_key=v_row.idempotency_key)
      OR EXISTS(SELECT 1 FROM public.financial_sector_operations WHERE legacy_movement_id=v_row.id) THEN RAISE EXCEPTION 'SECTOR_FINANCE_RECLASSIFY_INVALID'; END IF;
    IF p_occurred_at<v_row.occurred_at THEN RAISE EXCEPTION 'SECTOR_FINANCE_REVERSAL_DATE'; END IF;
    PERFORM 1 FROM public.financial_accounts WHERE id=v_row.account_id AND active FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SECTOR_FINANCE_ACCOUNT'; END IF;
    -- Check the destination's entire chronological balance after assigning the old debit.
    -- No money is moved: an account-total debit check would incorrectly debit it twice.
    WITH dated AS (
      SELECT m.occurred_at,sum(CASE WHEN p_to=CASE
        WHEN m.wholesale_payment_entry_id IS NOT NULL AND m.sale_id IS NULL THEN 'mayoristas'
        WHEN m.sale_id IS NOT NULL AND m.wholesale_payment_entry_id IS NULL AND m.movement_type IN ('sale_income','sale_reversal') THEN 'minoristas'
        WHEN m.sale_id IS NULL AND m.wholesale_payment_entry_id IS NULL AND m.movement_type<>'opening_balance' THEN coalesce(a.sector,'unassigned') ELSE 'unassigned' END THEN m.amount ELSE 0 END) amount
      FROM public.cash_movements m LEFT JOIN public.financial_sector_allocations a ON a.cash_movement_id=m.id
      WHERE m.period_id=v_row.period_id AND m.account_id=v_row.account_id GROUP BY m.occurred_at
      UNION ALL SELECT v_row.occurred_at,v_row.amount
    ), balances AS (SELECT occurred_at,sum(sum(amount)) OVER (ORDER BY occurred_at) balance FROM dated GROUP BY occurred_at)
    SELECT min(balance) INTO v_min FROM balances WHERE occurred_at>=v_row.occurred_at;
    IF v_min<0 THEN RAISE EXCEPTION 'SECTOR_FINANCE_INSUFFICIENT'; END IF;
    INSERT INTO public.financial_sector_operations(id,action,actor_id,period_id,request,legacy_movement_id) VALUES(p_key,'reclassify',p_actor,v_row.period_id,v_request,p_reverse_movement);
    INSERT INTO public.financial_sector_allocations VALUES(v_row.id,p_key,p_to);
    RETURN p_key;
  END IF;
  IF p_action='reverse' AND p_reverse_movement IS NOT NULL THEN
    SELECT * INTO v_row FROM public.cash_movements WHERE id=p_reverse_movement FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SECTOR_FINANCE_REVERSAL_INVALID'; END IF;
    -- Solo movimientos probadamente creados por la RPC manual. Nunca ventas, cobros, reembolsos ni transferencias.
    IF v_row.sale_id IS NOT NULL OR v_row.wholesale_payment_entry_id IS NOT NULL OR v_row.transfer_id IS NOT NULL
      OR v_row.movement_type NOT IN ('income','cash_contribution','expense','cash_withdrawal')
      OR EXISTS(SELECT 1 FROM public.financial_sector_allocations WHERE cash_movement_id=p_reverse_movement)
      OR NOT EXISTS(SELECT 1 FROM public.financial_operation_requests r WHERE r.operation_type='manual_movement' AND r.result_id=v_row.id AND r.idempotency_key=v_row.idempotency_key)
      OR EXISTS(SELECT 1 FROM public.financial_sector_operations WHERE legacy_movement_id=p_reverse_movement) THEN RAISE EXCEPTION 'SECTOR_FINANCE_COMMERCIAL_REVERSAL_FORBIDDEN'; END IF;
    IF p_occurred_at<v_row.occurred_at THEN RAISE EXCEPTION 'SECTOR_FINANCE_REVERSAL_DATE'; END IF;
    PERFORM 1 FROM public.financial_accounts WHERE id=v_row.account_id AND active FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SECTOR_FINANCE_ACCOUNT'; END IF;
    IF v_row.amount>0 THEN PERFORM public.assert_sector_finance_debit(v_period.id,v_row.account_id,'unassigned',v_row.amount,p_occurred_at); END IF;
    INSERT INTO public.financial_sector_operations(id,action,actor_id,period_id,request,legacy_movement_id) VALUES(p_key,'reverse',p_actor,v_period.id,v_request,p_reverse_movement);
    INSERT INTO public.cash_movements(movement_type,amount,description,account_id,period_id,occurred_at)
    VALUES('adjustment',-v_row.amount,p_reason,v_row.account_id,v_period.id,p_occurred_at) RETURNING id INTO v_id;
    INSERT INTO public.financial_sector_allocations VALUES(v_id,p_key,'unassigned');
    RETURN p_key;
  END IF;
  IF p_action='reverse' THEN
    SELECT * INTO v_original FROM public.financial_sector_operations WHERE id=p_reverse_of;
    IF NOT FOUND OR v_original.action IN ('reverse','reclassify') OR EXISTS(SELECT 1 FROM public.financial_sector_operations WHERE reverse_of=p_reverse_of) THEN RAISE EXCEPTION 'SECTOR_FINANCE_REVERSAL_INVALID'; END IF;
    IF p_occurred_at<(v_original.request->>'date')::timestamptz THEN RAISE EXCEPTION 'SECTOR_FINANCE_REVERSAL_DATE'; END IF;
    IF (SELECT count(*) FROM public.financial_sector_allocations WHERE operation_id=p_reverse_of) <> (CASE WHEN v_original.action='transfer' THEN 2 ELSE 1 END) THEN RAISE EXCEPTION 'SECTOR_FINANCE_INCOMPLETE'; END IF;
    FOR v_row IN SELECT m.*,a.sector FROM public.financial_sector_allocations a JOIN public.cash_movements m ON m.id=a.cash_movement_id WHERE a.operation_id=p_reverse_of ORDER BY m.id LOOP
      IF NOT EXISTS(SELECT 1 FROM public.financial_accounts WHERE id=v_row.account_id AND active) THEN RAISE EXCEPTION 'SECTOR_FINANCE_ACCOUNT'; END IF;
      IF v_row.sale_id IS NOT NULL OR v_row.wholesale_payment_entry_id IS NOT NULL OR v_row.movement_type NOT IN ('income','cash_contribution','expense','cash_withdrawal','adjustment') THEN RAISE EXCEPTION 'SECTOR_FINANCE_COMMERCIAL_REVERSAL_FORBIDDEN'; END IF;
      IF v_row.amount>0 THEN PERFORM public.assert_sector_finance_debit(v_period.id,v_row.account_id,v_row.sector,v_row.amount,p_occurred_at); END IF;
    END LOOP;
  ELSE
    PERFORM 1 FROM public.financial_accounts WHERE id=p_account AND active FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SECTOR_FINANCE_ACCOUNT'; END IF;
    IF p_action IN ('withdrawal','transfer') THEN PERFORM public.assert_sector_finance_debit(v_period.id,p_account,p_from,p_amount,p_occurred_at); END IF;
  END IF;
  INSERT INTO public.financial_sector_operations(id,action,actor_id,period_id,request,reverse_of) VALUES(p_key,p_action,p_actor,v_period.id,v_request,p_reverse_of);
  IF p_action='reverse' THEN
    FOR v_row IN SELECT m.*,a.sector FROM public.financial_sector_allocations a JOIN public.cash_movements m ON m.id=a.cash_movement_id WHERE a.operation_id=p_reverse_of ORDER BY m.id LOOP
      INSERT INTO public.cash_movements(movement_type,amount,description,account_id,period_id,occurred_at,transfer_id)
      VALUES('adjustment',-v_row.amount,p_reason,v_row.account_id,v_period.id,p_occurred_at,CASE WHEN v_original.action='transfer' THEN p_key ELSE NULL END) RETURNING id INTO v_id;
      INSERT INTO public.financial_sector_allocations VALUES(v_id,p_key,v_row.sector);
    END LOOP;
  ELSE
    IF p_action IN ('withdrawal','transfer') THEN
      INSERT INTO public.cash_movements(movement_type,amount,description,account_id,period_id,occurred_at,transfer_id)
      VALUES(CASE WHEN p_action='transfer' THEN 'adjustment' ELSE v_kind END,-p_amount,p_reason,p_account,v_period.id,p_occurred_at,CASE WHEN p_action='transfer' THEN p_key ELSE NULL END) RETURNING id INTO v_id;
      INSERT INTO public.financial_sector_allocations VALUES(v_id,p_key,p_from);
    END IF;
    IF p_action IN ('income','transfer') THEN
      INSERT INTO public.cash_movements(movement_type,amount,description,account_id,period_id,occurred_at,transfer_id)
      VALUES(CASE WHEN p_action='transfer' THEN 'adjustment' ELSE v_kind END,p_amount,p_reason,p_account,v_period.id,p_occurred_at,CASE WHEN p_action='transfer' THEN p_key ELSE NULL END) RETURNING id INTO v_id;
      INSERT INTO public.financial_sector_allocations VALUES(v_id,p_key,p_to);
    END IF;
  END IF;
  RETURN p_key;
END $$;
ALTER FUNCTION public.record_sector_finance(text,varchar,numeric,text,text,timestamptz,text,text,uuid,uuid,uuid,text,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_sector_finance_history(),public.guard_sector_cash_history(),public.sector_financial_balance(uuid,varchar,text),public.assert_sector_finance_debit(uuid,varchar,text,numeric,timestamptz),public.record_sector_finance(text,varchar,numeric,text,text,timestamptz,text,text,uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_sector_finance(text,varchar,numeric,text,text,timestamptz,text,text,uuid,uuid,uuid,text,uuid) TO service_role;
COMMIT;
