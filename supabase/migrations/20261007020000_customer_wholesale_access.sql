BEGIN;

ALTER TABLE public.customers
  ADD COLUMN wholesale_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN wholesale_access_active BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN wholesale_code_hash TEXT,
  ADD COLUMN wholesale_access_activated_at TIMESTAMPTZ,
  ADD COLUMN wholesale_code_updated_at TIMESTAMPTZ,
  ADD COLUMN wholesale_access_updated_at TIMESTAMPTZ;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_wholesale_code_hash_format
    CHECK (wholesale_code_hash IS NULL OR wholesale_code_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT customers_wholesale_access_consistent
    CHECK (NOT wholesale_access_active OR (wholesale_enabled AND wholesale_code_hash IS NOT NULL)),
  ADD CONSTRAINT customers_wholesale_hash_requires_enabled
    CHECK (wholesale_code_hash IS NULL OR wholesale_enabled);

CREATE UNIQUE INDEX customers_wholesale_code_hash_uidx
  ON public.customers (wholesale_code_hash) WHERE wholesale_code_hash IS NOT NULL;
CREATE INDEX customers_wholesale_enabled_idx
  ON public.customers (wholesale_enabled, wholesale_access_active) WHERE wholesale_enabled;

CREATE FUNCTION public.admin_manage_customer_wholesale(p_action TEXT, p_customer UUID, p_code_hash TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_customer public.customers%ROWTYPE; v_before JSONB;
BEGIN
  IF p_customer IS NULL OR p_action IS NULL OR p_action NOT IN ('activate','revoke','disable') THEN
    RAISE EXCEPTION 'WHOLESALE_INVALID_ACTION';
  END IF;
  IF p_action='activate' AND (p_code_hash IS NULL OR p_code_hash !~ '^[a-f0-9]{64}$') THEN
    RAISE EXCEPTION 'WHOLESALE_INVALID_CODE_HASH';
  END IF;
  SELECT * INTO v_customer FROM public.customers WHERE id=p_customer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_NOT_FOUND'; END IF;
  v_before:=to_jsonb(v_customer) - 'wholesale_code_hash';

  IF p_action='activate' THEN
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
END $$;

REVOKE ALL ON FUNCTION public.admin_manage_customer_wholesale(TEXT,UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_manage_customer_wholesale(TEXT,UUID,TEXT) TO service_role;

-- Keep the existing customer workflow, but do not copy or return the new secret hash.
CREATE OR REPLACE FUNCTION public.admin_manage_customer(p_action TEXT, p_customer UUID DEFAULT NULL, p_data JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_customer public.customers%ROWTYPE;
  v_name TEXT; v_phone TEXT; v_email TEXT; v_document TEXT; v_notes TEXT;
  v_before JSONB;
BEGIN
  IF p_action='create' OR p_action='edit' THEN
    IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CUSTOMER_INVALID_INPUT'; END IF;
    v_name:=btrim(p_data->>'full_name');
    v_phone:=NULLIF(btrim(COALESCE(p_data->>'phone','')),'');
    v_email:=NULLIF(btrim(COALESCE(p_data->>'email','')),'');
    v_document:=NULLIF(btrim(COALESCE(p_data->>'document_number','')),'');
    v_notes:=btrim(COALESCE(p_data->>'notes',''));
    IF v_name IS NULL OR v_name='' OR length(v_name)>160 OR length(v_phone)>50
       OR length(v_email)>255 OR length(v_document)>40 OR length(v_notes)>1000
       OR p_data ? 'id' OR p_data ? 'archived_at' THEN RAISE EXCEPTION 'CUSTOMER_INVALID_INPUT'; END IF;
    IF p_action='create' THEN
      INSERT INTO public.customers(full_name,phone,email,document_number,notes)
      VALUES(v_name,v_phone,v_email,v_document,v_notes) RETURNING * INTO v_customer;
    ELSE
      IF p_customer IS NULL THEN RAISE EXCEPTION 'CUSTOMER_INVALID_INPUT'; END IF;
      SELECT to_jsonb(c) - 'wholesale_code_hash' INTO v_before FROM public.customers c WHERE id=p_customer FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_NOT_FOUND'; END IF;
      UPDATE public.customers SET full_name=v_name,phone=v_phone,email=v_email,
        document_number=v_document,notes=v_notes WHERE id=p_customer RETURNING * INTO v_customer;
    END IF;
    INSERT INTO public.customer_admin_history(customer_id,action,before_data,after_data)
      VALUES(v_customer.id,p_action,v_before,to_jsonb(v_customer) - 'wholesale_code_hash');
  ELSIF p_action IN ('archive','restore','delete') THEN
    IF p_customer IS NULL THEN RAISE EXCEPTION 'CUSTOMER_INVALID_INPUT'; END IF;
    SELECT * INTO v_customer FROM public.customers WHERE id=p_customer FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_NOT_FOUND'; END IF;
    v_before:=to_jsonb(v_customer) - 'wholesale_code_hash';
    IF p_action='delete' THEN
      IF EXISTS(SELECT 1 FROM public.customer_vehicles WHERE customer_id=p_customer)
         OR EXISTS(SELECT 1 FROM public.orders WHERE customer_id=p_customer)
         OR EXISTS(SELECT 1 FROM public.sales WHERE customer_id=p_customer)
         OR EXISTS(SELECT 1 FROM public.warranties WHERE customer_id=p_customer) THEN
        RAISE EXCEPTION 'CUSTOMER_HAS_DEPENDENCIES';
      END IF;
      DELETE FROM public.customers WHERE id=p_customer;
      RETURN jsonb_build_object('id',p_customer,'deleted',true);
    END IF;
    IF (v_customer.archived_at IS NOT NULL) IS DISTINCT FROM (p_action='archive') THEN
      UPDATE public.customers SET archived_at=CASE WHEN p_action='archive' THEN clock_timestamp() ELSE NULL END
        WHERE id=p_customer RETURNING * INTO v_customer;
      INSERT INTO public.customer_admin_history(customer_id,action,before_data,after_data)
        VALUES(p_customer,p_action,v_before,to_jsonb(v_customer) - 'wholesale_code_hash');
    END IF;
  ELSE
    RAISE EXCEPTION 'CUSTOMER_INVALID_ACTION';
  END IF;
  RETURN to_jsonb(v_customer) - 'wholesale_code_hash';
END $$;

COMMIT;
