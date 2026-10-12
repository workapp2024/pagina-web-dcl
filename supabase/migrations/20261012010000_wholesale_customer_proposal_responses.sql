-- Customer responses to the current wholesale proposal.
-- Additive state/event support; no existing order data is rewritten.
BEGIN;

ALTER TABLE public.wholesale_order_revisions
  DROP CONSTRAINT wholesale_order_revisions_status_check,
  ADD CONSTRAINT wholesale_order_revisions_status_check
    CHECK (status IN ('draft','ready_for_confirmation','awaiting_customer','approved','rejected','confirmed','superseded'));

ALTER TABLE public.wholesale_order_events
  DROP CONSTRAINT wholesale_order_events_event_type_check,
  ADD CONSTRAINT wholesale_order_events_event_type_check
    CHECK (event_type IN (
      'order_created','review_started','revision_created','revision_proposed','revision_approved',
      'revision_rejected','order_confirmed','order_rejected','order_cancelled'
    )),
  DROP CONSTRAINT wholesale_order_events_approval_shape,
  ADD CONSTRAINT wholesale_order_events_approval_shape CHECK (
    (event_type = 'revision_approved' AND revision_id IS NOT NULL AND approval_channel = source)
    OR (event_type = 'revision_rejected' AND revision_id IS NOT NULL AND source = 'portal' AND approval_channel = 'portal')
    OR (event_type NOT IN ('revision_approved','revision_rejected') AND approval_channel IS NULL)
  );

CREATE UNIQUE INDEX wholesale_order_events_revision_rejection_once_idx
  ON public.wholesale_order_events(revision_id) WHERE event_type = 'revision_rejected';

