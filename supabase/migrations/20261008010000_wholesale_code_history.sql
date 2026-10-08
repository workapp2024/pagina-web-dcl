BEGIN;

CREATE TABLE public.wholesale_code_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL,
  code_hash TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('active', 'existing', 'replaced', 'revoked', 'disabled', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT wholesale_code_history_hash_format CHECK (code_hash ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX wholesale_code_history_code_hash_uidx
  ON public.wholesale_code_history (code_hash);
CREATE INDEX wholesale_code_history_customer_created_idx
  ON public.wholesale_code_history (customer_id, created_at DESC);

-- Active codes already in use become permanent reservations without changing customers.
INSERT INTO public.wholesale_code_history(customer_id, code_hash, action)
SELECT id, wholesale_code_hash, CASE WHEN wholesale_access_active THEN 'active' ELSE 'existing' END
FROM public.customers
WHERE wholesale_code_hash IS NOT NULL;

ALTER TABLE public.wholesale_code_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wholesale_code_history FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.track_wholesale_code_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rows INTEGER;
  v_constraint TEXT;
  v_retirement_action TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.wholesale_code_hash IS NOT NULL THEN
      BEGIN
        INSERT INTO public.wholesale_code_history(customer_id, code_hash, action)
        VALUES (NEW.id, NEW.wholesale_code_hash, 'active');
      EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint = 'wholesale_code_history_code_hash_uidx' THEN
          RAISE EXCEPTION 'WHOLESALE_CODE_ALREADY_USED'
            USING ERRCODE = '23505', CONSTRAINT = 'wholesale_code_history_code_hash_uidx';
        END IF;
        RAISE;
      END;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.wholesale_code_hash IS NOT NULL THEN
      UPDATE public.wholesale_code_history
      SET action = 'deleted', updated_at = clock_timestamp()
      WHERE customer_id = OLD.id AND code_hash = OLD.wholesale_code_hash;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN RAISE EXCEPTION 'WHOLESALE_CODE_HISTORY_MISSING'; END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.wholesale_code_hash IS NOT DISTINCT FROM NEW.wholesale_code_hash THEN
    RETURN NEW;
  END IF;

  IF NEW.wholesale_code_hash IS NOT NULL THEN
    BEGIN
      INSERT INTO public.wholesale_code_history(customer_id, code_hash, action)
      VALUES (NEW.id, NEW.wholesale_code_hash, 'active');
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'wholesale_code_history_code_hash_uidx' THEN
        RAISE EXCEPTION 'WHOLESALE_CODE_ALREADY_USED'
          USING ERRCODE = '23505', CONSTRAINT = 'wholesale_code_history_code_hash_uidx';
      END IF;
      RAISE;
    END;
  END IF;

  IF OLD.wholesale_code_hash IS NOT NULL THEN
    IF NEW.wholesale_code_hash IS NOT NULL THEN
      v_retirement_action := 'replaced';
    ELSIF TG_OP = 'DELETE' THEN
      v_retirement_action := 'deleted';
    ELSIF NOT NEW.wholesale_enabled THEN
      v_retirement_action := 'disabled';
    ELSE
      v_retirement_action := 'revoked';
    END IF;
    UPDATE public.wholesale_code_history
    SET action = v_retirement_action, updated_at = clock_timestamp()
    WHERE customer_id = OLD.id AND code_hash = OLD.wholesale_code_hash;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN RAISE EXCEPTION 'WHOLESALE_CODE_HISTORY_MISSING'; END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.track_wholesale_code_history() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER customers_track_wholesale_code_insert
BEFORE INSERT ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.track_wholesale_code_history();

CREATE TRIGGER customers_track_wholesale_code_update
BEFORE UPDATE OF wholesale_code_hash ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.track_wholesale_code_history();

CREATE TRIGGER customers_track_wholesale_code_delete
BEFORE DELETE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.track_wholesale_code_history();

CREATE OR REPLACE FUNCTION public.admin_manage_customer_wholesale(p_action TEXT, p_customer UUID, p_code_hash TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_before JSONB;
BEGIN
  IF p_customer IS NULL OR p_action IS NULL OR p_action NOT IN ('activate','revoke','disable') THEN
    RAISE EXCEPTION 'WHOLESALE_INVALID_ACTION';
  END IF;
  IF p_action='activate' AND (p_code_hash IS NULL OR p_code_hash !~ '^[a-f0-9]{64}$') THEN
    RAISE EXCEPTION 'WHOLESALE_INVALID_CODE_HASH';
  END IF;

  SELECT * INTO v_customer FROM public.customers WHERE id=p_customer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_NOT_FOUND'; END IF;
  v_before := to_jsonb(v_customer) - 'wholesale_code_hash';

  IF p_action='activate' THEN
    IF v_customer.wholesale_code_hash = p_code_hash THEN
      RAISE EXCEPTION 'WHOLESALE_CODE_ALREADY_USED'
        USING ERRCODE = '23505', CONSTRAINT = 'wholesale_code_history_code_hash_uidx';
    END IF;
    UPDATE public.customers SET wholesale_enabled=TRUE, wholesale_access_active=TRUE,
      wholesale_code_hash=p_code_hash,
      wholesale_access_activated_at=clock_timestamp(), wholesale_code_updated_at=clock_timestamp(),
      wholesale_access_updated_at=clock_timestamp()
      WHERE id=p_customer RETURNING * INTO v_customer;
  ELSIF p_action='revoke' THEN
    UPDATE public.customers SET wholesale_access_active=FALSE, wholesale_code_hash=NULL,
      wholesale_access_updated_at=clock_timestamp()
      WHERE id=p_customer RETURNING * INTO v_customer;
  ELSE
    UPDATE public.customers SET wholesale_enabled=FALSE, wholesale_access_active=FALSE,
      wholesale_code_hash=NULL, wholesale_access_updated_at=clock_timestamp()
      WHERE id=p_customer RETURNING * INTO v_customer;
  END IF;

  INSERT INTO public.customer_admin_history(customer_id,action,before_data,after_data)
    VALUES(p_customer,'edit',v_before,to_jsonb(v_customer) - 'wholesale_code_hash');
  RETURN to_jsonb(v_customer) - 'wholesale_code_hash';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_manage_customer_wholesale(TEXT,UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_manage_customer_wholesale(TEXT,UUID,TEXT) TO service_role;

COMMIT;
