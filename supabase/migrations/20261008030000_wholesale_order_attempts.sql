-- Server-owned operation identity for wholesale order retries.
-- Additive migration: do not rerun the previously applied wholesale migrations.
BEGIN;

CREATE TABLE public.wholesale_order_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  idempotency_key UUID NOT NULL,
  request_items JSONB NOT NULL CHECK (jsonb_typeof(request_items) = 'array'),
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','created','acknowledged','abandoned')),
  order_id UUID REFERENCES public.wholesale_orders(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  closed_at TIMESTAMPTZ,
  CONSTRAINT wholesale_order_attempts_customer_key_unique UNIQUE (customer_id, idempotency_key),
  CONSTRAINT wholesale_order_attempts_order_unique UNIQUE (order_id),
  CONSTRAINT wholesale_order_attempts_result_shape CHECK (
    (status IN ('open','abandoned') AND order_id IS NULL)
    OR (status IN ('created','acknowledged') AND order_id IS NOT NULL)
  ),
  CONSTRAINT wholesale_order_attempts_closed_shape CHECK (
    (status IN ('open','created') AND closed_at IS NULL)
    OR (status IN ('acknowledged','abandoned') AND closed_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX wholesale_order_attempts_one_open_per_customer_idx
  ON public.wholesale_order_attempts(customer_id) WHERE status = 'open';
CREATE INDEX wholesale_order_attempts_customer_created_idx
  ON public.wholesale_order_attempts(customer_id, created_at DESC, id DESC);
CREATE INDEX wholesale_order_attempts_recoverable_idx
  ON public.wholesale_order_attempts(customer_id, created_at DESC, id DESC)
  WHERE status = 'created';

ALTER TABLE public.wholesale_order_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wholesale_order_attempts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.wholesale_order_attempts TO service_role;

CREATE FUNCTION public.guard_wholesale_order_attempt_update()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_items IS DISTINCT FROM OLD.request_items
    OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'WHOLESALE_ATTEMPT_IMMUTABLE_FIELD';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'open' AND NEW.status IN ('created','abandoned'))
    OR (OLD.status = 'created' AND NEW.status = 'acknowledged')
  ) THEN RAISE EXCEPTION 'WHOLESALE_ATTEMPT_INVALID_TRANSITION'; END IF;
  IF OLD.order_id IS NOT NULL AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    RAISE EXCEPTION 'WHOLESALE_ATTEMPT_ORDER_IMMUTABLE';
  END IF;
  IF OLD.status = 'open' AND NEW.status = 'created' AND NEW.order_id IS NULL THEN
    RAISE EXCEPTION 'WHOLESALE_ATTEMPT_ORDER_REQUIRED';
  END IF;
  IF OLD.status = 'open' AND NEW.status = 'abandoned' AND NEW.order_id IS NOT NULL THEN
    RAISE EXCEPTION 'WHOLESALE_ATTEMPT_ALREADY_CREATED';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wholesale_order_attempts_guard_update
BEFORE UPDATE ON public.wholesale_order_attempts
FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_order_attempt_update();

CREATE FUNCTION public.start_wholesale_order_attempt(p_customer UUID, p_items JSONB, p_new_intent BOOLEAN DEFAULT FALSE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_normalized JSONB;
  v_fingerprint TEXT;
  v_attempt public.wholesale_order_attempts%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_previous_order UUID;
BEGIN
  IF p_customer IS NULL THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  v_normalized := public.normalize_wholesale_order_items(p_items);
  v_fingerprint := encode(sha256(convert_to(v_normalized::TEXT, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_customer::TEXT || ':wholesale-order-attempt', 0));
  SELECT * INTO v_customer FROM public.customers WHERE id = p_customer FOR SHARE;
  IF NOT FOUND OR v_customer.archived_at IS NOT NULL
    OR NOT v_customer.wholesale_enabled OR NOT v_customer.wholesale_access_active THEN
    RAISE EXCEPTION 'WHOLESALE_CUSTOMER_UNAVAILABLE';
  END IF;
  SELECT * INTO v_attempt FROM public.wholesale_order_attempts
    WHERE customer_id = p_customer AND status = 'open' FOR UPDATE;
  IF FOUND THEN
    IF v_attempt.request_fingerprint <> v_fingerprint THEN RAISE EXCEPTION 'WHOLESALE_ATTEMPT_CONFLICT'; END IF;
    RETURN jsonb_build_object('attemptId', v_attempt.id, 'status', v_attempt.status);
  END IF;
  IF NOT p_new_intent THEN
    SELECT * INTO v_attempt FROM public.wholesale_order_attempts
      WHERE customer_id = p_customer AND request_fingerprint = v_fingerprint
        AND status IN ('created','acknowledged')
      ORDER BY created_at DESC, id DESC LIMIT 1;
    IF FOUND THEN
      v_previous_order := v_attempt.order_id;
      RETURN jsonb_build_object(
        'attemptId', v_attempt.id, 'status', v_attempt.status,
        'orderId', v_previous_order, 'recovered', TRUE
      );
    END IF;
  END IF;
  INSERT INTO public.wholesale_order_attempts(customer_id, idempotency_key, request_items, request_fingerprint)
  VALUES (p_customer, gen_random_uuid(), v_normalized, v_fingerprint)
  RETURNING * INTO v_attempt;
  RETURN jsonb_build_object('attemptId', v_attempt.id, 'status', v_attempt.status);
END;
$$;

CREATE FUNCTION public.abandon_wholesale_order_attempt(p_customer UUID, p_attempt UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_attempt public.wholesale_order_attempts%ROWTYPE;
BEGIN
  IF p_customer IS NULL OR p_attempt IS NULL THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_customer::TEXT || ':wholesale-order-attempt', 0));
  SELECT * INTO v_attempt FROM public.wholesale_order_attempts
    WHERE id = p_attempt AND customer_id = p_customer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ATTEMPT_NOT_FOUND'; END IF;
  IF v_attempt.status = 'abandoned' THEN RETURN 'abandoned'; END IF;
  IF v_attempt.status <> 'open' OR v_attempt.order_id IS NOT NULL THEN
    RAISE EXCEPTION 'WHOLESALE_ATTEMPT_ALREADY_CREATED';
  END IF;
  UPDATE public.wholesale_order_attempts
    SET status = 'abandoned', updated_at = clock_timestamp(), closed_at = clock_timestamp()
    WHERE id = p_attempt;
  RETURN 'abandoned';
END;
$$;

CREATE FUNCTION public.acknowledge_wholesale_order_attempt(p_customer UUID, p_attempt UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_attempt public.wholesale_order_attempts%ROWTYPE;
BEGIN
  IF p_customer IS NULL OR p_attempt IS NULL THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_customer::TEXT || ':wholesale-order-attempt', 0));
  SELECT * INTO v_attempt FROM public.wholesale_order_attempts
    WHERE id = p_attempt AND customer_id = p_customer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ATTEMPT_NOT_FOUND'; END IF;
  IF v_attempt.status = 'acknowledged' THEN RETURN 'acknowledged'; END IF;
  IF v_attempt.status <> 'created' OR v_attempt.order_id IS NULL THEN
    RAISE EXCEPTION 'WHOLESALE_ATTEMPT_NOT_RECOVERABLE';
  END IF;
  UPDATE public.wholesale_order_attempts
    SET status = 'acknowledged', updated_at = clock_timestamp(), closed_at = clock_timestamp()
    WHERE id = p_attempt;
  RETURN 'acknowledged';
END;
$$;

CREATE FUNCTION public.get_wholesale_order_attempts(p_customer UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_result JSONB;
BEGIN
  IF p_customer IS NULL THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'attemptId', a.id,
    'status', a.status,
    'createdAt', a.created_at,
    'items', a.request_items,
    'order', CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', o.id,
      'orderNumber', o.order_number,
      'status', o.status,
      'createdAt', o.created_at,
      'confirmedAt', o.confirmed_at,
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'productId', ri.product_id,
          'name', ri.product_name_snapshot,
          'quantity', ri.quantity,
          'unitPrice', ri.unit_price,
          'lineTotal', ri.line_total,
          'currency', ri.currency
        ) ORDER BY ri.product_id)
        FROM public.wholesale_order_revisions r
        JOIN public.wholesale_order_revision_items ri ON ri.revision_id = r.id
        WHERE r.id = o.current_revision_id
      ), '[]'::JSONB)
    ) END
  ) ORDER BY a.created_at DESC, a.id DESC), '[]'::JSONB)
  INTO v_result
  FROM public.wholesale_order_attempts a
  LEFT JOIN public.wholesale_orders o ON o.id = a.order_id AND o.customer_id = p_customer
  WHERE a.customer_id = p_customer AND a.status IN ('open','created');
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.list_wholesale_customer_orders(
  p_customer UUID, p_limit INTEGER DEFAULT 25,
  p_before_created_at TIMESTAMPTZ DEFAULT NULL, p_before_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_result JSONB;
BEGIN
  IF p_customer IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR ((p_before_created_at IS NULL) <> (p_before_id IS NULL)) THEN
    RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page.created_at DESC, page.id DESC), '[]'::JSONB)
    INTO v_result
  FROM (
    SELECT o.id, o.order_number, o.status, o.created_at, o.confirmed_at,
      r.total_amount, r.currency,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'productId', ri.product_id,
          'name', ri.product_name_snapshot,
          'quantity', ri.quantity,
          'unitPrice', ri.unit_price,
          'lineTotal', ri.line_total,
          'currency', ri.currency
        ) ORDER BY ri.product_id)
        FROM public.wholesale_order_revision_items ri WHERE ri.revision_id = r.id
      ), '[]'::JSONB) AS items
    FROM public.wholesale_orders o
    JOIN public.wholesale_order_revisions r ON r.id = o.current_revision_id AND r.order_id = o.id
    WHERE o.customer_id = p_customer
      AND (p_before_created_at IS NULL OR (o.created_at, o.id) < (p_before_created_at, p_before_id))
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT p_limit
  ) AS page;
  RETURN v_result;
