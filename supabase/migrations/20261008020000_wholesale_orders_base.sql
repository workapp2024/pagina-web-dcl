-- Base transaccional del circuito mayorista. No genera ventas, pagos ni stock.
BEGIN;

CREATE SEQUENCE public.wholesale_order_number_seq AS BIGINT NO CYCLE;

CREATE FUNCTION public.next_wholesale_order_number()
RETURNS TEXT
LANGUAGE SQL VOLATILE
SET search_path = pg_catalog, public
AS $$
  SELECT 'MW-' || lpad(n, GREATEST(6, length(n)), '0')
  FROM (SELECT nextval('public.wholesale_order_number_seq')::TEXT AS n) AS numbered;
$$;

CREATE TABLE public.wholesale_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL DEFAULT public.next_wholesale_order_number(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','in_review','awaiting_customer','confirmed','rejected','cancelled')),
  current_revision_id UUID NOT NULL,
  confirmed_revision_id UUID,
  idempotency_key UUID NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  confirmed_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  CONSTRAINT wholesale_orders_number_unique UNIQUE (order_number),
  CONSTRAINT wholesale_orders_customer_idempotency_unique UNIQUE (customer_id, idempotency_key),
  CONSTRAINT wholesale_orders_confirmation_consistency CHECK (
    (status = 'confirmed' AND confirmed_revision_id IS NOT NULL AND confirmed_at IS NOT NULL)
    OR (status <> 'confirmed' AND confirmed_revision_id IS NULL AND confirmed_at IS NULL)
    OR (status = 'cancelled' AND confirmed_revision_id IS NOT NULL AND confirmed_at IS NOT NULL)
  ),
  CONSTRAINT wholesale_orders_closed_consistency CHECK (
    (status IN ('rejected','cancelled')) = (closed_at IS NOT NULL)
  )
);
CREATE INDEX wholesale_orders_customer_created_idx
  ON public.wholesale_orders(customer_id, created_at DESC, id DESC);
CREATE INDEX wholesale_orders_status_created_idx
  ON public.wholesale_orders(status, created_at DESC, id DESC);

CREATE TABLE public.wholesale_order_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.wholesale_orders(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  revision_type TEXT NOT NULL CHECK (revision_type IN ('original','proposal','amendment')),
  status TEXT NOT NULL CHECK (status IN (
    'draft','ready_for_confirmation','awaiting_customer','approved','confirmed','superseded'
  )),
  requires_customer_approval BOOLEAN NOT NULL DEFAULT FALSE,
  commercial_conditions TEXT NOT NULL DEFAULT '' CHECK (length(commercial_conditions) <= 2000),
  total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'ARS' CHECK (currency ~ '^[A-Z]{3}$'),
  idempotency_key UUID NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT wholesale_order_revisions_order_id_id_unique UNIQUE (order_id, id),
  CONSTRAINT wholesale_order_revisions_version_unique UNIQUE (order_id, version_number),
  CONSTRAINT wholesale_order_revisions_idempotency_unique UNIQUE (order_id, idempotency_key)
);
CREATE INDEX wholesale_order_revisions_order_created_idx
  ON public.wholesale_order_revisions(order_id, version_number DESC);
CREATE UNIQUE INDEX wholesale_order_revisions_confirmed_once_idx
  ON public.wholesale_order_revisions(order_id) WHERE status = 'confirmed';