CREATE OR REPLACE FUNCTION public.guard_wholesale_revision_update()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_item_count BIGINT; v_total NUMERIC(12,2);
BEGIN
  IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'WHOLESALE_REVISION_IMMUTABLE'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.order_id IS DISTINCT FROM OLD.order_id
    OR NEW.version_number IS DISTINCT FROM OLD.version_number
    OR NEW.revision_type IS DISTINCT FROM OLD.revision_type
    OR NEW.requires_customer_approval IS DISTINCT FROM OLD.requires_customer_approval
    OR NEW.commercial_conditions IS DISTINCT FROM OLD.commercial_conditions
    OR NEW.total_amount IS DISTINCT FROM OLD.total_amount OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
    OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'WHOLESALE_REVISION_IMMUTABLE_FIELD';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'draft' AND NEW.status IN ('ready_for_confirmation','awaiting_customer'))
    OR (OLD.status = 'ready_for_confirmation' AND NEW.status IN ('confirmed','superseded'))
    OR (OLD.status = 'awaiting_customer' AND NEW.status IN ('approved','rejected','superseded'))
    OR (OLD.status = 'approved' AND NEW.status IN ('confirmed','superseded'))
    OR (OLD.status = 'rejected' AND NEW.status = 'superseded')
  ) THEN RAISE EXCEPTION 'WHOLESALE_REVISION_INVALID_TRANSITION'; END IF;
  IF NEW.status <> 'draft' AND OLD.status = 'draft' THEN
    SELECT count(*), COALESCE(sum(line_total), 0) INTO v_item_count, v_total
    FROM public.wholesale_order_revision_items WHERE revision_id = OLD.id;
    IF v_item_count = 0 OR v_total <> NEW.total_amount THEN
      RAISE EXCEPTION 'WHOLESALE_REVISION_TOTAL_MISMATCH';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_wholesale_order_revision_portal(
  p_order UUID, p_customer UUID, p_revision UUID
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_order public.wholesale_orders%ROWTYPE; v_revision public.wholesale_order_revisions%ROWTYPE;
BEGIN
  IF p_order IS NULL OR p_customer IS NULL OR p_revision IS NULL THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  SELECT * INTO v_order FROM public.wholesale_orders
    WHERE id = p_order AND customer_id = p_customer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ORDER_NOT_FOUND'; END IF;
  IF v_order.current_revision_id <> p_revision THEN RAISE EXCEPTION 'WHOLESALE_REVISION_STALE'; END IF;
  SELECT * INTO v_revision FROM public.wholesale_order_revisions
    WHERE id = p_revision AND order_id = p_order FOR UPDATE;
  IF NOT FOUND OR NOT v_revision.requires_customer_approval THEN
    RAISE EXCEPTION 'WHOLESALE_REVISION_NOT_RESPONDABLE';
  END IF;
  IF v_revision.status = 'rejected' THEN RETURN TRUE; END IF;
  IF v_order.status <> 'awaiting_customer' OR v_revision.status <> 'awaiting_customer' THEN
    RAISE EXCEPTION 'WHOLESALE_REVISION_NOT_RESPONDABLE';
  END IF;
  UPDATE public.wholesale_order_revisions SET status = 'rejected' WHERE id = p_revision;
  UPDATE public.wholesale_orders SET status = 'in_review' WHERE id = p_order;
  INSERT INTO public.wholesale_order_events(order_id,revision_id,event_type,actor_type,actor_id,source,approval_channel)
    VALUES (p_order,p_revision,'revision_rejected','customer',p_customer,'portal','portal');
  RETURN TRUE;
END;
$$;

-- Allow administration to prepare a new revision after the customer declined the current proposal.
CREATE OR REPLACE FUNCTION public.propose_wholesale_order_revision_if_current(
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
  SELECT * INTO v_order FROM public.wholesale_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ORDER_NOT_FOUND'; END IF;
  v_fingerprint := encode(sha256(convert_to(jsonb_build_object(
    'expected_revision', p_expected_revision,
    'items', v_normalized,
    'conditions_input', p_commercial_conditions
  )::TEXT, 'UTF8')), 'hex');
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
    OR v_current.status NOT IN ('ready_for_confirmation','awaiting_customer','rejected') THEN
    RAISE EXCEPTION 'WHOLESALE_REVISION_INVALID_STATE';
  END IF;
  v_conditions := COALESCE(p_commercial_conditions, v_current.commercial_conditions);
  v_snapshot := public.snapshot_wholesale_order_items(v_normalized);
  SELECT COALESCE(jsonb_agg(jsonb_build_array(product_id,quantity,unit_price) ORDER BY product_id),'[]'::JSONB)
    INTO v_old_signature FROM public.wholesale_order_revision_items WHERE revision_id = v_current.id;
  SELECT COALESCE(jsonb_agg(jsonb_build_array(x.product_id,x.quantity,x.unit_price) ORDER BY x.product_id),'[]'::JSONB)
    INTO v_new_signature FROM jsonb_to_recordset(v_snapshot) AS x(product_id TEXT,quantity INTEGER,unit_price NUMERIC);
  SELECT sum((item->>'line_total')::NUMERIC) INTO v_total FROM jsonb_array_elements(v_snapshot) item;
  -- A declined offer must be explicitly reviewed again, even when all terms match.
  v_requires_approval := v_current.status = 'rejected'
    OR v_old_signature IS DISTINCT FROM v_new_signature
    OR v_current.total_amount IS DISTINCT FROM v_total
    OR v_current.commercial_conditions IS DISTINCT FROM v_conditions;
  IF NOT v_requires_approval THEN RAISE EXCEPTION 'WHOLESALE_PROPOSAL_UNCHANGED'; END IF;
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
  UPDATE public.wholesale_order_revisions SET status = 'superseded' WHERE id = v_current.id;
  UPDATE public.wholesale_orders SET current_revision_id = v_revision,
    status = CASE WHEN v_requires_approval THEN 'awaiting_customer' ELSE 'in_review' END
    WHERE id = p_order;
  INSERT INTO public.wholesale_order_events(order_id, revision_id, event_type, actor_type, actor_id, source, internal_note)
    VALUES (p_order, v_revision, 'revision_created', 'admin', p_actor, 'admin', btrim(COALESCE(p_internal_note,''))),
           (p_order, v_revision, 'revision_proposed', 'admin', p_actor, 'admin', btrim(COALESCE(p_internal_note,'')));
  RETURN v_revision;
END;
$$;

-- Return only customer-facing current-revision fields. Internal event notes remain excluded.
CREATE OR REPLACE FUNCTION public.list_wholesale_customer_orders(
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
      r.id AS revision_id, r.version_number AS revision_version, r.status AS revision_status, r.requires_customer_approval,
      r.commercial_conditions, r.total_amount, r.currency,
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

REVOKE ALL ON FUNCTION public.reject_wholesale_order_revision_portal(UUID,UUID,UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_wholesale_order_revision_portal(UUID,UUID,UUID)
  TO service_role;
REVOKE ALL ON FUNCTION public.propose_wholesale_order_revision_if_current(UUID,UUID,JSONB,UUID,UUID,TEXT,TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.propose_wholesale_order_revision_if_current(UUID,UUID,JSONB,UUID,UUID,TEXT,TEXT)
  TO service_role;
REVOKE ALL ON FUNCTION public.list_wholesale_customer_orders(UUID,INTEGER,TIMESTAMPTZ,UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_wholesale_customer_orders(UUID,INTEGER,TIMESTAMPTZ,UUID)
  TO service_role;

COMMIT;