END;
$$;

-- Internal creation path. Only the attempt-based RPC may call this routine.
CREATE FUNCTION public.create_wholesale_order_for_attempt(
  p_customer UUID, p_attempt UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_order UUID;
  v_revision UUID := gen_random_uuid();
  v_normalized JSONB;
  v_snapshot JSONB;
  v_fingerprint TEXT;
  v_existing public.wholesale_orders%ROWTYPE;
  v_attempt public.wholesale_order_attempts%ROWTYPE;
  v_key UUID;
  v_revision_fingerprint TEXT;
  v_total NUMERIC(12,2);
BEGIN
  IF p_customer IS NULL OR p_attempt IS NULL THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_customer::TEXT || ':wholesale-order-attempt', 0));
  SELECT * INTO v_attempt FROM public.wholesale_order_attempts
    WHERE id = p_attempt AND customer_id = p_customer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ATTEMPT_NOT_FOUND'; END IF;
  v_normalized := public.normalize_wholesale_order_items(v_attempt.request_items);
  v_fingerprint := encode(sha256(convert_to(v_normalized::TEXT, 'UTF8')), 'hex');
  IF v_attempt.request_fingerprint <> v_fingerprint THEN RAISE EXCEPTION 'WHOLESALE_IDEMPOTENCY_CONFLICT'; END IF;
  IF v_attempt.status IN ('created','acknowledged') AND v_attempt.order_id IS NOT NULL THEN RETURN v_attempt.order_id; END IF;
  IF v_attempt.status = 'abandoned' THEN RAISE EXCEPTION 'WHOLESALE_ATTEMPT_ABANDONED'; END IF;
  IF v_attempt.status <> 'open' THEN RAISE EXCEPTION 'WHOLESALE_ATTEMPT_INVALID_STATE'; END IF;
  v_key := v_attempt.idempotency_key;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_customer::TEXT || ':' || v_key::TEXT, 1));

  -- Recover only an exact key match; never infer operation identity from cart contents.
  SELECT * INTO v_existing FROM public.wholesale_orders
    WHERE customer_id = p_customer AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.request_fingerprint <> v_fingerprint THEN RAISE EXCEPTION 'WHOLESALE_IDEMPOTENCY_CONFLICT'; END IF;
    UPDATE public.wholesale_order_attempts
      SET status = 'created', order_id = v_existing.id, updated_at = clock_timestamp()
      WHERE id = p_attempt;
    RETURN v_existing.id;
  END IF;

  SELECT * INTO v_customer FROM public.customers WHERE id = p_customer FOR SHARE;
  IF NOT FOUND OR v_customer.archived_at IS NOT NULL
    OR NOT v_customer.wholesale_enabled OR NOT v_customer.wholesale_access_active THEN
    RAISE EXCEPTION 'WHOLESALE_CUSTOMER_UNAVAILABLE';
  END IF;
  v_snapshot := public.snapshot_wholesale_order_items(v_normalized);
  v_revision_fingerprint := encode(sha256(convert_to(v_snapshot::TEXT, 'UTF8')), 'hex');
  SELECT sum((item->>'line_total')::NUMERIC) INTO v_total FROM jsonb_array_elements(v_snapshot) item;
  v_order := gen_random_uuid();
  INSERT INTO public.wholesale_orders(id, customer_id, current_revision_id, idempotency_key, request_fingerprint)
  VALUES (v_order, p_customer, v_revision, v_key, v_fingerprint);
  INSERT INTO public.wholesale_order_revisions(
    id, order_id, version_number, revision_type, status, total_amount, idempotency_key, request_fingerprint
  ) VALUES (v_revision, v_order, 1, 'original', 'draft', v_total, v_key, v_revision_fingerprint);
  INSERT INTO public.wholesale_order_revision_items(
    revision_id, product_id, product_name_snapshot, category_snapshot, connector_type_snapshot,
    quantity, unit_price, unit_cost_reference, line_total, currency
  ) SELECT v_revision, x.product_id, x.product_name_snapshot, x.category_snapshot, x.connector_type_snapshot,
      x.quantity, x.unit_price, x.unit_cost_reference, x.line_total, x.currency
    FROM jsonb_to_recordset(v_snapshot) AS x(
      product_id VARCHAR(64), product_name_snapshot VARCHAR(255), category_snapshot VARCHAR(120),
      connector_type_snapshot VARCHAR(80), quantity INTEGER, unit_price NUMERIC(12,2),
      unit_cost_reference NUMERIC(12,2), line_total NUMERIC(12,2), currency CHAR(3)
    );
  UPDATE public.wholesale_order_revisions SET status = 'ready_for_confirmation' WHERE id = v_revision;
  INSERT INTO public.wholesale_order_events(order_id, revision_id, event_type, actor_type, actor_id, source)
    VALUES (v_order, v_revision, 'order_created', 'customer', p_customer, 'portal'),
           (v_order, v_revision, 'revision_created', 'system', NULL, 'system');
  UPDATE public.wholesale_order_attempts
    SET status = 'created', order_id = v_order, updated_at = clock_timestamp()
    WHERE id = p_attempt;
  RETURN v_order;