CREATE TABLE public.wholesale_order_revision_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id UUID NOT NULL REFERENCES public.wholesale_order_revisions(id) ON DELETE RESTRICT,
  product_id VARCHAR(64) NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name_snapshot VARCHAR(255) NOT NULL,
  category_snapshot VARCHAR(120),
  connector_type_snapshot VARCHAR(80),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  unit_cost_reference NUMERIC(12,2) CHECK (unit_cost_reference IS NULL OR unit_cost_reference >= 0),
  line_total NUMERIC(12,2) NOT NULL CHECK (line_total >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'ARS' CHECK (currency ~ '^[A-Z]{3}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT wholesale_order_revision_items_product_unique UNIQUE (revision_id, product_id),
  CONSTRAINT wholesale_order_revision_items_total_check CHECK (line_total = round(unit_price * quantity, 2))
);
CREATE INDEX wholesale_order_revision_items_product_idx
  ON public.wholesale_order_revision_items(product_id);

ALTER TABLE public.wholesale_orders
  ADD CONSTRAINT wholesale_orders_current_revision_fk
    FOREIGN KEY (id, current_revision_id)
    REFERENCES public.wholesale_order_revisions(order_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT wholesale_orders_confirmed_revision_fk
    FOREIGN KEY (id, confirmed_revision_id)
    REFERENCES public.wholesale_order_revisions(order_id, id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.wholesale_order_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.wholesale_orders(id) ON DELETE RESTRICT,
  revision_id UUID,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'order_created','review_started','revision_created','revision_proposed','revision_approved',
    'order_confirmed','order_rejected','order_cancelled'
  )),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('customer','admin','system')),
  actor_id UUID,
  source TEXT NOT NULL CHECK (source IN ('portal','admin','whatsapp','system')),
  approval_channel TEXT CHECK (approval_channel IS NULL OR approval_channel IN ('portal','whatsapp')),
  internal_note VARCHAR(1000) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT wholesale_order_events_approval_shape CHECK (
    (event_type = 'revision_approved' AND revision_id IS NOT NULL AND approval_channel = source)
    OR (event_type <> 'revision_approved' AND approval_channel IS NULL)
  ),
  CONSTRAINT wholesale_order_events_revision_fk
    FOREIGN KEY (order_id, revision_id)
    REFERENCES public.wholesale_order_revisions(order_id, id)
    ON DELETE RESTRICT
);
CREATE INDEX wholesale_order_events_order_created_idx
  ON public.wholesale_order_events(order_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX wholesale_order_events_revision_approval_once_idx
  ON public.wholesale_order_events(revision_id) WHERE event_type = 'revision_approved';

CREATE FUNCTION public.touch_wholesale_order()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER wholesale_orders_touch_updated_at
BEFORE UPDATE ON public.wholesale_orders
FOR EACH ROW EXECUTE FUNCTION public.touch_wholesale_order();

CREATE FUNCTION public.guard_wholesale_order_update()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.order_number IS DISTINCT FROM OLD.order_number
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'WHOLESALE_ORDER_IMMUTABLE_FIELD';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'received' AND NEW.status IN ('in_review','awaiting_customer','rejected','cancelled'))
    OR (OLD.status = 'in_review' AND NEW.status IN ('awaiting_customer','confirmed','rejected','cancelled'))
    OR (OLD.status = 'awaiting_customer' AND NEW.status IN ('in_review','rejected','cancelled'))
    OR (OLD.status = 'confirmed' AND NEW.status = 'cancelled')
  ) THEN RAISE EXCEPTION 'WHOLESALE_ORDER_INVALID_TRANSITION'; END IF;
  IF OLD.confirmed_revision_id IS NOT NULL AND NEW.confirmed_revision_id IS DISTINCT FROM OLD.confirmed_revision_id THEN
    RAISE EXCEPTION 'WHOLESALE_CONFIRMED_REVISION_IMMUTABLE';
  END IF;
  IF OLD.confirmed_at IS NOT NULL AND NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
    RAISE EXCEPTION 'WHOLESALE_CONFIRMATION_DATE_IMMUTABLE';
  END IF;
  IF OLD.closed_at IS NOT NULL AND NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
    RAISE EXCEPTION 'WHOLESALE_CLOSED_DATE_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wholesale_orders_guard_update
BEFORE UPDATE ON public.wholesale_orders
FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_order_update();

CREATE FUNCTION public.guard_wholesale_revision_update()
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
    OR (OLD.status = 'awaiting_customer' AND NEW.status IN ('approved','superseded'))
    OR (OLD.status = 'approved' AND NEW.status IN ('confirmed','superseded'))
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
CREATE TRIGGER wholesale_order_revisions_guard_update
BEFORE UPDATE ON public.wholesale_order_revisions
FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_revision_update();

