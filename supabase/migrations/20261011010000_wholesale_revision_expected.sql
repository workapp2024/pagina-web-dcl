-- Atomically create a wholesale proposal only from the revision the admin reviewed.
BEGIN;

CREATE FUNCTION public.propose_wholesale_order_revision_if_current(
  p_order UUID,
  p_expected_revision UUID,
  p_items JSONB,
  p_idempotency_key UUID,
  p_actor UUID,
  p_commercial_conditions TEXT DEFAULT NULL,
  p_internal_note TEXT DEFAULT ''
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_order public.wholesale_orders%ROWTYPE;
  v_current public.wholesale_order_revisions%ROWTYPE;
  v_existing public.wholesale_order_revisions%ROWTYPE;
  v_revision UUID := gen_random_uuid();
  v_normalized JSONB;
  v_snapshot JSONB;
  v_conditions TEXT;
  v_fingerprint TEXT;
  v_total NUMERIC(12,2);
  v_version INTEGER;
  v_requires_approval BOOLEAN;
  v_old_signature JSONB;
  v_new_signature JSONB;
BEGIN
  IF p_order IS NULL OR p_expected_revision IS NULL OR p_idempotency_key IS NULL OR p_actor IS NULL
    OR length(COALESCE(p_internal_note,'')) > 1000
    OR (p_commercial_conditions IS NOT NULL AND length(p_commercial_conditions) > 2000) THEN
    RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST';
  END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  v_normalized := public.normalize_wholesale_order_items(p_items);

  -- Serialize proposal attempts for this order. The expected-revision comparison
  -- happens after acquiring this lock and before any writes.
  SELECT * INTO v_order FROM public.wholesale_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ORDER_NOT_FOUND'; END IF;

  v_fingerprint := encode(sha256(convert_to(jsonb_build_object(
    'expected_revision', p_expected_revision,
    'items', v_normalized,
    'conditions_input', p_commercial_conditions
  )::TEXT, 'UTF8')), 'hex');

  -- A successful retry remains idempotent even though it advanced current_revision_id.
  SELECT * INTO v_existing FROM public.wholesale_order_revisions
    WHERE order_id = p_order AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_fingerprint <> v_fingerprint THEN RAISE EXCEPTION 'WHOLESALE_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN v_existing.id;
  END IF;

  IF v_order.current_revision_id <> p_expected_revision THEN RAISE EXCEPTION 'WHOLESALE_REVISION_STALE'; END IF;
  IF v_order.status NOT IN ('received','in_review','awaiting_customer') THEN
    RAISE EXCEPTION 'WHOLESALE_ORDER_INVALID_STATE';
  END IF;

  SELECT * INTO v_current FROM public.wholesale_order_revisions WHERE id = p_expected_revision FOR UPDATE;
  IF NOT FOUND OR v_current.order_id <> p_order
    OR v_current.status NOT IN ('ready_for_confirmation','awaiting_customer','approved') THEN
    RAISE EXCEPTION 'WHOLESALE_REVISION_INVALID_STATE';
  END IF;

  v_conditions := COALESCE(p_commercial_conditions, v_current.commercial_conditions);
  v_snapshot := public.snapshot_wholesale_order_items(v_normalized);
  SELECT COALESCE(jsonb_agg(jsonb_build_array(product_id,quantity,unit_price) ORDER BY product_id),'[]'::JSONB)
    INTO v_old_signature FROM public.wholesale_order_revision_items WHERE revision_id = v_current.id;
  SELECT COALESCE(jsonb_agg(jsonb_build_array(x.product_id,x.quantity,x.unit_price) ORDER BY x.product_id),'[]'::JSONB)
    INTO v_new_signature FROM jsonb_to_recordset(v_snapshot) AS x(product_id TEXT,quantity INTEGER,unit_price NUMERIC);
  SELECT sum((item->>'line_total')::NUMERIC) INTO v_total FROM jsonb_array_elements(v_snapshot) item;
  v_requires_approval := v_old_signature IS DISTINCT FROM v_new_signature
    OR v_current.total_amount IS DISTINCT FROM v_total
    OR v_current.commercial_conditions IS DISTINCT FROM v_conditions;
  SELECT COALESCE(max(version_number),0) + 1 INTO v_version
    FROM public.wholesale_order_revisions WHERE order_id = p_order;

  INSERT INTO public.wholesale_order_revisions(
    id, order_id, version_number, revision_type, status, requires_customer_approval,
    commercial_conditions, total_amount, idempotency_key, request_fingerprint, created_by
  ) VALUES (
    v_revision, p_order, v_version, 'proposal', 'draft', v_requires_approval,
    v_conditions, v_total, p_idempotency_key, v_fingerprint, p_actor
  );
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
  UPDATE public.wholesale_order_revisions SET status =
    CASE WHEN v_requires_approval THEN 'awaiting_customer' ELSE 'ready_for_confirmation' END
    WHERE id = v_revision;
  IF v_current.status <> 'confirmed' THEN
    UPDATE public.wholesale_order_revisions SET status = 'superseded' WHERE id = v_current.id;
  END IF;
  UPDATE public.wholesale_orders SET current_revision_id = v_revision,
    status = CASE WHEN v_requires_approval THEN 'awaiting_customer' ELSE 'in_review' END
    WHERE id = p_order;
  INSERT INTO public.wholesale_order_events(order_id, revision_id, event_type, actor_type, actor_id, source, internal_note)
    VALUES (p_order, v_revision, 'revision_created', 'admin', p_actor, 'admin', btrim(COALESCE(p_internal_note,''))),
           (p_order, v_revision, 'revision_proposed', 'admin', p_actor, 'admin', btrim(COALESCE(p_internal_note,'')));
  RETURN v_revision;
END;
$$;

REVOKE ALL ON FUNCTION public.propose_wholesale_order_revision_if_current(UUID,UUID,JSONB,UUID,UUID,TEXT,TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.propose_wholesale_order_revision_if_current(UUID,UUID,JSONB,UUID,UUID,TEXT,TEXT)
  TO service_role;

COMMIT;