END;
$$;

-- A rollback to the pre-attempt application must fail closed: it cannot know
-- whether a fresh key denotes a new intent or an ambiguous retry after reload.
CREATE OR REPLACE FUNCTION public.create_wholesale_order(
  p_customer UUID, p_items JSONB, p_idempotency_key UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'WHOLESALE_LEGACY_SUBMISSION_DISABLED';
END;
$$;
REVOKE ALL ON FUNCTION public.create_wholesale_order(UUID,JSONB,UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_wholesale_order_for_attempt(UUID,UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.submit_wholesale_order_attempt(p_customer UUID, p_attempt UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_attempt public.wholesale_order_attempts%ROWTYPE; v_order UUID;
BEGIN
  IF p_customer IS NULL OR p_attempt IS NULL THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_customer::TEXT || ':wholesale-order-attempt', 0));
  SELECT * INTO v_attempt FROM public.wholesale_order_attempts
    WHERE id = p_attempt AND customer_id = p_customer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ATTEMPT_NOT_FOUND'; END IF;
  IF v_attempt.status IN ('created','acknowledged') AND v_attempt.order_id IS NOT NULL THEN RETURN v_attempt.order_id; END IF;
  IF v_attempt.status = 'abandoned' THEN RAISE EXCEPTION 'WHOLESALE_ATTEMPT_ABANDONED'; END IF;
  IF v_attempt.status <> 'open' THEN RAISE EXCEPTION 'WHOLESALE_ATTEMPT_INVALID_STATE'; END IF;
  v_order := public.create_wholesale_order_for_attempt(p_customer, p_attempt);
  RETURN v_order;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_wholesale_order_attempt_update() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.start_wholesale_order_attempt(UUID,JSONB,BOOLEAN),
  public.abandon_wholesale_order_attempt(UUID,UUID),
  public.acknowledge_wholesale_order_attempt(UUID,UUID),
  public.get_wholesale_order_attempts(UUID),
  public.list_wholesale_customer_orders(UUID,INTEGER,TIMESTAMPTZ,UUID),
  public.submit_wholesale_order_attempt(UUID,UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_wholesale_order_attempt(UUID,JSONB,BOOLEAN),
  public.abandon_wholesale_order_attempt(UUID,UUID),
  public.acknowledge_wholesale_order_attempt(UUID,UUID),
  public.get_wholesale_order_attempts(UUID),
  public.list_wholesale_customer_orders(UUID,INTEGER,TIMESTAMPTZ,UUID),
  public.submit_wholesale_order_attempt(UUID,UUID)
  TO service_role;

DO $wholesale_attempt_owner_check$
DECLARE
  v_submit_owner OID;
  v_create_owner OID;
BEGIN
  SELECT p.proowner INTO v_submit_owner
  FROM pg_catalog.pg_proc p
  WHERE p.oid = 'public.submit_wholesale_order_attempt(uuid,uuid)'::regprocedure;

  SELECT p.proowner INTO v_create_owner
  FROM pg_catalog.pg_proc p
  WHERE p.oid = 'public.create_wholesale_order_for_attempt(uuid,uuid)'::regprocedure;

  IF v_submit_owner IS DISTINCT FROM v_create_owner THEN
    RAISE EXCEPTION 'WHOLESALE_FUNCTION_OWNER_MISMATCH: submit_wholesale_order_attempt and create_wholesale_order_for_attempt must have the same owner';
  END IF;
END;
$wholesale_attempt_owner_check$;

COMMIT;