CREATE FUNCTION public.guard_wholesale_revision_item_write()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_revision_id UUID; v_status TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'WHOLESALE_REVISION_ITEM_IMMUTABLE'; END IF;
  v_revision_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.revision_id ELSE NEW.revision_id END;
  SELECT status INTO v_status FROM public.wholesale_order_revisions WHERE id = v_revision_id FOR UPDATE;
  IF NOT FOUND OR v_status <> 'draft' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'WHOLESALE_REVISION_ITEM_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wholesale_order_revision_items_guard_write
BEFORE INSERT OR UPDATE OR DELETE ON public.wholesale_order_revision_items
FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_revision_item_write();

CREATE FUNCTION public.guard_wholesale_event_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'WHOLESALE_EVENT_IMMUTABLE';
END;
$$;
CREATE TRIGGER wholesale_order_events_immutable
BEFORE UPDATE OR DELETE ON public.wholesale_order_events
FOR EACH ROW EXECUTE FUNCTION public.guard_wholesale_event_immutable();

CREATE FUNCTION public.assert_wholesale_admin_actor(p_actor UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_profiles
    WHERE id = p_actor AND role = 'ADMIN' AND active IS TRUE
  ) THEN
    RAISE EXCEPTION 'WHOLESALE_ADMIN_REQUIRED';
  END IF;
END;
$$;

CREATE FUNCTION public.normalize_wholesale_order_items(p_items JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_item JSONB; v_normalized JSONB;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'WHOLESALE_INVALID_ITEMS';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'WHOLESALE_INVALID_ITEMS';
    END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(v_item)) <> 2
      OR NOT (v_item ? 'productId') OR NOT (v_item ? 'quantity')
      OR jsonb_typeof(v_item->'productId') IS DISTINCT FROM 'string'
      OR length(btrim(v_item->>'productId')) NOT BETWEEN 1 AND 64 THEN
      RAISE EXCEPTION 'WHOLESALE_INVALID_ITEMS';
    END IF;
    IF COALESCE(v_item->>'quantity','') !~ '^[1-9][0-9]{0,2}$' THEN
      RAISE EXCEPTION 'WHOLESALE_INVALID_ITEMS';
    END IF;
    IF (v_item->>'quantity')::INTEGER > 100 THEN
      RAISE EXCEPTION 'WHOLESALE_INVALID_ITEMS';
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) i
    GROUP BY btrim(i->>'productId')
    HAVING sum((i->>'quantity')::INTEGER) > 100
  ) THEN RAISE EXCEPTION 'WHOLESALE_INVALID_ITEMS'; END IF;
  SELECT jsonb_agg(jsonb_build_object('productId', product_id, 'quantity', quantity) ORDER BY product_id)
    INTO v_normalized
  FROM (
    SELECT btrim(i->>'productId') AS product_id, sum((i->>'quantity')::INTEGER)::INTEGER AS quantity
    FROM jsonb_array_elements(p_items) i GROUP BY btrim(i->>'productId')
  ) grouped;
  IF jsonb_array_length(v_normalized) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'WHOLESALE_INVALID_ITEMS'; END IF;
  RETURN v_normalized;
END;
$$;

CREATE FUNCTION public.snapshot_wholesale_order_items(p_items JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_rows BIGINT; v_snapshot JSONB;
BEGIN
  PERFORM p.id
  FROM public.products p
  JOIN jsonb_to_recordset(p_items) AS item("productId" TEXT, quantity INTEGER) ON item."productId" = p.id
  ORDER BY p.id FOR SHARE OF p;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> jsonb_array_length(p_items) THEN RAISE EXCEPTION 'WHOLESALE_PRODUCT_UNAVAILABLE'; END IF;
  SELECT jsonb_agg(jsonb_build_object(
    'product_id', p.id,
    'product_name_snapshot', p.name,
    'category_snapshot', p.category,
    'connector_type_snapshot', p.connector_type,
    'quantity', item.quantity,
    'unit_price', p.wholesale_price,
    'unit_cost_reference', p.cost_price,
    'line_total', round(p.wholesale_price * item.quantity, 2),
    'currency', 'ARS'
  ) ORDER BY p.id) INTO v_snapshot
  FROM public.products p
  JOIN jsonb_to_recordset(p_items) AS item("productId" TEXT, quantity INTEGER) ON item."productId" = p.id
  WHERE p.active IS TRUE AND p.show_in_catalog IS TRUE
    AND p.wholesale_price IS NOT NULL AND p.wholesale_price > 0;
  IF COALESCE(jsonb_array_length(v_snapshot), 0) <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'WHOLESALE_PRODUCT_UNAVAILABLE';
  END IF;
  RETURN v_snapshot;
END;
$$;

CREATE FUNCTION public.create_wholesale_order(
  p_customer UUID, p_items JSONB, p_idempotency_key UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_customer public.customers%ROWTYPE; v_order UUID; v_revision UUID := gen_random_uuid();
  v_normalized JSONB; v_snapshot JSONB; v_fingerprint TEXT; v_existing public.wholesale_orders%ROWTYPE;
  v_revision_fingerprint TEXT; v_total NUMERIC(12,2);
BEGIN
  IF p_customer IS NULL OR p_idempotency_key IS NULL THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  v_normalized := public.normalize_wholesale_order_items(p_items);
  v_fingerprint := encode(sha256(convert_to(v_normalized::TEXT, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_customer::TEXT || ':' || p_idempotency_key::TEXT, 0));
  SELECT * INTO v_existing FROM public.wholesale_orders
  WHERE customer_id = p_customer AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_fingerprint <> v_fingerprint THEN RAISE EXCEPTION 'WHOLESALE_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN v_existing.id;
  END IF;
  SELECT * INTO v_customer FROM public.customers WHERE id = p_customer FOR SHARE;
  IF NOT FOUND OR v_customer.archived_at IS NOT NULL OR NOT v_customer.wholesale_enabled OR NOT v_customer.wholesale_access_active THEN
    RAISE EXCEPTION 'WHOLESALE_CUSTOMER_UNAVAILABLE';
  END IF;
  v_snapshot := public.snapshot_wholesale_order_items(v_normalized);
  v_revision_fingerprint := encode(sha256(convert_to(v_snapshot::TEXT, 'UTF8')), 'hex');
  SELECT sum((item->>'line_total')::NUMERIC) INTO v_total FROM jsonb_array_elements(v_snapshot) item;
  v_order := gen_random_uuid();
  INSERT INTO public.wholesale_orders(id, customer_id, current_revision_id, idempotency_key, request_fingerprint)
  VALUES (v_order, p_customer, v_revision, p_idempotency_key, v_fingerprint);
  INSERT INTO public.wholesale_order_revisions(
    id, order_id, version_number, revision_type, status, total_amount, idempotency_key, request_fingerprint
  ) VALUES (v_revision, v_order, 1, 'original', 'draft', v_total, p_idempotency_key, v_revision_fingerprint);
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
  RETURN v_order;
END;
$$;

CREATE FUNCTION public.start_wholesale_order_review(p_order UUID, p_actor UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_order public.wholesale_orders%ROWTYPE;
BEGIN
  IF p_order IS NULL OR p_actor IS NULL THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  SELECT * INTO v_order FROM public.wholesale_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ORDER_NOT_FOUND'; END IF;
  IF v_order.status = 'in_review' THEN RETURN v_order.status; END IF;
  IF v_order.status <> 'received' THEN RAISE EXCEPTION 'WHOLESALE_ORDER_INVALID_STATE'; END IF;
  UPDATE public.wholesale_orders SET status = 'in_review' WHERE id = p_order;
  INSERT INTO public.wholesale_order_events(order_id, revision_id, event_type, actor_type, actor_id, source)
    VALUES (p_order, v_order.current_revision_id, 'review_started', 'admin', p_actor, 'admin');
  RETURN 'in_review';
END;
$$;

CREATE FUNCTION public.propose_wholesale_order_revision(
  p_order UUID, p_items JSONB, p_idempotency_key UUID, p_actor UUID,
  p_commercial_conditions TEXT DEFAULT NULL, p_internal_note TEXT DEFAULT ''
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_order public.wholesale_orders%ROWTYPE; v_current public.wholesale_order_revisions%ROWTYPE;
  v_revision UUID := gen_random_uuid(); v_normalized JSONB; v_snapshot JSONB;
  v_conditions TEXT; v_fingerprint TEXT; v_snapshot_fingerprint TEXT; v_total NUMERIC(12,2);
  v_version INTEGER; v_requires_approval BOOLEAN; v_existing public.wholesale_order_revisions%ROWTYPE;
  v_old_signature JSONB; v_new_signature JSONB; v_existing_found BOOLEAN;
BEGIN
  IF p_order IS NULL OR p_idempotency_key IS NULL OR p_actor IS NULL OR length(COALESCE(p_internal_note,'')) > 1000
    OR (p_commercial_conditions IS NOT NULL AND length(p_commercial_conditions) > 2000) THEN
    RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST';
  END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  v_normalized := public.normalize_wholesale_order_items(p_items);
  SELECT * INTO v_order FROM public.wholesale_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ORDER_NOT_FOUND'; END IF;
  SELECT * INTO v_existing FROM public.wholesale_order_revisions WHERE order_id = p_order AND idempotency_key = p_idempotency_key;
  v_existing_found := FOUND;
  v_conditions := COALESCE(p_commercial_conditions, (SELECT commercial_conditions FROM public.wholesale_order_revisions WHERE id = v_order.current_revision_id));
  v_fingerprint := encode(sha256(convert_to(jsonb_build_object('items',v_normalized,'conditions_input',p_commercial_conditions)::TEXT, 'UTF8')), 'hex');
  IF v_existing_found THEN
    IF v_existing.request_fingerprint <> v_fingerprint THEN RAISE EXCEPTION 'WHOLESALE_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN v_existing.id;
  END IF;
  IF v_order.status NOT IN ('received','in_review','awaiting_customer') THEN RAISE EXCEPTION 'WHOLESALE_ORDER_INVALID_STATE'; END IF;
  SELECT * INTO v_current FROM public.wholesale_order_revisions WHERE id = v_order.current_revision_id FOR UPDATE;
  IF NOT FOUND OR v_current.status NOT IN ('ready_for_confirmation','awaiting_customer','approved') THEN
    RAISE EXCEPTION 'WHOLESALE_REVISION_INVALID_STATE';
  END IF;
  v_snapshot := public.snapshot_wholesale_order_items(v_normalized);
  SELECT COALESCE(jsonb_agg(jsonb_build_array(product_id,quantity,unit_price) ORDER BY product_id),'[]'::JSONB)
    INTO v_old_signature FROM public.wholesale_order_revision_items WHERE revision_id = v_current.id;
  SELECT COALESCE(jsonb_agg(jsonb_build_array(x.product_id,x.quantity,x.unit_price) ORDER BY x.product_id),'[]'::JSONB)
    INTO v_new_signature FROM jsonb_to_recordset(v_snapshot) AS x(product_id TEXT,quantity INTEGER,unit_price NUMERIC);
  SELECT sum((item->>'line_total')::NUMERIC) INTO v_total FROM jsonb_array_elements(v_snapshot) item;
  v_requires_approval := v_old_signature IS DISTINCT FROM v_new_signature
    OR v_current.total_amount IS DISTINCT FROM v_total
    OR v_current.commercial_conditions IS DISTINCT FROM v_conditions;
  v_snapshot_fingerprint := encode(sha256(convert_to(v_snapshot::TEXT, 'UTF8')), 'hex');
  SELECT COALESCE(max(version_number),0) + 1 INTO v_version FROM public.wholesale_order_revisions WHERE order_id = p_order;
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

CREATE FUNCTION public.approve_wholesale_order_revision_portal(p_order UUID, p_customer UUID, p_revision UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_order public.wholesale_orders%ROWTYPE; v_revision public.wholesale_order_revisions%ROWTYPE;
BEGIN
  IF p_order IS NULL OR p_customer IS NULL OR p_revision IS NULL THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  SELECT * INTO v_order FROM public.wholesale_orders WHERE id = p_order AND customer_id = p_customer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ORDER_NOT_FOUND'; END IF;
  SELECT * INTO v_revision FROM public.wholesale_order_revisions WHERE id = p_revision AND order_id = p_order FOR UPDATE;
  IF NOT FOUND OR v_order.current_revision_id <> p_revision OR NOT v_revision.requires_customer_approval THEN
    RAISE EXCEPTION 'WHOLESALE_REVISION_NOT_APPROVABLE';
  END IF;
  IF v_revision.status = 'approved' AND v_order.status = 'in_review' THEN RETURN TRUE; END IF;
  IF v_order.status <> 'awaiting_customer' OR v_revision.status <> 'awaiting_customer' THEN
    RAISE EXCEPTION 'WHOLESALE_REVISION_NOT_APPROVABLE';
  END IF;
  UPDATE public.wholesale_order_revisions SET status = 'approved' WHERE id = p_revision;
  UPDATE public.wholesale_orders SET status = 'in_review' WHERE id = p_order;
  INSERT INTO public.wholesale_order_events(order_id,revision_id,event_type,actor_type,actor_id,source,approval_channel)
    VALUES (p_order,p_revision,'revision_approved','customer',p_customer,'portal','portal');
  RETURN TRUE;
END;
$$;

CREATE FUNCTION public.record_wholesale_whatsapp_approval(p_order UUID, p_revision UUID, p_actor UUID, p_internal_note TEXT DEFAULT '')
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_order public.wholesale_orders%ROWTYPE; v_revision public.wholesale_order_revisions%ROWTYPE;
BEGIN
  IF p_order IS NULL OR p_revision IS NULL OR p_actor IS NULL OR length(COALESCE(p_internal_note,'')) > 1000 THEN
    RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST';
  END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  SELECT * INTO v_order FROM public.wholesale_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ORDER_NOT_FOUND'; END IF;
  SELECT * INTO v_revision FROM public.wholesale_order_revisions WHERE id = p_revision AND order_id = p_order FOR UPDATE;
  IF NOT FOUND OR v_order.current_revision_id <> p_revision OR NOT v_revision.requires_customer_approval THEN
    RAISE EXCEPTION 'WHOLESALE_REVISION_NOT_APPROVABLE';
  END IF;
  IF v_revision.status = 'approved' AND v_order.status = 'in_review' THEN RETURN TRUE; END IF;
  IF v_order.status <> 'awaiting_customer' OR v_revision.status <> 'awaiting_customer' THEN
    RAISE EXCEPTION 'WHOLESALE_REVISION_NOT_APPROVABLE';
  END IF;
  UPDATE public.wholesale_order_revisions SET status = 'approved' WHERE id = p_revision;
  UPDATE public.wholesale_orders SET status = 'in_review' WHERE id = p_order;
  INSERT INTO public.wholesale_order_events(order_id,revision_id,event_type,actor_type,actor_id,source,approval_channel,internal_note)
    VALUES (p_order,p_revision,'revision_approved','admin',p_actor,'whatsapp','whatsapp',btrim(COALESCE(p_internal_note,'')));
  RETURN TRUE;
END;
$$;

CREATE FUNCTION public.confirm_wholesale_order_revision(p_order UUID, p_revision UUID, p_actor UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_order public.wholesale_orders%ROWTYPE; v_revision public.wholesale_order_revisions%ROWTYPE;
BEGIN
  IF p_order IS NULL OR p_revision IS NULL OR p_actor IS NULL THEN RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST'; END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  SELECT * INTO v_order FROM public.wholesale_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ORDER_NOT_FOUND'; END IF;
  IF v_order.status = 'confirmed' AND v_order.confirmed_revision_id = p_revision THEN RETURN p_order; END IF;
  SELECT * INTO v_revision FROM public.wholesale_order_revisions WHERE id = p_revision AND order_id = p_order FOR UPDATE;
  IF NOT FOUND OR v_order.current_revision_id <> p_revision OR v_order.status <> 'in_review'
    OR (v_revision.requires_customer_approval AND v_revision.status <> 'approved')
    OR (NOT v_revision.requires_customer_approval AND v_revision.status <> 'ready_for_confirmation') THEN
    RAISE EXCEPTION 'WHOLESALE_REVISION_NOT_CONFIRMABLE';
  END IF;
  UPDATE public.wholesale_order_revisions SET status = 'confirmed' WHERE id = p_revision;
  UPDATE public.wholesale_orders SET status = 'confirmed', confirmed_revision_id = p_revision,
    confirmed_at = clock_timestamp() WHERE id = p_order;
  INSERT INTO public.wholesale_order_events(order_id,revision_id,event_type,actor_type,actor_id,source)
    VALUES (p_order,p_revision,'order_confirmed','admin',p_actor,'admin');
  RETURN p_order;
END;
$$;

CREATE FUNCTION public.close_wholesale_order(p_order UUID, p_action TEXT, p_actor UUID, p_internal_note TEXT DEFAULT '')
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_order public.wholesale_orders%ROWTYPE; v_status TEXT; v_event TEXT;
BEGIN
  IF p_order IS NULL OR p_actor IS NULL OR p_action IS NULL OR p_action NOT IN ('reject','cancel') OR length(COALESCE(p_internal_note,'')) > 1000 THEN
    RAISE EXCEPTION 'WHOLESALE_INVALID_REQUEST';
  END IF;
  PERFORM public.assert_wholesale_admin_actor(p_actor);
  SELECT * INTO v_order FROM public.wholesale_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WHOLESALE_ORDER_NOT_FOUND'; END IF;
  IF (p_action = 'reject' AND v_order.status = 'rejected') OR (p_action = 'cancel' AND v_order.status = 'cancelled') THEN
    RETURN v_order.status;
  END IF;
  IF p_action = 'reject' AND v_order.status NOT IN ('received','in_review','awaiting_customer') THEN
    RAISE EXCEPTION 'WHOLESALE_ORDER_INVALID_STATE';
  END IF;
  IF p_action = 'cancel' AND v_order.status NOT IN ('received','in_review','awaiting_customer','confirmed') THEN
    RAISE EXCEPTION 'WHOLESALE_ORDER_INVALID_STATE';
  END IF;
  v_status := CASE WHEN p_action = 'reject' THEN 'rejected' ELSE 'cancelled' END;
  v_event := CASE WHEN p_action = 'reject' THEN 'order_rejected' ELSE 'order_cancelled' END;
  UPDATE public.wholesale_orders SET status = v_status, closed_at = clock_timestamp() WHERE id = p_order;
  INSERT INTO public.wholesale_order_events(order_id,revision_id,event_type,actor_type,actor_id,source,internal_note)
    VALUES (p_order,v_order.current_revision_id,v_event,'admin',p_actor,'admin',btrim(COALESCE(p_internal_note,'')));
  RETURN v_status;
END;
$$;

ALTER TABLE public.wholesale_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wholesale_order_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wholesale_order_revision_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wholesale_order_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wholesale_orders, public.wholesale_order_revisions,
  public.wholesale_order_revision_items, public.wholesale_order_events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.wholesale_orders, public.wholesale_order_revisions,
  public.wholesale_order_revision_items, public.wholesale_order_events TO service_role;
REVOKE ALL ON SEQUENCE public.wholesale_order_number_seq, public.wholesale_order_events_id_seq
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.next_wholesale_order_number(),
  public.touch_wholesale_order(), public.guard_wholesale_order_update(),
  public.guard_wholesale_revision_update(), public.guard_wholesale_revision_item_write(),
  public.guard_wholesale_event_immutable(), public.assert_wholesale_admin_actor(UUID),
  public.normalize_wholesale_order_items(JSONB),
  public.snapshot_wholesale_order_items(JSONB), public.create_wholesale_order(UUID,JSONB,UUID),
  public.start_wholesale_order_review(UUID,UUID),
  public.propose_wholesale_order_revision(UUID,JSONB,UUID,UUID,TEXT,TEXT),
  public.approve_wholesale_order_revision_portal(UUID,UUID,UUID),
  public.record_wholesale_whatsapp_approval(UUID,UUID,UUID,TEXT),
  public.confirm_wholesale_order_revision(UUID,UUID,UUID),
  public.close_wholesale_order(UUID,TEXT,UUID,TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_wholesale_order(UUID,JSONB,UUID),
  public.start_wholesale_order_review(UUID,UUID),
  public.propose_wholesale_order_revision(UUID,JSONB,UUID,UUID,TEXT,TEXT),
  public.approve_wholesale_order_revision_portal(UUID,UUID,UUID),
  public.record_wholesale_whatsapp_approval(UUID,UUID,UUID,TEXT),
  public.confirm_wholesale_order_revision(UUID,UUID,UUID),
  public.close_wholesale_order(UUID,TEXT,UUID,TEXT)
  TO service_role;

COMMIT;
